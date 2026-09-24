from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from topview_3d_cli import local_assets, local_cli
from topview_3d_cli.local_project import LocalProjectError, init_project, open_project

CHARACTER_KEY = "3d-builder/library/characters/scout.glb"


def run(capsys, *argv):
    code = local_cli.main([str(item) for item in argv])
    captured = capsys.readouterr()
    return code, json.loads(captured.out or captured.err)


def write_manifest(root: Path, assets: list[dict]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps({"format": "scene3d-asset-manifest", "version": 1,
                                                    "assets": assets}), encoding="utf-8")


def character_node(node_id="scout-1", key=CHARACTER_KEY):
    return {"id": node_id, "type": "character", "name": "Scout",
            "transform": {"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
                          "scale": {"x": 1, "y": 1, "z": 1}},
            "metadata": {"assetId": "a3d_char_scout", "assetSource": "library", "modelUrl": key}}


def document_with(nodes, motion_clips=(), motion_paths=()):
    return {"content": {"nodes": nodes, "timeline": {"animation": {"motionClips": list(motion_clips)}},
                        "asset": {"motionPath": list(motion_paths)}}}


@pytest.fixture
def builtin(tmp_path, monkeypatch):
    root = tmp_path / "builtin"
    write_manifest(root, [])
    monkeypatch.setenv("TOPVIEW3D_BUILTIN_ASSETS", str(root))
    return root


def test_repository_manifest_is_valid_and_complete(monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_BUILTIN_ASSETS", raising=False)
    catalog = local_assets.asset_catalog()
    kinds = {kind: [entry for entry in catalog if entry["kind"] == kind] for kind in local_assets.ASSET_KINDS}
    assert {entry["name"] for entry in kinds["character"]} == {"Child", "Youth", "Female", "Man"}
    assert len(kinds["pose"]) == 121 and all(entry.get("cover") for entry in kinds["pose"])
    assert {entry["primitive"]["kind"] for entry in kinds["primitive"]} == set(local_assets.PRIMITIVE_KINDS)
    assert kinds["prop"] == []
    for entry in kinds["character"] + kinds["pose"]:
        assert entry["license"] == "CC-BY-4.0" and entry["rig"] == "mixamorig"
        assert entry["attribution"] == "© Topview, CC BY 4.0"
        assert local_assets._sha256(Path(entry["path"])) == entry["sha256"]


def test_find_asset_accepts_pose_ids_without_prefix(monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_BUILTIN_ASSETS", raising=False)
    catalog = local_assets.asset_catalog()
    pose = next(entry for entry in catalog if entry["kind"] == "pose")
    short = pose["id"].removeprefix("a3d_pose_")
    assert local_assets.find_asset(catalog, "pose", short)["id"] == pose["id"]
    with pytest.raises(LocalProjectError) as caught:
        local_assets.find_asset(catalog, "pose", "no-such-pose")
    assert caught.value.code == "ASSET_NOT_FOUND"


@pytest.mark.parametrize("entry, code", [
    ({"id": "x", "kind": "character", "file": "../x.glb", "key": "k"}, "ASSET_MANIFEST_INVALID"),
    ({"id": "x", "kind": "character", "file": "/etc/passwd", "key": "k"}, "ASSET_MANIFEST_INVALID"),
    ({"id": "x", "kind": "character", "file": "characters/./x.glb", "key": "k"}, "ASSET_MANIFEST_INVALID"),
    ({"id": "x", "kind": "motion", "file": "motions/x.glb"}, "ASSET_MANIFEST_INVALID"),
    ({"id": "bad id", "kind": "primitive", "primitive": {"kind": "BoxGeometry", "parameters": {}}},
     "ASSET_MANIFEST_INVALID"),
    ({"id": "x", "kind": "primitive", "primitive": {"kind": "TorusGeometry", "parameters": {}}},
     "ASSET_MANIFEST_INVALID"),
    ({"id": "x", "kind": "character", "file": "characters/missing.glb", "key": "k"}, "ASSET_FILE_MISSING"),
    ({"id": "x", "kind": "primitive", "primitive": {"kind": "BoxGeometry", "parameters": {}},
      "cover": "../cover.webp"}, "ASSET_MANIFEST_INVALID"),
])
def test_manifest_rejects_bad_entries(builtin, entry, code):
    write_manifest(builtin, [entry])
    with pytest.raises(LocalProjectError) as caught:
        local_assets.asset_catalog()
    assert caught.value.code == code


def test_import_copies_file_and_project_overrides_builtin(builtin, tmp_path):
    source = tmp_path / "scout.glb"
    source.write_bytes(b"glTF-bytes")
    entry = local_assets.import_asset(builtin, source, kind="character", asset_id="scout", key=CHARACTER_KEY,
                                      license_name="CC0-1.0", source_url="self-made", rig="mixamorig")
    assert entry["file"] == "characters/scout.glb" and entry["bytes"] == 10 and len(entry["sha256"]) == 64
    assert local_assets.local_asset_map(local_assets.asset_catalog()) == {
        CHARACTER_KEY: str((builtin / "characters/scout.glb").resolve())}

    ({"id": "x", "kind": "primitive", "primitive": {"kind": "BoxGeometry", "parameters": {}},
      "cover": "../cover.webp"}, "ASSET_MANIFEST_INVALID"),
    project = tmp_path / "project"
    init_project(project)
    paths = open_project(project).paths
    local_assets.import_asset(paths.assets, source, kind="character", asset_id="scout", key=CHARACTER_KEY)
    catalog = local_assets.asset_catalog(paths)
    assert [entry["origin"] for entry in catalog if entry["id"] == "scout"] == ["project"]


@pytest.mark.parametrize("kind, name, body", [
    ("motion", "walk.glb", b"x"),
    ("character", "scout.fbx", b"x"),
    ("pose", "pose.json", b"not json"),
    ("pose", "pose.json", b'{"name": "no bones"}'),
])
def test_import_rejects_bad_input(builtin, tmp_path, kind, name, body):
    source = tmp_path / name
    source.write_bytes(body)
    with pytest.raises(LocalProjectError) as caught:
        local_assets.import_asset(builtin, source, kind=kind, asset_id="a")
    assert caught.value.code == "ASSET_IMPORT_INVALID"


def test_missing_model_is_an_error_and_missing_motion_a_warning():
    document = document_with(
        [character_node()],
        motion_clips=[{"motion": {"assetId": "walk"}}],
        motion_paths=[{"id": "walk", "path": "3d-builder/library/motions/walk.glb"},
                      {"id": "unused", "path": "3d-builder/library/motions/unused.glb"}])
    with pytest.raises(LocalProjectError) as caught:
        local_assets.check_render_assets(document, {})
    assert caught.value.code == "ASSET_NOT_AVAILABLE"
    assert caught.value.details == {"missing": [{"nodeId": "scout-1", "key": CHARACTER_KEY}]}
    assert local_assets.check_render_assets(document, {CHARACTER_KEY: "/x.glb"}) == ["MOTION_NOT_AVAILABLE:walk"]


def test_public_base_only_covers_public_keys():
    public = document_with([character_node(key="3d-builder/public/characters/a.glb")])
    assert local_assets.check_render_assets(public, {}, "https://cdn.example") == []
    with pytest.raises(LocalProjectError):
        local_assets.check_render_assets(document_with([character_node()]), {}, "https://cdn.example")


def test_asset_cli_list_and_import(capsys, builtin, tmp_path):
    project = tmp_path / "project"
    init_project(project)
    source = tmp_path / "scout.glb"
    source.write_bytes(b"glTF")
    code, body = run(capsys, "asset", "import", "--project", project, source, "--kind", "character",
                     "--id", "scout", "--key", CHARACTER_KEY, "--license", "CC0-1.0")
    assert code == 0 and body["asset"]["key"] == CHARACTER_KEY
    code, body = run(capsys, "asset", "list", project, "--kind", "character")
    assert code == 0 and [entry["id"] for entry in body["assets"]] == ["scout"]
    assert "path" not in body["assets"][0]
    code, body = run(capsys, "asset", "import", "--project", project, source, "--kind", "motion", "--id", "w")
    assert code == 2 and body["code"] == "USAGE_INVALID"


def test_render_writes_into_project_with_metadata_and_local_assets(capsys, builtin, tmp_path, monkeypatch):
    project = tmp_path / "project"
    init_project(project)
    source = tmp_path / "scout.glb"
    source.write_bytes(b"glTF")
    local_assets.import_asset(builtin, source, kind="character", asset_id="scout", key=CHARACTER_KEY)
    ops = tmp_path / "ops.json"
    node = character_node()
    ops.write_text(json.dumps({"schemaVersion": 2, "operations": [
        {"entityId": node["id"], "kind": "director.node.upsert", "payload": {"node": node}}]}), encoding="utf-8")
    assert run(capsys, "document", "apply", project, ops)[0] == 0
    seen = {}

    def fake_run(argv, **kwargs):
        seen.update(json.loads(Path(argv[-1]).read_text(encoding="utf-8")))
        return subprocess.CompletedProcess(argv, 0, stdout=json.dumps({"outputDir": seen["outputDir"]}), stderr="")

    monkeypatch.setattr(local_cli.subprocess, "run", fake_run)
    code, body = run(capsys, "render", project)
    assert code == 0
    assert Path(seen["outputDir"]) == (project / ".topview3d" / "renders" / body["runId"]).resolve()
    assert seen["localAssets"] == {CHARACTER_KEY: str((builtin / "characters/scout.glb").resolve())}
    assert seen["publicAssetBase"] == ""
    assert set(seen["metadata"]) == {"revision", "documentSha256", "builderVersion", "cliVersion"}
    assert body["documentSha256"] == seen["metadata"]["documentSha256"] and body["warnings"] == []


def test_render_fails_before_node_when_model_is_missing(capsys, builtin, tmp_path, monkeypatch):
    project = tmp_path / "project"
    init_project(project)
    ops = tmp_path / "ops.json"
    node = character_node()
    ops.write_text(json.dumps({"schemaVersion": 2, "operations": [
        {"entityId": node["id"], "kind": "director.node.upsert", "payload": {"node": node}}]}), encoding="utf-8")
    assert run(capsys, "document", "apply", project, ops)[0] == 0
    monkeypatch.setattr(local_cli.subprocess, "run", lambda *a, **k: pytest.fail("renderer must not start"))
    code, body = run(capsys, "render", project)
    assert code == 1 and body["code"] == "ASSET_NOT_AVAILABLE"


def test_render_payload_cannot_override_managed_fields(capsys, tmp_path):
    project = tmp_path / "project"
    init_project(project)
    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps({"outputDir": "/tmp/elsewhere"}), encoding="utf-8")
    code, body = run(capsys, "render", project, payload)
    assert code == 2 and body["code"] == "RENDER_PAYLOAD_INVALID"


def test_pose_import_keeps_key_and_cover(builtin, tmp_path):
    pose = tmp_path / "wave.json"
    pose.write_text(json.dumps({"pose_id": "wave", "hips": [0, 0, 0], "bones": {}}), encoding="utf-8")
    cover = tmp_path / "wave.webp"
    cover.write_bytes(b"RIFF")
    entry = local_assets.import_asset(builtin, pose, kind="pose", asset_id="a3d_pose_wave",
                                      key="3d-builder/library/poses/wave.json", cover=cover)
    assert entry["cover"] == "covers/a3d_pose_wave.webp" and (builtin / entry["cover"]).is_file()
    assert entry["key"] == "3d-builder/library/poses/wave.json"
    assert (builtin / "manifest.json").stat().st_mode & 0o777 == 0o644
    bad_cover = tmp_path / "wave.gif"
    bad_cover.write_bytes(b"GIF8")
    with pytest.raises(LocalProjectError):
        local_assets.import_asset(builtin, pose, kind="pose", asset_id="a3d_pose_wave", cover=bad_cover)


def test_pose_apply_compiles_and_upserts(capsys, builtin, tmp_path, monkeypatch):
    source = tmp_path / "scout.glb"
    source.write_bytes(b"glTF")
    local_assets.import_asset(builtin, source, kind="character", asset_id="scout", key=CHARACTER_KEY)
    pose = tmp_path / "wave.json"
    pose.write_text(json.dumps({"pose_id": "wave", "hips": [0, -0.1, 0], "bones": {"mixamorigHips": [0, 0, 0, 1]}}),
                    encoding="utf-8")
    local_assets.import_asset(builtin, pose, kind="pose", asset_id="a3d_pose_wave")
    project = tmp_path / "project"
    init_project(project)
    ops = tmp_path / "ops.json"
    node = character_node()
    node["character"] = {"placeholder": False, "gender": "female", "motionId": None, "appearance": {"color": "#fff"},
                         "label": {"showLabel": False, "scale": 1, "yOffset": 0},
                         "animation": {"mode": "pose", "controlValues": {}}}
    ops.write_text(json.dumps({"schemaVersion": 2, "operations": [
        {"entityId": node["id"], "kind": "director.node.upsert", "payload": {"node": node}}]}), encoding="utf-8")
    assert run(capsys, "document", "apply", project, ops)[0] == 0
    seen = {}
    animation = {"mode": "pose", "posePresetId": "wave", "controlValues": {"joint:mixamorigHips:x": 5},
                 "rootPositionOffset": {"x": 0, "y": -0.1, "z": 0}}

    def fake_run(argv, **kwargs):
        seen["command"] = argv[2]
        seen.update(json.loads(Path(argv[-1]).read_text(encoding="utf-8")))
        return subprocess.CompletedProcess(
            argv, 0, stdout=json.dumps({"results": [{"animation": animation, "pose": {}}]}), stderr="")

    monkeypatch.setattr(local_cli.subprocess, "run", fake_run)
    code, body = run(capsys, "pose", "apply", project, "scout-1", "wave")
    assert code == 0 and body["poseId"] == "a3d_pose_wave" and seen["command"] == "apply-library-poses"
    assert seen["items"][0]["pose"]["pose_id"] == "wave" and seen["localAssets"] == {
        CHARACTER_KEY: str((builtin / "characters/scout.glb").resolve())}
    stored = next(n for n in open_project(project).store.assemble()["document"]["content"]["nodes"]
                  if n["id"] == "scout-1")
    assert stored["character"]["animation"] == animation
    code, body = run(capsys, "pose", "apply", project, "cam-main", "wave")
    assert code == 2 and body["code"] == "POSE_TARGET_INVALID"
    code, body = run(capsys, "pose", "apply", project, "scout-1", "missing")
    assert code == 2 and body["code"] == "ASSET_NOT_FOUND"

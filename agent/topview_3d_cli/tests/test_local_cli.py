from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

from topview_3d_cli import local_cli
from topview_3d_cli.director_document import default_camera_node, empty_director_document
from topview_3d_cli.local_errors import ERROR_CODES
from topview_3d_cli.local_project import document_get, init_project, open_project

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
FIXTURE_PROJECT = Path(__file__).resolve().parent / "fixtures" / "local-project"


def run(capsys, *argv):
    code = local_cli.main([str(item) for item in argv])
    captured = capsys.readouterr()
    stream = captured.out if code == 0 or (captured.out and not captured.err) else captured.err
    return code, json.loads(stream)


def box(node_id="box-1", y=0.5):
    return {"id": node_id, "type": "primitive", "name": "Box",
            "transform": {"position": {"x": 0, "y": y, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
                          "scale": {"x": 1, "y": 1, "z": 1}},
            "primitive": {"kind": "BoxGeometry", "parameters": {"width": 1, "height": 1, "depth": 1}}}


def camera_clip(clip_id, node_id):
    return {"id": clip_id, "target": {"type": "node", "nodeId": node_id}, "frameStart": 0, "frameEnd": 48,
            "trimStartMs": 0, "trimEndMs": 2000,
            "playback": {"version": 1, "speed": 1, "loop": False, "loopMode": "ping-pong", "baseDurationFrames": 48},
            "motion": {"id": "m1", "version": 1, "presetId": "ascending_orbit", "label": "orbit",
                       "timeUnit": "millisecond", "durationMs": 2000,
                       "curves": [{"id": "c1", "group": "position", "dataPath": "location", "arrayIndex": 0,
                                   "extrapolation": "constant",
                                   "keyframes": [{"id": "k1", "time": 0, "value": 1, "interpolation": "linear"}]}]}}


def upsert(node, **extra):
    return {"operationId": f"op_{node['id']}_{node['transform']['position']['y']}".replace(".", "_"),
            "entityId": node["id"], "kind": "director.node.upsert", "payload": {"node": node}, **extra}


def write_ops(tmp_path, operations, name="ops.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"schemaVersion": 2, "operations": operations}), encoding="utf-8")
    return path


def state_bytes(project):
    return {path.name: path.read_bytes() for path in sorted((project / ".topview-3d").glob("*.json"))}


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "scene"
    init_project(root)
    return root


def test_init_status_get_validate(capsys, tmp_path):
    root = tmp_path / "scene"
    code, body = run(capsys, "project", "init", root)
    assert code == 0 and body["metadata"]["schemaVersion"] == 2 and body["metadata"]["revision"] == 0
    assert body["metadata"]["sceneSequence"] == 2  # genesis: scene.set + default camera
    code, status = run(capsys, "project", "status", root)
    assert code == 0 and status["document"]["cameras"] == ["cam-main"] and status["danglingReferences"] == []
    code, got = run(capsys, "document", "get", root)
    assert got["entityVersions"] == {"director": 1, "cam-main": 1}
    assert got["fcurves"] == {"version": 1, "encoding": "compact-v1", "fcurves": []}
    assert run(capsys, "document", "validate", root)[0] == 0
    disk = json.loads((root / ".topview-3d" / "document.json").read_text(encoding="utf-8"))
    assert disk == got["document"]


def test_studio_open_needs_a_checkout(capsys, project, monkeypatch):
    monkeypatch.setattr("topview_3d_cli.local_studio.REPO_ROOT", project)
    monkeypatch.setattr("topview_3d_cli.local_studio._port_open", lambda _port: False)
    code, body = run(capsys, "studio", "open", project)
    assert code == 1 and body["code"] == "STUDIO_UNAVAILABLE"


def test_adopt_studio_edit_is_what_the_cli_reads_next(capsys, project, tmp_path):
    document = document_get(project)["document"]
    camera = next(node for node in document["content"]["nodes"] if node["id"] == "cam-main")
    camera["name"] = "Studio camera"
    payload = tmp_path / "edit.json"
    payload.write_text(json.dumps({"document": document}), encoding="utf-8")
    code, body = run(capsys, "project", "adopt", project, payload)
    assert code == 0 and body["adopted"] is True and body["operations"] >= 1
    reread = document_get(project)["document"]
    assert next(node["name"] for node in reread["content"]["nodes"] if node["id"] == "cam-main") == "Studio camera"
    code, again = run(capsys, "project", "adopt", project, payload)
    assert code == 0 and again["adopted"] is False


def test_init_refuses_existing_project(capsys, project):
    code, body = run(capsys, "project", "init", project)
    assert code == 2 and body["code"] == "PROJECT_EXISTS"


def test_apply_reads_back_and_bumps_revision(capsys, project, tmp_path):
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]))
    assert code == 0, body
    assert body["revision"] == 1 and body["sceneSequence"] == 3 and body["entityVersions"]["box-1"] == 1
    assert any(node["id"] == "box-1" for node in document_get(project)["document"]["content"]["nodes"])


def test_single_writer_overwrites_without_version_and_strict_refuses(capsys, project, tmp_path):
    run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]))
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box(y=2))]))
    assert code == 0 and body["entityVersions"]["box-1"] == 2
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box(y=3))]), "--strict")
    assert code == 1 and body["code"] == "ENTITY_VERSION_CONFLICT"
    code, body = run(capsys, "document", "apply", project,
                     write_ops(tmp_path, [upsert(box(y=3), expectedEntityVersion=2)]), "--strict")
    assert code == 0 and body["entityVersions"]["box-1"] == 3


@pytest.mark.parametrize("operations,code,error", [
    ([{"operationId": "x", "kind": "unknown.kind", "entityId": "box-1", "payload": {}}], 2, "UNSUPPORTED_DIRECTOR_KIND"),
    ([upsert(box()), {"operationId": "d", "kind": "director.node.delete", "entityId": "ghost", "payload": {}}],
     2, "ENTITY_NOT_FOUND"),
    ([upsert(box(), baseSequence=99)], 1, "SEQUENCE_GAP"),
    ([{"operationId": "c", "entityId": "clip-1", "kind": "director.clip.upsert",
       "payload": {"clipKind": "cameraMotion", "clip": {**camera_clip("clip-1", "cam-main"), "trimStartMs": None}}}],
     2, "INVALID_DIRECTOR_DOCUMENT"),
])
def test_failed_apply_leaves_every_state_file_unchanged(capsys, project, tmp_path, operations, code, error):
    before = state_bytes(project)
    exit_code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, operations))
    assert (exit_code, body["code"]) == (code, error), body
    assert state_bytes(project) == before


def test_dry_run_reports_without_writing(capsys, project, tmp_path):
    before = state_bytes(project)
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]), "--dry-run")
    assert code == 0 and body["dryRun"] and body["operationCount"] == 1
    assert state_bytes(project) == before


def test_operations_from_stdin_and_generated_operation_ids(capsys, project, monkeypatch):
    operation = upsert(box())
    del operation["operationId"]
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO(json.dumps([operation])))
    code, body = run(capsys, "document", "apply", project, "-")
    assert code == 0 and body["accepted"][0]["operationId"].startswith("cli_")


def test_node_delete_cascades_clips_and_curves(capsys, project, tmp_path):
    camera = default_camera_node("portrait")
    curves = {"version": 1, "encoding": "compact-v1",
              "fcurves": [{"id": "fc", "t": ["node", "portrait"], "p": "position", "i": 0, "k": [[0, 1, "linear"]]}]}
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [
        upsert(camera),
        {"operationId": "clip", "entityId": "portrait-move", "kind": "director.clip.upsert",
         "payload": {"clipKind": "cameraMotion", "clip": camera_clip("portrait-move", "portrait")}},
        {"operationId": "curves", "entityId": "fcurves__portrait", "kind": "director.fcurves.set", "payload": curves},
    ]))
    assert code == 0, body
    code, body = run(capsys, "node", "delete", project, "portrait")
    assert code == 0, body
    assert body["deletedClipIds"] == ["portrait-move"]
    got = document_get(project)
    assert "portrait" not in got["entityVersions"] and got["fcurves"]["fcurves"] == []
    code, body = run(capsys, "node", "delete", project, "portrait")
    assert code == 2 and body["code"] == "DIRECTOR_NODE_NOT_FOUND"
    code, body = run(capsys, "node", "delete", project, "cam-main")
    assert code == 1 and body["code"] == "DIRECTOR_LAST_CAMERA_REQUIRED"


@pytest.mark.parametrize("argv,code,error", [
    (["project"], 2, "USAGE_INVALID"),
    (["bogus"], 2, "USAGE_INVALID"),
    (["document", "get", "/nonexistent/topview3d-project"], 2, "PROJECT_NOT_INITIALIZED"),
])
def test_usage_and_missing_project_errors_are_json(capsys, argv, code, error):
    exit_code, body = run(capsys, *argv)
    assert (exit_code, body["code"], body["ok"]) == (code, error, False)


def test_operations_file_errors(capsys, project, tmp_path):
    assert run(capsys, "document", "apply", project, tmp_path / "missing.json")[1]["code"] == "OPERATIONS_NOT_FOUND"
    bad = tmp_path / "bad.json"
    bad.write_text("{", encoding="utf-8")
    code, body = run(capsys, "document", "apply", project, bad)
    assert (code, body["code"]) == (2, "OPERATIONS_JSON_INVALID")


def test_schema_version_1_project_is_migrated_on_first_write(capsys, tmp_path):
    root = tmp_path / "old"
    state = root / ".topview-3d"
    state.mkdir(parents=True)
    document = empty_director_document()
    document["content"]["nodes"].append(box())
    (state / "document.json").write_text(json.dumps(document), encoding="utf-8")
    (state / "metadata.json").write_text(json.dumps({"format": "scene3d-local-project", "schemaVersion": 1,
                                                     "revision": 4}), encoding="utf-8")
    code, status = run(capsys, "project", "status", root)
    assert code == 0 and status["migrationPending"]["fromSchemaVersion"] == 1
    assert not (state / "entities.json").exists()
    code, body = run(capsys, "document", "apply", root, write_ops(tmp_path, [upsert(box(y=2))]))
    assert code == 0 and "migrationPending" not in body and body["revision"] == 5
    assert open_project(root).metadata["schemaVersion"] == 2


def test_fixture_project_is_current_and_reproducible(tmp_path, capsys):
    copied = tmp_path / "fixture"
    shutil.copytree(FIXTURE_PROJECT, copied)
    code, body = run(capsys, "document", "validate", copied)
    assert code == 0 and body["danglingReferences"] == []
    rebuilt = tmp_path / "rebuilt"
    init_project(rebuilt)
    code, _ = run(capsys, "document", "apply", rebuilt, FIXTURE_PROJECT / "operations.json")
    assert code == 0
    assert document_get(rebuilt)["document"] == document_get(copied)["document"]
    assert document_get(rebuilt)["fcurves"] == document_get(copied)["fcurves"]


def test_doctor_json_always_exits_zero_and_reports_every_check(capsys):
    code, body = run(capsys, "doctor", "--json")
    assert code == 0 and body["runtime"] == "workspace"
    assert set(body["checks"]) == {"python", "node", "runtime", "assets", "playwright", "chromium", "pnpm"}
    assert body["ok"] == all(check["ok"] for check in body["checks"].values())
    assert all("hint" in check for check in body["checks"].values() if not check["ok"])


def test_plain_doctor_is_human_readable(capsys, monkeypatch):
    report = {"ok": False, "cliVersion": "0", "runtime": "packaged",
              "checks": {"node": {"ok": False, "hint": "Install Node.js"}}}
    monkeypatch.setattr(local_cli, "doctor", lambda: report)
    assert local_cli.main(["doctor"]) == 1
    out = capsys.readouterr().out
    assert "[FAIL] node" in out and "Install Node.js" in out


def test_doctor_json_reports_a_missing_runtime(capsys, monkeypatch):
    monkeypatch.setenv("TOPVIEW3D_RUNTIME", "packaged")
    monkeypatch.setattr("topview_3d_cli.runtime.STAGED_ROOT", Path("/nonexistent/_runtime"))
    code, body = run(capsys, "doctor", "--json")
    assert code == 0 and body["ok"] is False and body["checks"]["runtime"]["code"] == "RUNTIME_MISSING"


def test_every_raised_code_is_in_the_table_and_documented():
    raised = set()
    for path in PACKAGE.glob("*.py"):
        raised |= set(re.findall(
            r'(?:LocalProjectError|DirectorOperationError|DirectorConflictError|_reject)\(\s*"([A-Z_]+)"',
            path.read_text(encoding="utf-8")))
    from topview_3d_cli.local_bom import _CHECKPOINT_CODES
    raised |= {"DIRECTOR_NODE_NOT_FOUND", "DIRECTOR_NODE_LOCKED", "DIRECTOR_LAST_CAMERA_REQUIRED",
               "DIRECTOR_DELETE_CHILDREN_FIRST", "DIRECTOR_DELETE_TOO_MANY_DEPENDENCIES",
               *_CHECKPOINT_CODES.values()}
    assert raised <= set(ERROR_CODES), raised - set(ERROR_CODES)
    documented = set(re.findall(r"^\| `([A-Z_]+)` \| ([12]) \|", (REPO / "docs/topview-3d-cli.md").read_text(encoding="utf-8"),
                                re.MULTILINE))
    assert documented == {(code, str(exit_code)) for code, (exit_code, _) in ERROR_CODES.items()}

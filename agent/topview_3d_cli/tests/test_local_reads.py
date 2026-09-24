"""asset search/show, pose catalog, document get views, renders, camera presets, bom."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from topview_3d_cli import local_cli
from topview_3d_cli.local_project import init_project, open_project
from topview_3d_cli.runtime import runtime

MAN = "a3d_char_7d220ac359844c80a8faaf0e25478477"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 300


def run(capsys, *argv):
    code = local_cli.main([str(item) for item in argv])
    captured = capsys.readouterr()
    return code, json.loads(captured.out or captured.err)


@pytest.fixture(autouse=True)
def repository_assets(monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_BUILTIN_ASSETS", raising=False)


@pytest.fixture
def needs_node():
    if not shutil.which("node") or not (runtime().builder_dist / "evaluate/index.mjs").is_file():
        pytest.skip("needs node and a built editor/packages/builder")


def test_asset_search_filters_scores_and_facets(capsys):
    code, body = run(capsys, "asset", "search", "man")
    assert code == 0 and body["items"][0]["id"] == MAN and body["items"][0]["score"] >= 3
    code, body = run(capsys, "asset", "search", "--kind", "pose", "--category", "SIT", "--limit", "5")
    assert code == 0 and body["total"] == 26 and len(body["items"]) == 5 and body["nextOffset"] == 5
    assert body["complete"] is False and body["facets"]["category"] == {"sit": 26}
    assert all(item["shortId"] and Path(item["coverPath"]).is_file() for item in body["items"])
    code, body = run(capsys, "asset", "search", "--kind", "character", "--tag", "female")
    assert [item["name"] for item in body["items"]] == ["Female"] and body["complete"] is True
    code, body = run(capsys, "asset", "search", "zzz-no-such")
    assert code == 0 and body["total"] == 0 and body["items"] == []
    code, body = run(capsys, "asset", "search", "--limit", "0")
    assert code == 2 and body["code"] == "USAGE_INVALID"


def test_asset_show_and_pose_catalog(capsys):
    code, body = run(capsys, "asset", "show", "sit-legs-x-hold")
    assert code == 0 and body["asset"]["id"] == "a3d_pose_sit-legs-x-hold" and Path(body["asset"]["path"]).is_file()
    assert body["asset"]["license"] == "CC-BY-4.0" and body["pose"]["boneCount"] > 0 and "usage" in body
    code, body = run(capsys, "asset", "show", MAN, "--kind", "character")
    assert code == 0 and body["usage"]["change"]["libraryId"] == MAN
    code, body = run(capsys, "asset", "show", MAN, "--kind", "pose")
    assert code == 2 and body["code"] == "ASSET_NOT_FOUND"
    code, body = run(capsys, "pose", "catalog")
    assert code == 0 and body["total"] == 121 and sum(body["categories"].values()) == 121
    code, body = run(capsys, "pose", "catalog", "--category", "lie")
    assert body["total"] == 13 and {item["category"] for item in body["items"]} == {"lie"}


def test_document_get_summary_and_entities(capsys, tmp_path):
    project = tmp_path / "p"
    init_project(project)
    code, body = run(capsys, "document", "get", project, "--summary")
    assert code == 0 and "summary" in body and "document" not in body
    code, body = run(capsys, "document", "get", project, "--entity", "cam-main")
    assert code == 0 and body["entityType"] == "node" and body["entity"]["id"] == "cam-main"
    assert body["entityVersion"] == 1
    code, body = run(capsys, "document", "get", project, "--entity", "fcurves__cam-main")
    assert code == 2 and body["code"] == "DOCUMENT_ENTITY_NOT_FOUND"
    code, body = run(capsys, "document", "get", project, "--summary", "--entity", "cam-main")
    assert code == 2 and body["code"] == "USAGE_INVALID"
    code, body = run(capsys, "document", "get", project)
    assert code == 0 and body["document"]["content"]["nodes"][0]["id"] == "cam-main"


def write_run(project: Path, run_id: str, sequence: int, created: str) -> Path:
    run_dir = project / ".topview-3d" / "renders" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "frame-0.png").write_bytes(PNG)
    (run_dir / "contact-sheet.png").write_bytes(PNG + b"sheet")
    (run_dir / "render.json").write_text(json.dumps({
        "version": 1, "runId": run_id, "createdAt": created, "width": 640, "height": 360,
        "cameraNodeId": "cam-main", "sceneSequence": sequence, "blank": False, "blockedRequests": [],
        "frames": [{"frame": 0, "file": "frame-0.png", "sha256": hashlib.sha256(PNG).hexdigest()}],
        "contactSheet": {"file": "contact-sheet.png", "sha256": hashlib.sha256(PNG + b"sheet").hexdigest()},
    }), encoding="utf-8")
    return run_dir


def test_renders_list_and_show(capsys, tmp_path):
    project = tmp_path / "p"
    init_project(project)
    code, body = run(capsys, "renders", "show", project)
    assert code == 2 and body["code"] == "RENDER_NOT_FOUND"
    write_run(project, "old", 1, "2026-01-01T00:00:00Z")
    latest = write_run(project, "new", 2, "2026-01-02T00:00:00Z")
    (project / ".topview-3d" / "renders" / "junk").mkdir()
    code, body = run(capsys, "renders", "list", project)
    assert code == 0 and [row["runId"] for row in body["runs"]] == ["old", "new"]
    assert [row["stale"] for row in body["runs"]] == [True, False]
    code, body = run(capsys, "renders", "show", project)
    assert code == 0 and body["runId"] == "new" and body["kind"] == "contactSheet" and body["stale"] is False
    assert Path(body["path"]) == (latest / "contact-sheet.png").resolve() and body["sizeBytes"] == len(PNG) + 5
    code, body = run(capsys, "renders", "show", project, "old", "--frame", "0")
    assert code == 0 and body["stale"] is True and body["sha256"] == hashlib.sha256(PNG).hexdigest()
    code, body = run(capsys, "renders", "show", project, "new", "--frame", "9")
    assert code == 2 and body["code"] == "RENDER_NOT_FOUND"
    (latest / "frame-0.png").write_bytes(PNG + b"tampered")
    code, body = run(capsys, "renders", "show", project, "new", "--frame", "0")
    assert code == 1 and body["code"] == "RENDER_IMAGE_INVALID"


def test_camera_presets(capsys, needs_node):
    code, body = run(capsys, "camera", "presets")
    assert code == 0 and "front-medium" in {preset["id"] for preset in body["presets"]}


def test_bom_get_and_checkpoint(capsys, tmp_path):
    project = tmp_path / "p"
    init_project(project)
    code, body = run(capsys, "bom", "get", project)
    assert code == 0 and body["exists"] is False and body["bom"]["bomRevision"] == 0
    assert body["bom"]["observed"]["nodes"][0]["id"] == "cam-main" and body["bom"]["verification"]["stale"] is True
    patch = tmp_path / "patch.json"
    patch.write_text(json.dumps({"expectedSceneSequence": 2, "expectedBomRevision": 0, "intent": "two people talk",
                                 "constraints": [{"id": "c1", "text": "both faces visible"}]}), encoding="utf-8")
    code, body = run(capsys, "bom", "checkpoint", project, patch)
    assert code == 0 and body["bomRevision"] == 1
    stored = json.loads((project / ".topview-3d" / "bom.json").read_text(encoding="utf-8"))
    assert stored["intent"] == "two people talk" and "observed" not in stored
    before = (project / ".topview-3d" / "bom.json").read_bytes()
    code, body = run(capsys, "bom", "checkpoint", project, patch)
    assert code == 1 and body["code"] == "BOM_REVISION_CONFLICT"
    patch.write_text(json.dumps({"expectedSceneSequence": 1, "expectedBomRevision": 1, "notes": []}), encoding="utf-8")
    code, body = run(capsys, "bom", "checkpoint", project, patch)
    assert code == 1 and body["code"] == "SCENE_SEQUENCE_CONFLICT"
    patch.write_text(json.dumps({"expectedSceneSequence": 2, "expectedBomRevision": 1, "bogus": 1}), encoding="utf-8")
    code, body = run(capsys, "bom", "checkpoint", project, patch)
    assert code == 2 and body["code"] == "BOM_CHECKPOINT_INVALID"
    patch.write_text(json.dumps({"expectedSceneSequence": 2, "expectedBomRevision": 1, "modelReview": {
        "views": [{"cameraNodeId": "cam-main", "frames": [0], "status": "passed", "reason": "ok"}],
        "constraints": []}}), encoding="utf-8")
    code, body = run(capsys, "bom", "checkpoint", project, patch)
    assert code == 1 and body["code"] == "BOM_REVIEW_EVIDENCE_MISSING"
    code, body = run(capsys, "bom", "checkpoint", project, tmp_path / "missing.json")
    assert code == 2 and body["code"] == "INPUT_NOT_FOUND"
    assert (project / ".topview-3d" / "bom.json").read_bytes() == before
    (project / ".topview-3d" / "bom.json").write_text("{", encoding="utf-8")
    code, body = run(capsys, "bom", "get", project)
    assert code == 1 and body["code"] == "BOM_JSON_INVALID"
    assert open_project(project).store.scene_sequence == 2

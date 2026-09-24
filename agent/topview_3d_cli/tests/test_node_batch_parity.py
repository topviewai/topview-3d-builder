"""node batch edge cases carried over from the hosted batch tool: schema, preflight, no-ops, geometry.

Intents compile with the real ``apply-intents`` Node command; nothing here needs Chromium.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from topview_3d_cli import local_cli
from topview_3d_cli.director_camera_view import apply_camera_view
from topview_3d_cli.director_document import empty_director_document, node_from_library, normalize_node
from topview_3d_cli.director_geometry import check_primitive_geometry
from topview_3d_cli.local_project import init_project
from topview_3d_cli.runtime import runtime


def primitive(node_id="table"):
    return {"action": "add_primitive", "nodeId": node_id,
            "primitive": {"kind": "BoxGeometry", "parameters": {"width": 2, "height": .2, "depth": 1}},
            "position": {"y": .7}}


def box(node_id, size, position):
    return normalize_node({"id": node_id, "type": "primitive", "primitive": {
        "kind": "BoxGeometry", "parameters": dict(zip(("width", "height", "depth"), size))},
        "transform": {"position": dict(zip("xyz", position))}})


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_BUILTIN_ASSETS", raising=False)
    if not shutil.which("node") or not (runtime().builder_dist / "evaluate/index.mjs").is_file():
        pytest.skip("needs node and a built editor/packages/builder")
    directory = tmp_path / "p"
    init_project(directory)
    return directory


def batch(capsys, tmp_path: Path, project: Path, spec) -> tuple[int, dict]:
    path = tmp_path / "spec.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    code = local_cli.main(["node", "batch", str(project), str(path)])
    captured = capsys.readouterr()
    return code, json.loads(captured.out or captured.err)


def state(project: Path) -> dict[str, bytes]:
    return {path.name: path.read_bytes() for path in (project / ".topview-3d").glob("*.json")}


def test_camera_subject_view_and_conservative_box_geometry():
    doc = empty_director_document()
    hero = node_from_library("characters", {"id": "fixture-person", "name": "Hero", "file": ""}, node_id="hero")
    hero["transform"]["position"] = {"x": 5, "y": 0, "z": 4}
    doc["content"]["nodes"] += [hero, box("base", (2, 2, 2), (0, 1, 0)),
                                box("swallowed", (1, .1, .3), (0, 1.2, 0)), box("floor", (8, .12, 8), (0, -.06, 0))]
    apply_camera_view(doc, "cam-main", {"mode": "subject", "subjectNodeId": "hero",
                                        "offset": {"x": 0, "y": 1.5, "z": 3}, "targetOffset": {"x": 0, "y": 1.5, "z": 0}})
    camera = doc["content"]["nodes"][0]
    assert camera["transform"]["position"] == {"x": 5, "y": 1.5, "z": 7}
    assert camera["camera"]["subject"]["followRotation"] is False
    issues = {(row["code"], row["nodeId"]) for row in check_primitive_geometry(doc)["issues"]}
    assert issues == {("BOX_CONTAINED_IN_BOX", "swallowed"), ("BOX_TOP_COPLANAR_WITH_GROUND", "floor")}


def test_repeat_primitive_world_view_and_position_distance_conflict(tmp_path, capsys, project):
    code, body = batch(capsys, tmp_path, project, {"changes": [{
        "action": "repeat_primitive", "nodeId": "tread", "count": 5,
        "primitive": {"kind": "BoxGeometry", "parameters": {"width": 1, "height": .1, "depth": .3}},
        "position": {"y": .2}, "step": {"x": 0, "y": .2, "z": .3},
    }, {
        "action": "update", "nodeId": "cam-main", "fov": 45,
        "view": {"mode": "world", "position": {"x": 0, "y": 4, "z": 5}, "target": {"x": 0, "y": .6, "z": .6}},
    }]})
    assert code == 0, body
    assert body["changeCount"] == 2 and body["expandedChangeCount"] == 6
    assert body["createdIds"][-1] == "tread_5" and not body["state"]["geometry"]["issues"]
    before = state(project)
    code, body = batch(capsys, tmp_path, project, {"changes": [
        {"action": "update", "nodeId": "cam-main", "position": {"z": 8}, "distance": 3}]})
    assert code == 1 and "POSITION_DISTANCE_CONFLICT" in body["error"]
    assert state(project) == before


@pytest.mark.parametrize("changes", [
    [], [primitive()] * 65,
    [{"action": "upsert", "nodeId": "hero"}],
    [{"action": "update", "nodeId": "hero"}],
    [{"action": "update", "nodeId": "hero", "scale": {"x": 0}}],
    [{"action": "update", "nodeId": "cam-main", "fov": 180}],
    [{**primitive(), "primitive": {"kind": "BoxGeometry", "parameters": {"width": 2}}}],
    [{**primitive(), "projectId": "another-project"}],
    [{"action": "update", "nodeId": "cam-overview", "presetId": "bird-eye", "position": {"x": 0, "y": 14, "z": 0}}],
])
def test_invalid_schema_is_rejected_before_staging(tmp_path, capsys, project, changes):
    before = state(project)
    code, body = batch(capsys, tmp_path, project, {"changes": changes})
    assert (code, body["code"]) == (2, "NODE_BATCH_INVALID"), body
    assert state(project) == before


@pytest.mark.parametrize(("tail", "expected"), [
    ({"action": "update", "nodeId": "missing", "name": "Oops"}, "NODE_NOT_FOUND"),
    ({"action": "update", "nodeId": "table", "fov": 45}, "NODE_TYPE_REQUIRED"),
    ({"action": "add_camera", "nodeId": "cam-main", "presetId": "front-wide"}, "NODE_ALREADY_EXISTS"),
    ({"action": "delete", "nodeId": "cam-main"}, "LAST_CAMERA_REQUIRED"),
    (primitive(), "NODE_ALREADY_EXISTS"),
])
def test_late_failure_leaves_the_project_unchanged(tmp_path, capsys, project, tail, expected):
    before = state(project)
    code, body = batch(capsys, tmp_path, project, {"changes": [primitive(), tail]})
    missing = expected == "NODE_NOT_FOUND"
    assert (code, body["code"]) == ((2, "DIRECTOR_NODE_NOT_FOUND") if missing else (1, "NODE_BATCH_REJECTED")), body
    assert body["details"]["index"] == 1
    assert expected.lower() in json.dumps(body).lower()
    assert state(project) == before


def test_sequence_conflict_and_noop(tmp_path, capsys, project):
    before = state(project)
    code, body = batch(capsys, tmp_path, project, {"expectedSceneSequence": 1, "changes": [primitive()]})
    assert (code, body["code"]) == (1, "SCENE_SEQUENCE_CONFLICT")
    fov = json.loads((project / ".topview-3d" / "document.json").read_text())["content"]["nodes"][0]["camera"]["fov"]
    code, body = batch(capsys, tmp_path, project, {"expectedSceneSequence": 2, "changes": [
        {"action": "update", "nodeId": "cam-main", "fov": fov}]})
    assert code == 0 and body["operationCount"] == 0, body
    assert state(project) == before

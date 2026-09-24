"""node batch, pose batch, evaluate, inspect nodes/views.

Pure-Node renderer commands (apply-intents, evaluate) run for real; Chromium commands are faked.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from topview_3d_cli import local_cli
from topview_3d_cli.local_project import init_project, open_project
from topview_3d_cli.runtime import runtime

MAN = "a3d_char_7d220ac359844c80a8faaf0e25478477"
PNG = b"\x89PNG\r\n\x1a\n" + b"\1" * 300
BOX = {"kind": "BoxGeometry", "parameters": {"width": 1, "height": 1, "depth": 1}}
REAL_RUN = subprocess.run


def run(capsys, *argv):
    code = local_cli.main([str(item) for item in argv])
    captured = capsys.readouterr()
    return code, json.loads(captured.out or captured.err)


@pytest.fixture(autouse=True)
def environment(monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_BUILTIN_ASSETS", raising=False)
    if not shutil.which("node") or not (runtime().builder_dist / "evaluate/index.mjs").is_file():
        pytest.skip("needs node and a built editor/packages/builder")


def fake_chromium(monkeypatch, handlers):
    """Route Chromium-backed director-cli commands to ``handlers``; everything else runs for real."""
    calls = []

    def fake_run(argv, **kwargs):
        command = argv[2] if len(argv) > 2 else None
        if command in handlers:
            body = json.loads(Path(argv[-1]).read_text(encoding="utf-8"))
            calls.append((command, body))
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(handlers[command](body)), stderr="")
        return REAL_RUN(argv, **kwargs)

    monkeypatch.setattr(local_cli.subprocess, "run", fake_run)
    return calls


def write_json(path: Path, value) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def state_bytes(project: Path) -> dict[str, bytes]:
    return {path.name: path.read_bytes() for path in (project / ".topview-3d").glob("*.json")}


@pytest.fixture
def scene(tmp_path, capsys):
    project = tmp_path / "p"
    init_project(project)
    spec = write_json(tmp_path / "scene.json", {"changes": [
        {"action": "add_library", "nodeId": "man", "kind": "characters", "libraryId": MAN},
        {"action": "add_primitive", "nodeId": "box", "primitive": BOX, "position": {"x": 1.5, "y": 0.5, "z": 0}},
        {"action": "add_camera", "nodeId": "cam-man", "presetId": "front-medium", "subjectNodeId": "man"},
    ]})
    code, body = run(capsys, "node", "batch", project, spec)
    assert code == 0, body
    return project


def test_node_batch_creates_updates_and_reports_state(tmp_path, capsys, scene):
    nodes = {node["id"]: node for node in open_project(scene).store.assemble()["document"]["content"]["nodes"]}
    assert nodes["man"]["metadata"]["assetId"] == MAN and nodes["man"]["metadata"]["modelUrl"].endswith(".glb")
    assert nodes["cam-man"]["camera"]["subject"]["nodeId"] == "man"
    spec = write_json(tmp_path / "edit.json", {"expectedSceneSequence": 5, "changes": [
        {"action": "update", "nodeId": "box", "position": {"x": 2}, "name": "Crate"},
        {"action": "update", "nodeId": "cam-main", "fov": 35},
        {"action": "update", "nodeId": "cam-main", "view": {
            "mode": "world", "position": {"x": 4, "y": 2, "z": 4}, "target": {"x": 0, "y": 1, "z": 0}}},
        {"action": "repeat_primitive", "nodeId": "post", "primitive": BOX, "count": 2, "step": {"x": 1, "y": 0, "z": 0}},
        {"action": "delete", "nodeId": "cam-man"},
    ]})
    before = state_bytes(scene)
    code, body = run(capsys, "node", "batch", scene, spec, "--dry-run")
    assert code == 0 and body["dryRun"] is True and state_bytes(scene) == before
    assert body["createdIds"] == ["post_1", "post_2"] and body["deletedIds"] == ["cam-man"]
    code, body = run(capsys, "node", "batch", scene, spec)
    assert code == 0 and body["sceneSequence"] == 5 + body["operationCount"]
    assert {"box", "cam-main"} <= set(body["updatedIds"]) and body["expandedChangeCount"] == 6
    rows = {row["nodeId"]: row for row in body["state"]["nodes"]}
    assert rows["box"]["name"] == "Crate" and rows["box"]["transform"]["position"]["x"] == 2
    assert rows["cam-main"]["camera"]["fov"] == 35 and "geometry" in body["state"]
    assert rows["cam-main"]["transform"]["position"] == {"x": 4, "y": 2, "z": 4}
    assert "cam-man" not in {node["id"] for node in open_project(scene).store.assemble()["document"]["content"]["nodes"]}


def test_node_batch_rejects_without_writing(tmp_path, capsys, scene):
    before = state_bytes(scene)
    cases = [
        ({"changes": [{"action": "update", "nodeId": "ghost", "position": {"x": 1}}]}, 2, "DIRECTOR_NODE_NOT_FOUND"),
        ({"changes": [{"action": "add_primitive", "nodeId": "box", "primitive": BOX}]}, 1, "NODE_BATCH_REJECTED"),
        ({"changes": [{"action": "add_library", "nodeId": "x", "kind": "props", "libraryId": "nope"}]},
         2, "ASSET_NOT_FOUND"),
        ({"changes": [{"action": "update", "nodeId": "box", "position": {"x": 3}},
                      {"action": "update", "nodeId": "box", "fov": 40}]}, 1, "NODE_BATCH_REJECTED"),
        ({"changes": [{"action": "update", "nodeId": "box"}]}, 2, "NODE_BATCH_INVALID"),
        ({"changes": [{"action": "teleport", "nodeId": "box"}]}, 2, "NODE_BATCH_INVALID"),
        ({"expectedSceneSequence": 1, "changes": [{"action": "delete", "nodeId": "box"}]}, 1,
         "SCENE_SEQUENCE_CONFLICT"),
    ]
    for index, (spec, exit_code, error) in enumerate(cases):
        code, body = run(capsys, "node", "batch", scene, write_json(tmp_path / f"bad{index}.json", spec))
        assert (code, body["code"]) == (exit_code, error), (spec, body)
    code, body = run(capsys, "node", "batch", scene, write_json(tmp_path / "bad3.json", cases[3][0]))
    assert body["details"]["index"] == 1 and body["details"]["nodeId"] == "box"
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    assert run(capsys, "node", "batch", scene, tmp_path / "broken.json")[1]["code"] == "NODE_BATCH_INVALID"
    assert run(capsys, "node", "batch", scene, tmp_path / "missing.json")[1]["code"] == "INPUT_NOT_FOUND"
    assert state_bytes(scene) == before


def test_evaluate_scene_and_unsaved_plans(tmp_path, capsys, scene):
    before = state_bytes(scene)
    code, body = run(capsys, "evaluate", scene, "--frames", "0,12", "--camera", "cam-man")
    assert code == 0 and body["plan"] is None and body["persisted"] is False and body["frames"] == [0, 12]
    assert body["cameraNodeId"] == "cam-man" and body["evaluation"]["ok"] is True
    plan = write_json(tmp_path / "plan.json", {"changes": [
        {"action": "update", "nodeId": "box", "position": {"y": -3}}]})
    code, body = run(capsys, "evaluate", scene, plan)
    assert code == 0 and body["plan"] == "changes"
    assert "ORIGIN_BELOW_GROUND" in {issue["code"] for issue in body["evaluation"]["issues"]}
    box = next(node for node in open_project(scene).store.assemble()["document"]["content"]["nodes"]
               if node["id"] == "box")
    box["transform"]["position"]["y"] = -3
    plan = write_json(tmp_path / "ops.json", {"operations": [
        {"kind": "director.node.upsert", "entityId": "box", "payload": {"node": box}}]})
    code, body = run(capsys, "evaluate", scene, plan)
    assert code == 0 and body["plan"] == "operations" and body["evaluation"]["issues"]
    assert state_bytes(scene) == before
    for spec in ({"changes": [], "operations": []}, {"steps": []}):
        code, body = run(capsys, "evaluate", scene, write_json(tmp_path / "bad.json", spec))
        assert (code, body["code"]) == (2, "PLAN_INVALID")
    assert run(capsys, "evaluate", scene, "--camera", "box")[1]["code"] == "CAMERA_REQUIRED"
    assert run(capsys, "evaluate", scene, "--frames", "a")[1]["code"] == "USAGE_INVALID"


def test_inspect_nodes_derives_grounding_and_pairs(capsys, monkeypatch, scene):
    def measure(body):
        assert body["nodeIds"] == ["man", "box"] and MAN in "".join(body["localAssets"])
        return {"ok": True, "warnings": [], "blockedRequests": [], "nodes": [
            {"nodeId": "man", "type": "character", "status": "measured", "size": {"x": 0.5, "y": 1.8, "z": 0.3},
             "bounds": {"min": {"x": -0.25, "y": 0.1, "z": -0.15}, "max": {"x": 0.25, "y": 1.9, "z": 0.15}},
             "origin": {"x": 0, "y": 0, "z": 0}},
            {"nodeId": "box", "type": "primitive", "status": "measured", "size": {"x": 1, "y": 1, "z": 1},
             "bounds": {"min": {"x": 0.3, "y": -0.01, "z": -0.5}, "max": {"x": 1.3, "y": 0.99, "z": 0.5}},
             "origin": {"x": 0.5, "y": 0.5, "z": 0}}]}

    calls = fake_chromium(monkeypatch, {"inspect-nodes": measure})
    code, body = run(capsys, "inspect", "nodes", scene, "man", "box", "--frame", "3")
    assert code == 0 and calls[0][1]["frames"] == [3]
    grounding = {row["nodeId"]: row["grounding"]["status"] for row in body["nodes"]}
    assert grounding == {"man": "floating", "box": "grounded"}
    (pair,) = body["pairs"]
    assert pair["nodeIds"] == ["man", "box"] and pair["boundsIntersect"] is False and pair["boundsGap"] == 0.05
    code, body = run(capsys, "inspect", "nodes", scene, "ghost")
    assert (code, body["code"]) == (2, "DIRECTOR_NODE_NOT_FOUND")


def test_pose_batch_compiles_and_patches(tmp_path, capsys, monkeypatch, scene):
    animation = {"mode": "pose", "posePresetId": "sit-legs-x-hold", "controlValues": {}}
    calls = fake_chromium(monkeypatch, {"apply-library-poses": lambda body: {
        "results": [{"animation": animation, "pose": {"bones": len(item["pose"]["bones"])}} for item in body["items"]]}})
    spec = write_json(tmp_path / "pose.json", {"items": [
        {"nodeId": "man", "poseId": "sit-legs-x-hold", "rotation": {"y": 30}}]})
    code, body = run(capsys, "pose", "batch", scene, spec)
    assert code == 0 and body["poses"][0]["poseId"] == "a3d_pose_sit-legs-x-hold" and body["updatedIds"] == ["man"]
    assert calls[0][1]["items"][0]["libraryId"] == "a3d_pose_sit-legs-x-hold"
    man = next(node for node in open_project(scene).store.assemble()["document"]["content"]["nodes"]
               if node["id"] == "man")
    assert man["character"]["animation"] == animation and man["transform"]["rotation"]["y"] == 30
    before = state_bytes(scene)
    for index, (items, exit_code, error) in enumerate([
        ([{"nodeId": "man", "poseId": "sit-legs-x-hold"}, {"nodeId": "man", "poseId": "sit-legs-x-hold"}],
         2, "POSE_BATCH_INVALID"),
        ([{"nodeId": "box", "poseId": "sit-legs-x-hold"}], 2, "POSE_TARGET_INVALID"),
        ([{"nodeId": "man", "poseId": "nope"}], 2, "ASSET_NOT_FOUND"),
        ([{"nodeId": "ghost", "poseId": "sit-legs-x-hold"}], 2, "DIRECTOR_NODE_NOT_FOUND"),
    ]):
        code, body = run(capsys, "pose", "batch", scene, write_json(tmp_path / f"p{index}.json", {"items": items}))
        assert (code, body["code"]) == (exit_code, error)
    assert state_bytes(scene) == before and len(calls) == 1


def test_pose_batch_refuses_characters_with_motion(tmp_path, capsys, monkeypatch, scene):
    fake_chromium(monkeypatch, {"apply-library-poses": lambda body: pytest.fail("must not compile")})
    clip = {"id": "walk", "source": "library", "sourceDuration": 1, "frameStart": 0, "frameEnd": 24,
            "target": {"type": "character", "nodeId": "man"},
            "playback": {"version": 1, "speed": 1, "loop": True, "loopMode": "repeat"},
            "motion": {"assetId": "a3d_motion_walk", "name": "Walk", "source": "library", "sourceRig": "mixamorig",
                       "url": "3d-builder/library/motions/walk.fbx", "inPlace": True, "loop": True, "speed": 1,
                       "time": 0}}
    ops = write_json(tmp_path / "clip.json", [{"kind": "director.clip.upsert", "entityId": "walk",
                                               "payload": {"clipKind": "motion", "clip": clip}}])
    assert run(capsys, "document", "apply", scene, ops)[0] == 0
    spec = write_json(tmp_path / "pose.json", {"items": [{"nodeId": "man", "libraryId": "a3d_pose_sit-legs-x-hold"}]})
    code, body = run(capsys, "pose", "batch", scene, spec)
    assert (code, body["code"]) == (1, "POSE_BATCH_REJECTED") and body["details"]["nodeId"] == "man"


def fake_render(body):
    output = Path(body["outputDir"])
    output.mkdir(parents=True)
    frames = []
    for frame in body["frames"]:
        (output / f"frame-{frame}.png").write_bytes(PNG + bytes([frame]))
        frames.append({"frame": frame, "path": str(output / f"frame-{frame}.png"), "sizeBytes": len(PNG) + 1,
                       "sha256": hashlib.sha256(PNG + bytes([frame])).hexdigest()})
    (output / "contact-sheet.png").write_bytes(PNG)
    sheet = {"path": str(output / "contact-sheet.png"), "sizeBytes": len(PNG), "sha256": hashlib.sha256(PNG).hexdigest()}
    (output / "render.json").write_text(json.dumps({
        "version": 1, "runId": output.name, "createdAt": "2026-01-01T00:00:00Z", "cameraNodeId": body["cameraNodeId"],
        "sceneSequence": body["sceneSequence"], "blank": False, "blockedRequests": [],
        "frames": [{"frame": row["frame"], "file": Path(row["path"]).name, "sha256": row["sha256"]} for row in frames],
        "contactSheet": {"file": "contact-sheet.png", "sha256": sheet["sha256"]}}), encoding="utf-8")
    return {"outputDir": str(output), "cameraNodeId": body["cameraNodeId"], "sceneSequence": body["sceneSequence"],
            "frames": frames, "contactSheet": sheet, "blank": False, "blockedRequests": [],
            "warnings": ["GL Driver Message (OpenGL, Performance): GPU stall due to ReadPixels"]}


def mesh_bounds(low_y, high_y=1.8):
    def measure(body):
        return {"ok": True, "warnings": [], "blockedRequests": [], "nodes": [
            {"nodeId": node_id, "type": "character", "status": "measured",
             "bounds": {"min": {"x": -0.25, "y": low_y, "z": -0.15}, "max": {"x": 0.25, "y": high_y, "z": 0.15}}}
            for node_id in body["nodeIds"]]}
    return measure


def test_inspect_views_renders_records_bom_and_allows_review(tmp_path, capsys, monkeypatch, scene):
    calls = fake_chromium(monkeypatch, {"render-frames": fake_render, "inspect-nodes": mesh_bounds(0)})
    code, body = run(capsys, "inspect", "views", scene, "--camera", "cam-man", "--camera", "cam-main",
                     "--frames", "0,10", "--primary", "cam-man")
    renders = [call[1]["cameraNodeId"] for call in calls if call[0] == "render-frames"]
    assert code == 0 and renders == ["cam-man", "cam-main"]
    assert [call[1]["frames"] for call in calls if call[0] == "inspect-nodes"] == [[0], [10]]
    assert body["checksComplete"] is True and body["checksBlockedBy"] == []
    assert body["measurement"] == "character meshes" and [row["renderStatus"] for row in body["views"]] == ["complete"] * 2
    assert body["primaryStoryPreview"]["cameraNodeId"] == "cam-man" and Path(body["primaryStoryPreview"]["path"]).is_file()
    run_id = body["views"][0]["render"]["runId"]
    code, shown = run(capsys, "renders", "show", scene, run_id, "--frame", "10")
    assert code == 0 and shown["cameraNodeId"] == "cam-man" and shown["stale"] is False
    code, bom = run(capsys, "bom", "get", scene)
    verification = bom["bom"]["verification"]
    assert verification["stale"] is False and {row["cameraNodeId"] for row in verification["views"]} == {"cam-man", "cam-main"}
    review = write_json(tmp_path / "review.json", {
        "expectedSceneSequence": body["sceneSequence"], "expectedBomRevision": 0, "modelReview": {
            "views": [{"cameraNodeId": "cam-man", "frames": [0, 10], "status": "passed", "reason": "ok"}],
            "constraints": []}})
    code, merged = run(capsys, "bom", "checkpoint", scene, review)
    assert code == 0 and merged["bom"]["modelReview"]["views"][0]["sha256"] == hashlib.sha256(PNG).hexdigest()


def test_inspect_views_judges_characters_by_their_posed_mesh(tmp_path, capsys, monkeypatch, scene):
    sunk = write_json(tmp_path / "sink.json", {"changes": [
        {"action": "update", "nodeId": "man", "position": {"y": -0.9}}]})
    assert run(capsys, "node", "batch", scene, sunk)[0] == 0
    code, body = run(capsys, "evaluate", scene, "--camera", "cam-man")
    assert "ORIGIN_BELOW_GROUND" in {issue["code"] for issue in body["evaluation"]["issues"]}
    fake_chromium(monkeypatch, {"render-frames": fake_render, "inspect-nodes": mesh_bounds(0.0, 1.0)})
    code, body = run(capsys, "inspect", "views", scene, "--camera", "cam-man")
    assert code == 0 and body["checksComplete"] is True, body["checksBlockedBy"]
    assert not body["views"][0]["numerical"]["issues"]
    fake_chromium(monkeypatch, {"render-frames": fake_render, "inspect-nodes": mesh_bounds(-0.3, 1.0)})
    code, body = run(capsys, "inspect", "views", scene, "--camera", "cam-man")
    assert body["checksComplete"] is False and body["checksBlockedBy"] == ["cam-man: MESH_BELOW_GROUND man"]


def test_inspect_views_does_not_block_on_other_nodes_leaving_a_close_shot(tmp_path, capsys, monkeypatch, scene):
    far = write_json(tmp_path / "far.json", {"changes": [
        {"action": "update", "nodeId": "box", "position": {"x": 40, "z": 40}}]})
    assert run(capsys, "node", "batch", scene, far)[0] == 0
    fake_chromium(monkeypatch, {"render-frames": fake_render, "inspect-nodes": mesh_bounds(0)})
    code, body = run(capsys, "inspect", "views", scene, "--camera", "cam-man")
    assert {"code": "ORIGIN_OUTSIDE_FRUSTUM", "severity": "warning", "nodeIds": ["box"]} in \
        body["views"][0]["numerical"]["issues"] or \
        "box" in "".join(str(issue) for issue in body["views"][0]["numerical"]["issues"])
    assert body["checksComplete"] is True, body["checksBlockedBy"]


def test_inspect_views_rejects_bad_specs(tmp_path, capsys, monkeypatch, scene):
    fake_chromium(monkeypatch, {"render-frames": lambda body: pytest.fail("must not render")})
    cases = [
        (("--camera", "box"), 2, "CAMERA_REQUIRED"),
        (("--camera", "ghost"), 2, "CAMERA_NOT_FOUND"),
        (("--camera", "cam-main", "--primary", "cam-man"), 2, "VIEWS_INVALID"),
        (("--frames", "0,1,2,3"), 2, "VIEWS_INVALID"),
    ]
    for argv, exit_code, error in cases:
        code, body = run(capsys, "inspect", "views", scene, *argv)
        assert (code, body["code"]) == (exit_code, error), argv
    spec = write_json(tmp_path / "views.json", {"expectedSceneSequence": 0, "views": [
        {"cameraNodeId": "cam-main", "frames": [0]}]})
    assert run(capsys, "inspect", "views", scene, spec)[1]["code"] == "SCENE_SEQUENCE_CONFLICT"
    assert run(capsys, "inspect", "views", scene, spec, "--camera", "cam-main")[1]["code"] == "USAGE_INVALID"
    assert not (scene / ".topview-3d" / "bom.json").exists()


def test_pair_overlap():
    from topview_3d_cli.local_inspect import _pair

    def box(node_id, low, high):
        return {"nodeId": node_id, "bounds": {"min": dict(zip("xyz", low)), "max": dict(zip("xyz", high))},
                "origin": dict(zip("xyz", ((a + b) / 2 for a, b in zip(low, high))))}
    pair = _pair(box("a", (0, 0, 0), (1, 1, 1)), box("b", (0.5, 0.5, 0.9), (2, 2, 2)))
    assert pair["boundsIntersect"] is True and pair["overlapSize"] == {"x": 0.5, "y": 0.5, "z": 0.1}
    assert pair["boundsGap"] == 0

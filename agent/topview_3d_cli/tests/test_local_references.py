"""Reference checks, sequence guards, exit codes and error details added on top of the shared engine."""
from __future__ import annotations

import json
import subprocess

import pytest

from topview_3d_cli import local_cli, renderer
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import commit, init_project, open_project
from topview_3d_cli.tests.test_local_cli import box, camera_clip, run, state_bytes, upsert, write_ops


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "scene"
    init_project(root)
    return root


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def motion_clip(node_id):
    return {"operationId": "clip", "entityId": "orbit", "kind": "director.clip.upsert",
            "payload": {"clipKind": "cameraMotion", "clip": camera_clip("orbit", node_id)}}


def test_apply_refuses_new_dangling_references(capsys, project, tmp_path):
    before = state_bytes(project)
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [motion_clip("ghost")]))
    assert (code, body["code"]) == (2, "DANGLING_REFERENCE"), body
    assert body["details"]["danglingReferences"][0]["ref"] == "ghost"
    assert state_bytes(project) == before
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [motion_clip("cam-main")]))
    assert code == 0, body


def test_validate_fails_on_dangling_references_already_stored(capsys, project, tmp_path):
    opened = open_project(project)
    opened.store.apply([motion_clip("ghost")], strict_versions=False, batch_id="legacy")
    commit(opened)
    code, body = run(capsys, "document", "validate", project)
    assert (code, body["code"]) == (1, "DOCUMENT_INVALID") and body["details"]["danglingReferences"]
    code, body = run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]))
    assert code == 0, "an existing dangling reference must not block unrelated edits"


def test_apply_checks_expected_scene_sequence(capsys, project, tmp_path):
    before = state_bytes(project)
    stale = write_json(tmp_path / "stale.json", {"expectedSceneSequence": 1, "operations": [upsert(box())]})
    code, body = run(capsys, "document", "apply", project, stale)
    assert (code, body["code"]) == (1, "SCENE_SEQUENCE_CONFLICT")
    assert body["details"] == {"expected": 1, "current": 2} and state_bytes(project) == before
    current = write_json(tmp_path / "current.json", {"expectedSceneSequence": 2, "operations": [upsert(box())]})
    assert run(capsys, "document", "apply", project, current)[0] == 0
    bad = write_json(tmp_path / "bad.json", {"expectedSceneSequence": "2", "operations": [upsert(box())]})
    assert run(capsys, "document", "apply", project, bad)[1]["code"] == "OPERATIONS_JSON_INVALID"


def test_missing_references_are_input_errors(capsys, project, tmp_path):
    delete = {"operationId": "d", "kind": "director.node.delete", "entityId": "ghost", "payload": {}}
    assert run(capsys, "document", "apply", project, write_ops(tmp_path, [delete]))[0] == 2
    assert run(capsys, "node", "delete", project, "ghost")[0] == 2
    code, body = run(capsys, "node", "batch", project, write_json(tmp_path / "b.json", {"changes": [
        {"action": "add_library", "nodeId": "x", "kind": "props", "libraryId": "nope"}]}))
    assert (code, body["code"]) == (2, "ASSET_NOT_FOUND") and body["details"]["index"] == 0


def test_render_checks_the_camera_before_starting_the_renderer(capsys, project, tmp_path, monkeypatch):
    monkeypatch.setattr(local_cli.subprocess, "run", lambda *a, **k: pytest.fail("renderer must not start"))
    for camera, error in (("ghost", "CAMERA_NOT_FOUND"), ("box-1", "CAMERA_REQUIRED")):
        assert run(capsys, "document", "apply", project, write_ops(tmp_path, [upsert(box())]))[0] == 0
        payload = write_json(tmp_path / "render.json", {"cameraNodeId": camera})
        code, body = run(capsys, "render", project, payload)
        assert (code, body["code"]) == (2, error) and body["details"]["cameraNodeId"] == camera


def test_renderer_failure_keeps_the_stack_out_of_the_message(monkeypatch):
    stderr = ("/runtime/director-cli/render.mjs:40\n    throw new Error('boom')\n\n"
              "Error: DIRECTOR_CAMERA_REQUIRED\n    at render (/runtime/render.mjs:40:11)\n")
    monkeypatch.setattr(renderer.subprocess, "run",
                        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, stdout="", stderr=stderr))
    with pytest.raises(LocalProjectError) as caught:
        renderer.director_cli("render-frames", {})
    assert caught.value.code == "RENDER_FAILED" and str(caught.value) == "DIRECTOR_CAMERA_REQUIRED"
    assert "at render" in caught.value.details["stderr"]


def test_render_drops_benign_console_warnings(capsys, project, monkeypatch):
    def fake(argv, **kwargs):
        body = json.loads(open(argv[-1], encoding="utf-8").read())
        return subprocess.CompletedProcess(argv, 0, stderr="", stdout=json.dumps({
            "outputDir": body["outputDir"], "frames": [], "warnings": [
                "Mediabunny was loaded twice. This will likely cause Mediabunny not to work correctly.",
                "real warning"]}))
    monkeypatch.setattr(local_cli.subprocess, "run", fake)
    code, body = run(capsys, "render", project)
    assert code == 0 and body["result"]["warnings"] == ["real warning"]


def test_primitive_schema_errors_name_the_kind_and_field(capsys, project, tmp_path):
    spec = write_json(tmp_path / "b.json", {"changes": [{"action": "add_primitive", "nodeId": "b", "primitive": {
        "kind": "SphereGeometry", "parameters": {"width": 1}}}]})
    code, body = run(capsys, "node", "batch", project, spec)
    assert (code, body["code"]) == (2, "NODE_BATCH_INVALID")
    assert "changes.0.primitive.parameters" in body["error"] and "SphereGeometry" in body["error"]


def test_node_batch_state_reports_primitive_sizes(capsys, project, tmp_path):
    spec = write_json(tmp_path / "b.json", {"changes": [{"action": "add_primitive", "nodeId": "b", "primitive": {
        "kind": "CylinderGeometry", "parameters": {"radiusTop": 0.5, "radiusBottom": 0.5, "height": 2}},
        "scale": {"x": 2}}]})
    code, body = run(capsys, "node", "batch", project, spec)
    assert code == 0, body
    (row,) = [row for row in body["state"]["nodes"] if row.get("nodeId", row.get("id")) == "b"]
    assert row["primitive"]["kind"] == "CylinderGeometry"
    assert row["primitive"]["size"] == {"x": 2.0, "y": 2, "z": 1}


def test_pose_batch_errors_carry_the_item_index(capsys, project, tmp_path):
    spec = write_json(tmp_path / "p.json", {"items": [{"nodeId": "cam-main", "poseId": "sit-legs-x-hold"},
                                                      {"nodeId": "ghost", "poseId": "sit-legs-x-hold"}]})
    code, body = run(capsys, "pose", "batch", project, spec)
    assert (code, body["code"], body["details"]["index"]) == (2, "POSE_TARGET_INVALID", 0)
    spec = write_json(tmp_path / "p.json", {"items": [{"nodeId": "ghost", "poseId": "sit-legs-x-hold"}]})
    code, body = run(capsys, "pose", "batch", project, spec)
    assert (code, body["code"], body["details"]["index"]) == (2, "DIRECTOR_NODE_NOT_FOUND", 0)
    spec = write_json(tmp_path / "p.json", {"items": [{"nodeId": "cam-main", "poseId": "x"}, {"nodeId": 3}]})
    code, body = run(capsys, "pose", "batch", project, spec)
    assert (code, body["code"], body["details"]["index"]) == (2, "POSE_BATCH_INVALID", 1)


def checkpoint(tmp_path, **fields):
    return write_json(tmp_path / "cp.json", {"expectedSceneSequence": 2, "expectedBomRevision": 0, **fields})


def test_bom_checkpoint_sets_updated_at_and_hides_guides_read(capsys, project, tmp_path):
    code, body = run(capsys, "bom", "checkpoint", project, checkpoint(tmp_path, intent="walk"))
    assert code == 0 and body["bom"]["updatedAt"] and "guidesRead" not in body["bom"]
    stored = json.loads((project / ".topview3d" / "bom.json").read_text(encoding="utf-8"))
    assert stored["updatedAt"] == body["bom"]["updatedAt"]
    assert "guidesRead" not in run(capsys, "bom", "get", project)[1]["bom"]


def test_bom_checkpoint_rejects_references_to_missing_nodes(capsys, project, tmp_path):
    for field, entry, key in (
        ("relationships", {"id": "r1", "subjectId": "ghost", "targetId": "cam-main", "relation": "faces"}, "subjectId"),
        ("cameras", {"id": "c1", "nodeId": "ghost", "role": "story"}, "nodeId"),
    ):
        code, body = run(capsys, "bom", "checkpoint", project, checkpoint(tmp_path, **{field: [entry]}))
        assert (code, body["code"]) == (2, "DIRECTOR_NODE_NOT_FOUND"), body
        assert body["details"] == {"field": field, "index": 0, "id": entry["id"], "property": key, "ref": "ghost"}
    assert not (project / ".topview3d" / "bom.json").exists()


def test_review_without_evidence_names_both_sequences(capsys, project, tmp_path):
    review = {"views": [{"cameraNodeId": "cam-main", "frames": [0], "status": "passed", "reason": "ok"}],
              "constraints": []}
    code, body = run(capsys, "bom", "checkpoint", project, checkpoint(tmp_path, modelReview=review))
    assert (code, body["code"]) == (1, "BOM_REVIEW_EVIDENCE_MISSING")
    assert body["details"] == {"evidenceSceneSequence": None, "currentSceneSequence": 2, "evidenceStale": True}
    assert "rerun `inspect views`" in body["error"]

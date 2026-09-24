import json
from pathlib import Path

import pytest

from topview_3d_cli.director_document import (
    SCENE3D_OP_ID,
    SCHEMA_PATH,
    apply_scene_set,
    empty_director_document,
    new_scene_operation_id,
    node_from_library,
    normalize_node,
    prepare_put_document,
    stored_evaluate_body,
    summarize_evaluate_frames,
    validate_director_document,
)

FIXTURE = Path(__file__).resolve().parents[1] / "contracts/director-v1/fixtures/document.json"


def test_schema_path_is_repo_contracts_file():
    assert SCHEMA_PATH.is_file()
    assert SCHEMA_PATH.name == "director-document.schema.json"
    assert SCHEMA_PATH.as_posix().endswith(
        "topview_3d_cli/contracts/director-v1/schema/director-document.schema.json"
    )


def test_empty_document_is_schema_valid():
    validate_director_document(empty_director_document())


def test_fixture_document_is_unchanged_by_normalize():
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    prepared = prepare_put_document(raw)
    assert prepared["content"]["nodes"][1]["character"]["animation"]["posePresetId"] == "stand"
    validate_director_document(prepared)


def test_agent_skeleton_node_is_filled_to_studio_shape():
    node = normalize_node({
        "id": "female-1",
        "type": "character",
        "asset": {"id": "a3d_char_30ec53c93eae4173946b38639691ebe0", "file": "3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb"},
        "transform": {"position": [0.4, 0, 2.2], "rotation": {"x": 0, "y": 180, "z": 0}},
    })
    assert node["name"] == "female-1"
    assert node["visible"] is True
    assert node["locked"] is False
    assert "asset" not in node
    assert node["metadata"]["modelUrl"] == "3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb"
    assert node["transform"]["position"] == {"x": 0.4, "y": 0.0, "z": 2.2}
    assert node["character"]["appearance"]["color"]
    document = empty_director_document()
    document["content"]["nodes"].append(node)
    validate_director_document(document)


def test_incomplete_camera_gets_full_lens_block():
    node = normalize_node({
        "id": "cam-main",
        "type": "camera",
        "transform": {"position": {"x": 0, "y": 2, "z": -6}},
        "camera": {"fov": 50},
    })
    assert node["camera"]["projection"] == "perspective"
    assert node["camera"]["lookAt"]["y"] == 1.2
    assert node["visible"] is True


def test_library_node_uses_catalog_name_and_file():
    node = node_from_library(
        "props",
        {"id": "volleyball", "name": "排球", "file": "3d-builder/public/props/volleyball.glb",
         "category": "sport"},
        node_id="volleyball-01",
    )
    assert node["name"] == "排球"
    assert node["prop"]["category"] == "sport"
    assert node["metadata"]["assetId"] == "volleyball"


def test_scene_set_misplaced_root_fields_do_not_wipe_version():
    current = empty_director_document()
    current["content"]["nodes"].append(normalize_node({
        "id": "person-1",
        "type": "character",
        "metadata": {"modelUrl": "3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb"},
    }))
    updated = apply_scene_set(current, {
        "type": "biz/scene3d-director-document",
        "aspectRatio": "16:9",
        "environment": {
            "background": {"mode": "color", "skyColor": "#7EC8F0"},
            "display": {
                "characterLabelsVisible": False,
                "groundVisible": True,
                "groundHeight": 0,
                "groundOpacity": 1,
            },
        },
    })
    validate_director_document(updated)
    assert updated["content"]["version"] == 1
    assert updated["content"]["environment"]["background"]["skyColor"] == "#7EC8F0"
    assert any(node["id"] == "person-1" for node in updated["content"]["nodes"])


def test_scene_set_rejects_nodes():
    with pytest.raises(ValueError, match="cannot include nodes"):
        apply_scene_set(empty_director_document(), {
            "content": {"version": 1, "nodes": [{"id": "x"}]},
        })


def test_evaluate_body_uses_stored_document_not_caller_stub():
    current = empty_director_document()
    current["content"]["timeline"]["animation"]["cameraMotionClips"] = [{
        "id": "cam-orbit-1",
        "target": {"type": "node", "nodeId": "cam-main"},
        "frameStart": 0,
        "frameEnd": 48,
        "trimStartMs": 0,
        "trimEndMs": 2000,
        "playback": {"version": 1, "speed": 1, "loop": False, "loopMode": "ping-pong", "baseDurationFrames": 48},
        "motion": {
            "id": "m1",
            "version": 1,
            "presetId": "ascending_orbit",
            "label": "上升环绕",
            "timeUnit": "millisecond",
            "durationMs": 2000,
            "curves": [{
                "id": "c1",
                "group": "position",
                "dataPath": "location",
                "arrayIndex": 0,
                "extrapolation": "constant",
                "keyframes": [{"id": "k1", "time": 0, "value": 1, "interpolation": "linear"}],
            }],
        },
    }]
    body = stored_evaluate_body(
        {"document": current, "fcurves": {"version": 1, "encoding": "wrong"}},
        [0, 24],
    )
    assert body["frames"] == [0, 24]
    assert "fcurves" not in body
    clips = body["document"]["content"]["timeline"]["animation"]["cameraMotionClips"]
    assert clips[0]["motion"]["curves"][0]["id"] == "c1"


def test_summarize_evaluate_frames_keeps_qa_drops_poses():
    summary = summarize_evaluate_frames({
        "ok": True,
        "issues": ["palm1 is not in frustum"],
        "schemaVersion": 2,
        "frames": [{
            "frame": 0,
            "groundPenetration": False,
            "clipOverlap": False,
            "inFrustum": True,
            "note": "woman visible",
            "camera": {"position": {"x": 0, "y": 1.8, "z": 5}, "lookAt": {"x": 0, "y": 1, "z": 0}},
            "lookAt": {"x": 0, "y": 1, "z": 0},
            "visibility": {"inFrustum": True, "position": {"x": 1, "y": 0, "z": 0}},
        }],
    })
    assert summary["ok"] is True
    assert summary["issues"] == ["palm1 is not in frustum"]
    assert summary["schemaVersion"] == 2
    assert summary["frames"] == [{
        "frame": 0,
        "groundPenetration": False,
        "clipOverlap": False,
        "inFrustum": True,
        "note": "woman visible",
        "visibility": {"inFrustum": True},
    }]
    assert "camera" not in summary["frames"][0]
    with pytest.raises(ValueError, match="DIRECTOR_EVALUATE_RESULT_INVALID"):
        summarize_evaluate_frames([])




def test_put_keeps_library_metadata_and_camera_clip_curves():
    current = empty_director_document()
    current["content"]["nodes"].append(node_from_library(
        "characters",
        {"id": "a3d_char_30ec53c93eae4173946b38639691ebe0", "name": "Female",
         "file": "3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb"},
        node_id="person-1",
    ))
    clip = {
        "id": "cam-orbit-1", "target": {"type": "node", "nodeId": "cam-main"}, "frameStart": 0, "frameEnd": 48,
        "trimStartMs": 0, "trimEndMs": 2000,
        "playback": {"version": 1, "speed": 1, "loop": False, "loopMode": "ping-pong", "baseDurationFrames": 48},
        "motion": {"id": "m1", "version": 1, "presetId": "ascending_orbit", "label": "Ascending orbit", "timeUnit": "millisecond",
                   "durationMs": 2000, "curves": [{
                       "id": "c1", "group": "position", "dataPath": "location", "arrayIndex": 0,
                       "extrapolation": "constant",
                       "keyframes": [{"id": "k1", "time": 0, "value": 1, "interpolation": "linear"}]}]},
    }
    current["content"]["timeline"]["animation"]["cameraMotionClips"] = [clip]
    put = prepare_put_document({
        "type": "biz/scene3d-director-document",
        "content": {"nodes": [{"id": "person-1", "type": "character",
                               "transform": {"position": {"x": 1, "y": 0, "z": 0}}}],
                    "timeline": {"animation": {"cameraMotionClips": [
                        {"id": "cam-orbit-1", "motion": {"presetId": "ascending_orbit"}}]}}},
    }, current=current)
    person = next(node for node in put["content"]["nodes"] if node["id"] == "person-1")
    assert person["metadata"]["modelUrl"].endswith("-d4ce3fb1.glb")
    kept = put["content"]["timeline"]["animation"]["cameraMotionClips"][0]
    assert kept["motion"]["curves"][0]["id"] == "c1"


def test_director_snapshot_outline_omits_curves():
    from topview_3d_cli.director_document import get_director_entity, summarize_director_snapshot, summarize_editorial

    document = empty_director_document()
    document["content"]["timeline"]["animation"]["cameraMotionClips"] = [{
        "id": "clip_1", "target": {"type": "node", "nodeId": "cam-main"}, "frameStart": 0, "frameEnd": 24,
        "motion": {"presetId": "orbit_180", "curves": [{"id": "c1"}]},
    }]
    document["content"]["editorial"] = {"version": 1, "activeSequenceId": "sequence_1", "sequences": [{
        "id": "sequence_1",
        "clips": [{"id": "edit_1", "cameraNodeId": "cam-main", "sourceFrameStart": 0, "sourceFrameEnd": 23}],
    }]}
    outline = summarize_director_snapshot({
        "document": document, "sceneSequence": 3,
        "entityVersions": {"director": 1, "cam-main": 1, "clip_1": 1},
        "fcurves": {"version": 1, "encoding": "compact-v1", "fcurves": [
            {"nodeId": "cam-main", "channel": "location.x", "keys": [1, 2]}]},
    })
    assert outline["cameras"] == ["cam-main"]
    assert outline["clips"][0]["id"] == "clip_1" and "curves" not in outline["clips"][0]
    assert outline["editorial"]["sequences"][0]["durationFrames"] == 24
    assert outline["fcurvesNodeIds"] == ["fcurves__cam-main"]
    clip = get_director_entity({"document": document}, "clip", "clip_1", include_curves=False)
    assert clip["entity"]["motion"]["curvesOmitted"] is True and "curves" not in clip["entity"]["motion"]
    assert summarize_editorial(empty_director_document())["sequences"][0]["clips"] == []

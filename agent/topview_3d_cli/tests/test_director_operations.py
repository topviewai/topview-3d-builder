"""Parity tests for the shared director operation engine.

Cases marked "Java:" mirror Scene3dLiveOperationDirectorTest / Scene3dLiveOperationService.
Turn/actor checks (TURN_BUSY, TURN_STALE) and profile checks belong to the hosted service
and have no local equivalent.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from topview_3d_cli.director_document import default_camera_node, empty_director_document, normalize_document
from topview_3d_cli.director_operations import (
    DirectorConflictError,
    DirectorOperationError,
    DirectorStore,
    diff_operations,
    genesis_store,
)
from topview_3d_cli.director_static import delete_node_operations

FIXTURES = Path(__file__).resolve().parents[1] / "contracts/director-v1/fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def scene_set(operation_id="op_director_scene_set", base=0, **extra):
    return {"operationId": operation_id, "baseSequence": base, "entityId": "director",
            "kind": "director.scene.set",
            "payload": {"scene": {"type": "biz/scene3d-director-document",
                                  "content": {"version": 1, "aspectRatio": "21:9"}}}, **extra}


def camera_upsert(operation_id="op_camera", node_id="camera_1", expected=None, **transform):
    node = default_camera_node(node_id)
    node["transform"]["position"].update(transform)
    return {"operationId": operation_id, "entityId": node_id, "kind": "director.node.upsert",
            "expectedEntityVersion": expected, "payload": {"node": node}}


def camera_clip(clip_id="clip_cam_1", node_id="camera_1", start=0, end=48, curves=True):
    clip = {"id": clip_id, "target": {"type": "node", "nodeId": node_id}, "frameStart": start, "frameEnd": end}
    if curves:
        clip["motion"] = {"curves": []}
    return {"operationId": f"op_{clip_id}", "entityId": clip_id, "kind": "director.clip.upsert",
            "payload": {"clipKind": "cameraMotion", "clip": clip}}


def delete(kind, entity_id, expected=None, operation_id=None):
    return {"operationId": operation_id or f"del_{entity_id}", "entityId": entity_id,
            "kind": f"director.{kind}.delete", "expectedEntityVersion": expected, "payload": {}}


def test_java_director_kinds_accept_and_advance_sequence():
    store = DirectorStore()
    result = store.apply([scene_set()], strict_versions=True)
    assert result["sceneSequence"] == 1
    assert result["accepted"][0]["entityVersionAfter"] == 1
    assert store.assemble()["document"]["content"]["aspectRatio"] == "21:9"


def test_java_non_director_kind_is_rejected():
    operation = {"operationId": "op_1", "baseSequence": 0, "entityId": "cube_1",
                 "kind": "object.create.primitive", "payload": {"primitive": "cube"}}
    with pytest.raises(DirectorOperationError, match="UNSUPPORTED_DIRECTOR_KIND"):
        DirectorStore().apply([operation], strict_versions=True)


def test_java_node_upsert_on_current_base_is_accepted():
    store = DirectorStore(scene_sequence=2)
    store.apply([camera_upsert() | {"baseSequence": 2}], strict_versions=True)
    assert store.scene_sequence == 3
    assert store.entity_versions() == {"camera_1": 1}


def test_java_clip_upsert_rejects_inverted_frame_range():
    store = DirectorStore()
    with pytest.raises(DirectorOperationError, match="INVALID_DIRECTOR_CLIP"):
        store.apply([camera_clip(start=48, end=0)], strict_versions=True)
    assert store == DirectorStore()


def test_contract_fixture_batch_matches_bootstrap_entities():
    batch = fixture("operation-batch.json")
    bootstrap = fixture("bootstrap.json")
    store = DirectorStore()
    store.apply(batch["operations"][:4], strict_versions=True, batch_id=batch["batchId"])
    assert store.scene_sequence == bootstrap["sceneSequence"]
    for expected in bootstrap["entities"]:
        entity = store.entities[expected["entityId"]]
        assert entity.entity_type == expected["entityType"]
        assert entity.version == expected["entityVersion"]
        assert entity.created_sequence == expected["createdSequence"]
        assert entity.deleted_sequence is None
    assert store.entities["camera_1"].state == bootstrap["entities"][1]["state"]
    assert store.entities["fcurves__camera_1"].state == bootstrap["entities"][3]["state"]
    clip_state = store.entities["clip_cam_push_1"].state
    assert clip_state["clipKind"] == "cameraMotion"
    assert clip_state["clip"].items() >= bootstrap["entities"][2]["state"]["clip"].items()
    # The service strips animation.fcurves from the scene entity (fcurves live in their own entities).
    scene_expected = copy.deepcopy(bootstrap["entities"][0]["state"])
    del scene_expected["content"]["timeline"]["animation"]["fcurves"]
    assert store.entities["director"].state == scene_expected

    store.apply(batch["operations"][4:], strict_versions=True)
    assert store.scene_sequence == 7
    assert store.entity_versions() == {"director": 1}
    assert {entity_id: entity.deleted_sequence for entity_id, entity in store.entities.items()
            if not entity.live} == {"clip_cam_push_1": 5, "fcurves__camera_1": 6, "camera_1": 7}


def test_strict_update_requires_expected_version_single_writer_does_not():
    strict = DirectorStore()
    strict.apply([camera_upsert()], strict_versions=True)
    with pytest.raises(DirectorConflictError, match="ENTITY_VERSION_CONFLICT"):
        strict.apply([camera_upsert("op_2", z=9)], strict_versions=True)
    strict.apply([camera_upsert("op_3", expected=1, z=9)], strict_versions=True)
    assert strict.entity_versions()["camera_1"] == 2

    local = DirectorStore()
    local.apply([camera_upsert()], strict_versions=False)
    local.apply([camera_upsert("op_2", z=9)], strict_versions=False)
    assert local.entity_versions()["camera_1"] == 2
    with pytest.raises(DirectorConflictError, match="ENTITY_VERSION_CONFLICT"):
        local.apply([camera_upsert("op_3", expected=1, z=10)], strict_versions=False)


@pytest.mark.parametrize("strict", [True, False])
def test_expected_version_on_missing_entity_conflicts(strict):
    with pytest.raises(DirectorConflictError, match="ENTITY_VERSION_CONFLICT"):
        DirectorStore().apply([camera_upsert(expected=1)], strict_versions=strict)


@pytest.mark.parametrize("strict", [True, False])
def test_delete_missing_and_deleted_entities(strict):
    store = DirectorStore()
    with pytest.raises(DirectorConflictError, match="ENTITY_NOT_FOUND"):
        store.apply([delete("node", "ghost")], strict_versions=strict)
    store.apply([camera_upsert(), delete("node", "camera_1", expected=1)], strict_versions=strict)
    assert store.entities["camera_1"].version == 2 and not store.entities["camera_1"].live
    with pytest.raises(DirectorConflictError, match="ENTITY_DELETED"):
        store.apply([delete("node", "camera_1", expected=2, operation_id="again")], strict_versions=strict)


def test_recreating_a_deleted_id():
    strict = DirectorStore()
    strict.apply([camera_upsert(), delete("node", "camera_1", expected=1)], strict_versions=True)
    with pytest.raises(DirectorConflictError, match="ENTITY_DELETED"):
        strict.apply([camera_upsert("op_again")], strict_versions=True)

    local = DirectorStore()
    local.apply([camera_upsert(), delete("node", "camera_1")], strict_versions=False)
    local.apply([camera_upsert("op_again")], strict_versions=False)
    assert local.entity_versions() == {"camera_1": 3}


@pytest.mark.parametrize("strict", [True, False])
def test_entity_type_conflict(strict):
    store = DirectorStore()
    store.apply([camera_upsert()], strict_versions=strict)
    with pytest.raises(DirectorConflictError, match="ENTITY_TYPE_CONFLICT"):
        store.apply([camera_clip(clip_id="camera_1", node_id="camera_1") | {"expectedEntityVersion": 1}],
                    strict_versions=strict)


def test_base_sequence_may_be_stale_but_not_ahead():
    store = DirectorStore()
    store.apply([scene_set(), camera_upsert()], strict_versions=True)
    store.apply([camera_clip() | {"baseSequence": 0}], strict_versions=True)
    with pytest.raises(DirectorConflictError, match="SEQUENCE_GAP"):
        store.apply([camera_clip("clip_2") | {"baseSequence": 99}], strict_versions=True)
    with pytest.raises(DirectorOperationError, match="INVALID_DIRECTOR_OPERATION"):
        store.apply([camera_clip("clip_3") | {"baseSequence": "1"}], strict_versions=True)


def test_operation_id_replay_is_idempotent_and_reuse_is_rejected():
    store = DirectorStore()
    first = store.apply([camera_upsert()], strict_versions=True)
    replay = store.apply([camera_upsert()], strict_versions=True)
    assert replay["sceneSequence"] == first["sceneSequence"] == 1
    assert replay["accepted"][0]["replayed"] is True
    with pytest.raises(DirectorConflictError, match="OPERATION_KEY_REUSED"):
        store.apply([camera_upsert(z=3)], strict_versions=True)


def test_batch_is_atomic():
    store = DirectorStore()
    store.apply([camera_upsert()], strict_versions=True)
    before = copy.deepcopy(store)
    with pytest.raises(DirectorConflictError, match=r"ENTITY_NOT_FOUND:operations\[1\]"):
        store.apply([camera_clip(), delete("node", "ghost")], strict_versions=True)
    assert store == before


@pytest.mark.parametrize("operations", [[], [camera_upsert(f"op_{i}", f"cam_{i}") for i in range(65)], "x"])
def test_batch_size_limits(operations):
    with pytest.raises(DirectorOperationError, match="INVALID_DIRECTOR_BATCH"):
        DirectorStore().apply(operations, strict_versions=True)


@pytest.mark.parametrize("operation,code", [
    ({"operationId": "bad.id", "entityId": "x", "kind": "director.node.delete", "payload": {}}, "INVALID_OPERATION_ID"),
    ({"operationId": "op", "kind": "director.node.delete", "payload": {}}, "INVALID_ENTITY_ID"),
    ({"operationId": "op", "entityId": "a:b", "kind": "director.node.delete", "payload": {}}, "INVALID_ENTITY_ID"),
    ({"operationId": "op", "entityId": "x", "kind": "director.node.delete", "payload": []}, "INVALID_DIRECTOR_PAYLOAD"),
    ({"operationId": "op", "entityId": "x", "kind": "director.node.delete", "payload": {"extra": 1}},
     "INVALID_DIRECTOR_PAYLOAD"),
    ({"operationId": "op", "entityId": "camera_1", "kind": "director.fcurves.set",
      "payload": {"version": 1, "encoding": "compact-v1", "fcurves": []}}, "INVALID_ENTITY_ID"),
    ({"operationId": "op", "entityId": "fcurves__camera_1", "kind": "director.fcurves.set",
      "payload": {"version": 2, "encoding": "compact-v1", "fcurves": []}}, "INVALID_DIRECTOR_FCURVES"),
    ({"operationId": "op", "entityId": "fcurves__camera_1", "kind": "director.fcurves.set",
      "payload": {"version": 1, "encoding": "compact-v1", "fcurves": [], "nodeId": "x"}}, "INVALID_DIRECTOR_PAYLOAD"),
    (scene_set() | {"entityId": "scene"}, "INVALID_DIRECTOR_SCENE"),
    (scene_set() | {"payload": {"scene": {"content": {"version": 1, "nodes": []}}}}, "INVALID_DIRECTOR_SCENE"),
    (camera_upsert() | {"entityId": "camera_2"}, "INVALID_DIRECTOR_NODE"),
    (camera_clip(curves=False), "INVALID_DIRECTOR_CLIP"),
    (camera_clip() | {"entityId": "other"}, "INVALID_DIRECTOR_CLIP"),
])
def test_malformed_operations_fail_closed(operation, code):
    with pytest.raises(DirectorOperationError, match=code):
        DirectorStore().apply([operation], strict_versions=True)


def test_non_finite_transform_is_rejected():
    operation = camera_upsert(x=float("inf"))
    with pytest.raises(DirectorOperationError, match="INVALID_DIRECTOR_TRANSFORM"):
        DirectorStore().apply([operation], strict_versions=False)


def test_scene_set_replaces_top_level_content_fields():
    store = DirectorStore()
    store.apply([scene_set()], strict_versions=True)
    patch = {"operationId": "op_patch", "entityId": "director", "kind": "director.scene.set",
             "expectedEntityVersion": 1,
             "payload": {"scene": {"content": {"version": 1, "timeline": {"fps": 30}}}}}
    store.apply([patch], strict_versions=True)
    content = store.assemble()["document"]["content"]
    assert content["aspectRatio"] == "21:9"
    assert content["timeline"]["fps"] == 30 and content["timeline"]["frameEnd"] == 120


def test_node_delete_does_not_cascade_but_reports_dangling_references():
    store = DirectorStore()
    store.apply([scene_set(), camera_upsert(), camera_clip(),
                 {"operationId": "op_curves", "entityId": "fcurves__camera_1", "kind": "director.fcurves.set",
                  "payload": {"version": 1, "encoding": "compact-v1",
                              "fcurves": [{"id": "fc", "t": ["node", "camera_1"], "p": "position", "i": 0, "k": []}]}}],
                strict_versions=True)
    store.apply([delete("node", "camera_1", expected=1)], strict_versions=True)
    assembled = store.assemble()
    assert [clip["id"] for clip in assembled["document"]["content"]["timeline"]["animation"]["cameraMotionClips"]] \
        == ["clip_cam_1"]
    assert {issue["entityId"] for issue in store.dangling_references()} == {"clip_cam_1", "fcurves__camera_1"}


def test_static_delete_planner_cascades_in_one_batch():
    store = genesis_store(normalize_document(empty_director_document()))
    store.apply([camera_upsert(), camera_clip(),
                 {"operationId": "op_curves", "entityId": "fcurves__camera_1", "kind": "director.fcurves.set",
                  "payload": {"version": 1, "encoding": "compact-v1",
                              "fcurves": [{"id": "fc", "t": ["node", "camera_1"], "p": "position", "i": 0, "k": []}]}}],
                strict_versions=True)
    batch, summary = delete_node_operations(store.assemble(), "camera_1")
    store.apply(batch["operations"], strict_versions=True)
    assert summary["deletedClipIds"] == ["clip_cam_1"]
    assert store.dangling_references() == []
    assert store.assemble()["fcurves"]["fcurves"] == []


def test_reference_warnings_do_not_block_writes():
    result = DirectorStore().apply([camera_clip(node_id="missing")], strict_versions=True)
    assert result["warnings"] == [{"code": "DIRECTOR_REFERENCE_MISSING", "entityId": "clip_cam_1",
                                   "field": "target.nodeId", "ref": "missing"}]


def test_assemble_orders_clips_by_frame_start_and_merges_fcurves():
    store = DirectorStore()
    store.apply([scene_set(), camera_upsert(), camera_clip("late", start=40, end=50),
                 camera_clip("early", start=0, end=10)], strict_versions=True)
    clips = store.assemble()["document"]["content"]["timeline"]["animation"]["cameraMotionClips"]
    assert [clip["id"] for clip in clips] == ["early", "late"]


def test_genesis_round_trips_the_fixture_document():
    document = normalize_document(fixture("document.json"))
    store = genesis_store(document)
    assembled = store.assemble()
    assert store.scene_sequence == len(store.entities)
    assert all(version == 1 for version in store.entity_versions().values())
    assert diff_operations(assembled, assembled["document"], assembled["fcurves"]) == []
    assert [node["id"] for node in assembled["document"]["content"]["nodes"]] \
        == [node["id"] for node in document["content"]["nodes"]]


def test_store_json_round_trip():
    store = DirectorStore()
    store.apply([scene_set(), camera_upsert(), delete("node", "camera_1", expected=1)], strict_versions=True)
    restored = DirectorStore.from_json(json.loads(json.dumps(store.to_json())))
    assert restored == store

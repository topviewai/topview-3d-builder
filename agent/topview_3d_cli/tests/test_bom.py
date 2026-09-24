"""BOM record rules: normalization, whitelist merge, size cap, stale derivation, review evidence."""
import json

import pytest

from topview_3d_cli.bom import (
    BOM_MAX_BYTES, apply_checkpoint, derive_verification, empty_bom, encode_bom, mark_verified,
    merge_checkpoint, normalize_bom, observed_from_snapshot, record_runtime_verification,
)
from topview_3d_cli.director_document import empty_director_document, node_from_library


def test_corrupt_fields_are_dropped_on_read():
    restored = normalize_bom({"intent": "x", "bogus": 1, "guidesRead": ["a", 3]}, "proj")
    assert restored["intent"] == "x" and "bogus" not in restored and restored["guidesRead"] == ["a"]
    assert normalize_bom("not an object", "proj") == empty_bom("proj")


def test_v1_entries_receive_stable_migration_ids():
    restored = normalize_bom({
        "version": 1, "relationships": ["人物面对桌子"],
        "constraints": [{"nodeId": "overview", "kind": "overview-camera"}],
    }, "proj")
    assert restored["relationships"] == [{"id": "legacy-relationships-1", "text": "人物面对桌子"}]
    assert restored["constraints"][0]["id"] == "overview"


def test_checkpoint_whitelist_and_semantic_merge():
    bom = empty_bom("proj")
    base = {"expectedSceneSequence": 0, "expectedBomRevision": 0}
    merged = apply_checkpoint(bom, {**base, "intent": {"userRequest": "把桌子放到窗边"}, "notes": ["n1"]})
    assert merged["intent"] == {"userRequest": "把桌子放到窗边"} and merged["notes"] == ["n1"]
    merged = apply_checkpoint(merged, {**base, "notes": ["n2"]})
    assert merged["notes"] == ["n2"] and merged["intent"]["userRequest"] == "把桌子放到窗边"
    for bad in ({}, {"observed": {}}, {"verification": {"stale": False}}, {"guidesRead": ["x"]},
                {"intent": 5}, {"relationships": "not-a-list"}, {"notes": [{"a": 1}]}):
        with pytest.raises(ValueError, match="BOM_CHECKPOINT_INVALID"):
            apply_checkpoint(bom, {**base, **bad})
    with pytest.raises(ValueError):
        apply_checkpoint(bom, {**base, "intent": {"x": float("nan")}})


def test_entries_merge_by_id_and_remove_retires_them():
    base = {"expectedSceneSequence": 0, "expectedBomRevision": 0}
    bom = apply_checkpoint(empty_bom("proj"), {**base, "relationships": [
        {"id": "a", "type": "faces"}, {"id": "b", "type": "beside"}]})
    bom = apply_checkpoint(bom, {**base, "relationships": [{"id": "a", "status": "passed"}],
                                 "remove": {"relationships": ["b"]}})
    assert [row["id"] for row in bom["relationships"]] == ["a"]
    assert bom["relationships"][0]["status"] == "passed"


def test_oversized_record_is_rejected():
    huge = {"expectedSceneSequence": 0, "expectedBomRevision": 0,
            "relationships": [{"id": f"r-{index}", "text": "x" * 1900} for index in range(40)]}
    assert len(json.dumps(huge)) > BOM_MAX_BYTES
    with pytest.raises(ValueError, match="BOM_TOO_LARGE"):
        encode_bom(merge_checkpoint(empty_bom("proj"), huge, 0))


def test_observed_and_stale_derivation():
    doc = empty_director_document()
    doc["content"]["nodes"].append(node_from_library(
        "props", {"id": "a3d_prop_table", "name": "桌子", "file": ""}, node_id="table"))
    observed = observed_from_snapshot({"document": doc, "sceneSequence": 3})
    assert observed["sceneSequence"] == 3
    assert {"id": "table", "type": "prop", "name": "桌子", "assetId": "a3d_prop_table"} in observed["nodes"]
    bom = empty_bom("proj")
    assert derive_verification(bom, observed) == {"sceneSequence": None, "stale": True}
    verified = mark_verified(bom, 3)
    assert derive_verification(verified, observed) == {"sceneSequence": 3, "stale": False}
    assert derive_verification(verified, {**observed, "sceneSequence": 4}) == {"sceneSequence": 3, "stale": True}
    assert observed_from_snapshot(None) == {"sceneSequence": None, "nodes": []}
    assert observed_from_snapshot({"sceneSequence": 2}) == {"sceneSequence": 2, "nodes": []}


def _views(*rows):
    return {"sceneSequence": 0, "stale": False, "checksComplete": True, "geometry": {"issues": []},
            "views": [{"cameraNodeId": camera, "frames": [0], "numerical": {"ok": True},
                       "renderStatus": "complete", "render": render} for camera, render in rows]}


def test_revision_conflict_and_model_review_require_real_evidence():
    first = merge_checkpoint(empty_bom("proj"), {
        "expectedSceneSequence": 0, "expectedBomRevision": 0,
        "relationships": [{"id": "seat-contact", "priority": "hard"}],
        "cameras": [{"id": "main", "nodeId": "cam-main", "role": "story"},
                    {"id": "overview", "nodeId": "overview", "role": "layout_overview"}],
    }, 0)
    assert first["bomRevision"] == 1
    with pytest.raises(ValueError, match="BOM_REVISION_CONFLICT"):
        merge_checkpoint(first, {"expectedSceneSequence": 0, "expectedBomRevision": 0, "notes": ["stale"]}, 0)
    evidence = record_runtime_verification(first, _views(
        ("cam-main", {"contactSheet": {"path": "/p/main.png", "sha256": "main-hash"}}),
        ("overview", {"contactSheet": {"path": "/p/overview.png", "sha256": "overview-hash"}})))
    reviewed = merge_checkpoint(evidence, {
        "expectedSceneSequence": 0, "expectedBomRevision": 1,
        "modelReview": {"views": [
            {"cameraNodeId": "cam-main", "frames": [0], "sha256": "main-hash",
             "status": "passed", "reason": "Story framing visible"},
            {"cameraNodeId": "overview", "frames": [0], "sha256": "overview-hash",
             "status": "passed", "reason": "Whole layout visible"}],
            "constraints": [{"id": "seat-contact", "status": "unknown", "reason": "Needs side view"}]},
    }, 0)
    assert reviewed["modelReview"]["coverageComplete"]
    with pytest.raises(ValueError, match="IMAGE_MISMATCH"):
        merge_checkpoint(reviewed, {
            "expectedSceneSequence": 0, "expectedBomRevision": 2,
            "modelReview": {"views": [{"cameraNodeId": "cam-main", "frames": [0], "sha256": "invented",
                                       "status": "passed", "reason": "Pretend"}], "constraints": []}}, 0)


def test_model_review_accepts_omitted_or_frame_sha_and_merges_cameras():
    first = merge_checkpoint(empty_bom("proj"), {
        "expectedSceneSequence": 0, "expectedBomRevision": 0,
        "cameras": [{"id": "main", "nodeId": "cam-main", "role": "story"},
                    {"id": "bed", "nodeId": "cam-bed", "role": "story"},
                    {"id": "overview", "nodeId": "overview", "role": "layout_overview"}],
    }, 0)
    three = record_runtime_verification(first, _views(
        ("cam-main", {"contactSheet": {"path": "/p/main.png", "sha256": "main-sheet"},
                      "frames": [{"frame": 0, "sha256": "main-frame"}]}),
        ("cam-bed", {"contactSheet": {"path": "/p/bed.png", "sha256": "bed-sheet"}, "frameSha256s": ["bed-frame"]}),
        ("overview", {"contactSheet": {"path": "/p/overview.png", "sha256": "overview-sheet"}})))
    two = record_runtime_verification(three, _views(
        ("cam-main", {"contactSheet": {"path": "/p/main2.png", "sha256": "main-sheet-2"},
                      "frames": [{"frame": 0, "sha256": "main-frame-2"}]}),
        ("overview", {"contactSheet": {"path": "/p/overview2.png", "sha256": "overview-sheet-2"}})))
    assert {row["cameraNodeId"] for row in two["verification"]["views"]} == {"cam-main", "cam-bed", "overview"}
    bed = next(row for row in two["verification"]["views"] if row["cameraNodeId"] == "cam-bed")
    assert bed["sha256"] == "bed-sheet"
    filled = merge_checkpoint(two, {
        "expectedSceneSequence": 0, "expectedBomRevision": 1,
        "modelReview": {"views": [
            {"cameraNodeId": "cam-main", "frames": [0], "status": "passed", "reason": "ok"},
            {"cameraNodeId": "cam-bed", "frames": [0], "sha256": "bed-frame", "status": "passed", "reason": "ok"},
            {"cameraNodeId": "overview", "frames": [0], "sha256": "overview-sheet-2", "status": "passed",
             "reason": "ok"}],
            "constraints": []},
    }, 0)
    views = {row["cameraNodeId"]: row["sha256"] for row in filled["modelReview"]["views"]}
    assert views["cam-main"] == "main-sheet-2" and views["cam-bed"] == "bed-frame"
    with pytest.raises(ValueError, match="expected sha256=main-sheet-2") as mismatch:
        merge_checkpoint(filled, {
            "expectedSceneSequence": 0, "expectedBomRevision": 2,
            "modelReview": {"views": [{"cameraNodeId": "cam-main", "frames": [0], "sha256": "invented",
                                       "status": "passed", "reason": "no"}], "constraints": []}}, 0)
    assert "frame sha=main-frame-2" in str(mismatch.value)

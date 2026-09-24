"""Plan / constraint record (BOM): intent, relationships, constraints, camera roles, model review.

Pure merge and evidence logic behind the ``topview-3d-cli bom`` and ``inspect views`` commands (stored as
``.topview3d/bom.json``). ``checkpoint`` fields are model-owned; the
runtime owns ``observed`` and ``verification``. Errors are ``ValueError("<CODE>: ...")``.
"""
from __future__ import annotations

import json
from typing import Any

from jsonschema import Draft7Validator

BOM_VERSION = 2
BOM_MAX_BYTES = 64 * 1024
CHECKPOINT_FIELDS = ("intent", "relationships", "constraints", "cameras", "notes")
GUIDES_READ_LIMIT = 32
OBSERVED_NODE_LIMIT = 200

_short = {"type": "string", "maxLength": 2000}
_entry = {"type": "object", "maxProperties": 24,
          "properties": {"id": {"type": "string", "minLength": 1, "maxLength": 128}},
          "required": ["id"], "additionalProperties": True}
_review_status = {"enum": ["passed", "failed", "unknown"]}
CHECKPOINT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["expectedSceneSequence", "expectedBomRevision"],
    "anyOf": [{"required": [key]} for key in (*CHECKPOINT_FIELDS, "remove", "modelReview")],
    "properties": {
        "expectedSceneSequence": {"type": "integer", "minimum": 0},
        "expectedBomRevision": {"type": "integer", "minimum": 0},
        "intent": {"anyOf": [_short, {"type": "object", "maxProperties": 16}]},
        "relationships": {"type": "array", "maxItems": 128, "items": _entry},
        "constraints": {"type": "array", "maxItems": 128, "items": _entry},
        "cameras": {"type": "array", "maxItems": 32, "items": _entry},
        "notes": {"type": "array", "maxItems": 64, "items": _short},
        "remove": {
            "type": "object", "additionalProperties": False,
            "properties": {key: {"type": "array", "maxItems": 128, "uniqueItems": True,
                                 "items": {"type": "string", "minLength": 1, "maxLength": 128}}
                           for key in ("relationships", "constraints", "cameras")},
        },
        "modelReview": {
            "type": "object", "additionalProperties": False,
            "required": ["views", "constraints"],
            "properties": {
                "views": {"type": "array", "minItems": 1, "maxItems": 24, "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["cameraNodeId", "frames", "status", "reason"],
                    "properties": {
                        "cameraNodeId": {"type": "string", "minLength": 1, "maxLength": 128},
                        "frames": {"type": "array", "minItems": 1, "maxItems": 3,
                                   "items": {"type": "integer", "minimum": 0}},
                        "sha256": {"type": "string", "minLength": 1, "maxLength": 128},
                        "status": _review_status,
                        "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                    },
                }},
                "constraints": {"type": "array", "maxItems": 128, "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["id", "status", "reason"],
                    "properties": {"id": {"type": "string", "minLength": 1, "maxLength": 128},
                                   "status": _review_status,
                                   "reason": {"type": "string", "minLength": 1, "maxLength": 2000}},
                }},
            },
        },
    },
}
_CHECKPOINT_VALIDATOR = Draft7Validator(CHECKPOINT_SCHEMA)


def empty_bom(project_id: str) -> dict[str, Any]:
    return {
        "version": BOM_VERSION,
        "projectId": project_id,
        "bomRevision": 0,
        "intent": None,
        "relationships": [],
        "constraints": [],
        "cameras": [],
        "notes": [],
        "guidesRead": [],
        "observed": {"sceneSequence": None, "nodes": []},
        "verification": {"sceneSequence": None, "stale": True},
        "modelReview": None,
        "updatedAt": None,
    }


def normalize_bom(raw: Any, project_id: str) -> dict[str, Any]:
    """Coerce a stored payload into the current shape; unknown / corrupt input falls back to empty."""
    base = empty_bom(project_id)
    if not isinstance(raw, dict):
        return base
    for key in CHECKPOINT_FIELDS:
        if key in raw:
            base[key] = raw[key]
    # Upgrade v1 whole-field records to stable ids without dropping their meaning.
    for key in ("relationships", "constraints", "cameras"):
        upgraded = []
        for index, entry in enumerate(base.get(key) if isinstance(base.get(key), list) else []):
            if isinstance(entry, dict):
                row = dict(entry)
                row.setdefault("id", row.get("nodeId") or f"legacy-{key}-{index + 1}")
            else:
                row = {"id": f"legacy-{key}-{index + 1}", "text": str(entry)}
            upgraded.append(row)
        base[key] = upgraded
    revision = raw.get("bomRevision")
    base["bomRevision"] = revision if isinstance(revision, int) and revision >= 0 else 0
    if isinstance(raw.get("guidesRead"), list):
        base["guidesRead"] = [str(item) for item in raw["guidesRead"] if isinstance(item, str)][:GUIDES_READ_LIMIT]
    if isinstance(raw.get("observed"), dict):
        base["observed"] = {"sceneSequence": raw["observed"].get("sceneSequence"),
                            "nodes": list(raw["observed"].get("nodes") or [])[:OBSERVED_NODE_LIMIT]}
    if isinstance(raw.get("verification"), dict):
        base["verification"] = dict(raw["verification"])
        base["verification"]["stale"] = bool(base["verification"].get("stale", True))
    if isinstance(raw.get("modelReview"), dict):
        base["modelReview"] = raw["modelReview"]
    base["updatedAt"] = raw.get("updatedAt")
    return base


def encode_bom(bom: dict[str, Any]) -> bytes:
    data = json.dumps(bom, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
    if len(data) > BOM_MAX_BYTES:
        raise ValueError(f"BOM_TOO_LARGE: {len(data)} bytes > {BOM_MAX_BYTES}")
    return data


def _merge_entries(current: Any, updates: list[dict], removed: set[str], field: str) -> list[dict]:
    entries = list(current) if isinstance(current, list) else []
    if any(not isinstance(entry, dict) or not entry.get("id") for entry in entries):
        raise ValueError(f"BOM_INVALID:{field} entries require stable id")
    update_ids = [entry["id"] for entry in updates]
    if len(update_ids) != len(set(update_ids)) or removed.intersection(update_ids):
        raise ValueError(f"BOM_DUPLICATE_OR_CONFLICTING_IDS:{field}")
    merged = [dict(entry) for entry in entries if entry["id"] not in removed]
    by_id = {entry["id"]: entry for entry in merged}
    for update in updates:
        if update["id"] in by_id:
            by_id[update["id"]].update(update)
        else:
            row = dict(update)
            merged.append(row)
            by_id[row["id"]] = row
    return merged


def apply_checkpoint(bom: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Pure semantic merge; runtime-owned evidence is not writable."""
    error = next(_CHECKPOINT_VALIDATOR.iter_errors(patch), None)
    if error:
        raise ValueError(f"BOM_CHECKPOINT_INVALID:{'.'.join(map(str, error.path))}: {error.message}")
    json.dumps(patch, allow_nan=False)
    merged = dict(bom)
    for key in ("intent", "notes"):
        if key in patch:
            merged[key] = patch[key]
    removals = patch.get("remove") or {}
    for key in ("relationships", "constraints", "cameras"):
        if key in patch or key in removals:
            merged[key] = _merge_entries(merged.get(key), patch.get(key, []),
                                         set(removals.get(key, [])), key)
    return merged


def merge_checkpoint(current: dict[str, Any], patch: dict[str, Any], sequence: Any) -> dict[str, Any]:
    """Check both CAS versions against ``sequence`` and the stored revision; return the merged BOM."""
    if sequence != patch.get("expectedSceneSequence"):
        raise ValueError("SCENE_SEQUENCE_CONFLICT: read current scene before checkpointing")
    revision = int(current.get("bomRevision") or 0)
    if revision != patch.get("expectedBomRevision"):
        raise ValueError(f"BOM_REVISION_CONFLICT: current bomRevision={revision}; merge against current BOM")
    merged = apply_checkpoint(current, patch)
    semantic_change = any(key in patch for key in (*CHECKPOINT_FIELDS, "remove"))
    if semantic_change and isinstance(merged.get("modelReview"), dict):
        merged["modelReview"] = {**merged["modelReview"], "stale": True}
    if "modelReview" in patch:
        evidence = merged.get("verification") or {}
        if evidence.get("stale") or evidence.get("sceneSequence") != sequence or not evidence.get("views"):
            raise ValueError("BOM_REVIEW_REQUIRES_CURRENT_RUNTIME_EVIDENCE")
        seen = set()
        filled_views = []
        for review in patch["modelReview"]["views"]:
            key = (review["cameraNodeId"], tuple(review["frames"]))
            if key in seen:
                raise ValueError("BOM_REVIEW_DUPLICATE_VIEW")
            seen.add(key)
            filled_views.append(_bind_review_sha(review, evidence.get("views") or []))
        patch = {**patch, "modelReview": {**patch["modelReview"], "views": filled_views}}
        constraint_ids = [row["id"] for row in patch["modelReview"]["constraints"]]
        if len(constraint_ids) != len(set(constraint_ids)):
            raise ValueError("BOM_REVIEW_DUPLICATE_CONSTRAINT")
        required = {row["id"] for row in merged.get("relationships", [])
                    if row.get("priority", "hard") == "hard"}
        reviewed_cameras = {row["cameraNodeId"] for row in patch["modelReview"]["views"]}
        cameras = merged.get("cameras") or []
        missing = {
            "constraints": sorted(required - set(constraint_ids)),
            "cameras": sorted({row.get("nodeId") for row in cameras if row.get("nodeId")} - reviewed_cameras),
            "cameraRoles": sorted({"story", "layout_overview"} - {row.get("role") for row in cameras}),
        }
        merged["modelReview"] = {"sceneSequence": sequence, "stale": False,
                                 **patch["modelReview"], "missingCoverage": missing,
                                 "coverageComplete": not any(missing.values())}
    merged["bomRevision"] = revision + 1
    encode_bom(merged)  # fail before writing when the merged record is oversized
    return merged


def observed_from_snapshot(snapshot: Any) -> dict[str, Any]:
    """Compact node inventory of the authoritative document (ids, types, names, assets)."""
    document = snapshot.get("document") if isinstance(snapshot, dict) else None
    content = document.get("content") if isinstance(document, dict) else None
    nodes = content.get("nodes") if isinstance(content, dict) else None
    rows = []
    for node in (nodes or [])[:OBSERVED_NODE_LIMIT]:
        if not isinstance(node, dict):
            continue
        row = {"id": node.get("id"), "type": node.get("type")}
        if node.get("name"):
            row["name"] = node["name"]
        metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
        if metadata.get("assetId"):
            row["assetId"] = metadata["assetId"]
        rows.append(row)
    sequence = snapshot.get("sceneSequence") if isinstance(snapshot, dict) else None
    return {"sceneSequence": sequence, "nodes": rows}


def derive_verification(bom: dict[str, Any], observed: dict[str, Any]) -> dict[str, Any]:
    verification = dict(bom.get("verification") or {})
    checked = verification.get("sceneSequence")
    verification["stale"] = checked is None or checked != observed.get("sceneSequence")
    verification.setdefault("sceneSequence", None)
    return verification


def mark_verified(bom: dict[str, Any], scene_sequence: int) -> dict[str, Any]:
    """Record that checks passed against ``scene_sequence``; ``turn_end_sync`` re-derives ``stale``."""
    updated = dict(bom)
    updated["verification"] = {"sceneSequence": scene_sequence, "stale": False}
    return updated


def _evidence_view(views: list, camera_node_id, frames) -> dict[str, Any] | None:
    for row in views:
        if row.get("cameraNodeId") == camera_node_id and row.get("frames") == frames:
            return row
    return None


def _bind_review_sha(review: dict[str, Any], views: list) -> dict[str, Any]:
    """Accept contact-sheet or per-frame hashes; fill sha256 from current evidence when omitted."""
    evidence = _evidence_view(views, review["cameraNodeId"], review["frames"])
    sheet = evidence.get("sha256") if isinstance(evidence, dict) else None
    frame_shas = list((evidence or {}).get("frameSha256s") or [])
    given = review.get("sha256")
    accepted = {value for value in [sheet, *frame_shas] if value}
    if not given:
        if not sheet:
            raise ValueError(
                f"BOM_REVIEW_IMAGE_MISMATCH: {review['cameraNodeId']} frames={review['frames']} "
                "has no current contactSheet sha256"
            )
        return {**review, "sha256": sheet}
    if given in accepted:
        return review
    detail = f"expected sha256={sheet}（contactSheet）" if sheet else "no contactSheet sha256"
    if frame_shas:
        detail += f", frame sha={','.join(frame_shas)}"
    raise ValueError(
        f"BOM_REVIEW_IMAGE_MISMATCH: {review['cameraNodeId']} frames={review['frames']} {detail}"
    )


def _view_evidence(row: dict[str, Any]) -> dict[str, Any]:
    render = row.get("render") if isinstance(row.get("render"), dict) else {}
    sheet = render.get("contactSheet") if isinstance(render.get("contactSheet"), dict) else {}
    frames = render.get("frames") if isinstance(render.get("frames"), list) else []
    frame_shas = list(render.get("frameSha256s") or [])
    if not frame_shas:
        frame_shas = [frame.get("sha256") for frame in frames if isinstance(frame, dict) and frame.get("sha256")]
    return {
        "cameraNodeId": row.get("cameraNodeId"),
        "frames": row.get("frames") or [],
        "numericalOk": row.get("numerical", {}).get("ok") is True,
        "numericalIssues": row.get("numerical", {}).get("issues") or [],
        "renderStatus": row.get("renderStatus"),
        "path": sheet.get("path"),
        "sha256": sheet.get("sha256"),
        "frameSha256s": frame_shas,
    }


def record_runtime_verification(bom: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Merge runtime evidence from one inspection; keep same-sequence cameras not re-checked."""
    updated = dict(bom)
    sequence = result.get("sceneSequence")
    previous = dict(bom.get("verification") or {})
    merged: dict[tuple[Any, tuple], dict[str, Any]] = {}
    if previous.get("sceneSequence") == sequence:
        for row in previous.get("views") or []:
            if isinstance(row, dict):
                merged[(row.get("cameraNodeId"), tuple(row.get("frames") or []))] = dict(row)
    for row in result.get("views") or []:
        if not isinstance(row, dict):
            continue
        evidence = _view_evidence(row)
        merged[(evidence.get("cameraNodeId"), tuple(evidence.get("frames") or []))] = evidence
    updated["verification"] = {
        "source": "runtime-v2",
        "sceneSequence": sequence,
        "stale": bool(result.get("stale", True)),
        "checksComplete": bool(result.get("checksComplete")),
        "views": list(merged.values()),
        "geometry": result.get("geometry") or {},
        **({"primaryStoryPreview": result["primaryStoryPreview"]}
           if result.get("primaryStoryPreview") else {}),
    }
    updated["modelReview"] = None
    return updated

"""``.topview-3d/bom.json``: the plan / constraint record kept next to the director document."""
from __future__ import annotations

import json
from typing import Any

from topview_3d_cli.bom import (
    derive_verification, encode_bom, merge_checkpoint, normalize_bom, observed_from_snapshot,
    record_runtime_verification,
)
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import Project, utc_timestamp, atomic_write_json, base_result, open_project

_CHECKPOINT_CODES = {
    "SCENE_SEQUENCE_CONFLICT": "SCENE_SEQUENCE_CONFLICT",
    "BOM_REVISION_CONFLICT": "BOM_REVISION_CONFLICT",
    "BOM_TOO_LARGE": "BOM_TOO_LARGE",
    "BOM_REVIEW_REQUIRES_CURRENT_RUNTIME_EVIDENCE": "BOM_REVIEW_EVIDENCE_MISSING",
    "BOM_REVIEW_IMAGE_MISMATCH": "BOM_REVIEW_EVIDENCE_MISSING",
}


def read_bom(project: Project) -> dict[str, Any]:
    """Stored record in the current shape; a missing file is an empty BOM."""
    try:
        raw = json.loads(project.paths.bom.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raw = None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalProjectError("BOM_JSON_INVALID", f"{project.paths.bom}: not JSON; fix or delete it") from exc
    if raw is not None and not isinstance(raw, dict):
        raise LocalProjectError("BOM_JSON_INVALID", f"{project.paths.bom} must contain an object")
    return normalize_bom(raw, project.paths.root.name)


# Node references a checkpoint may carry, per entry list.
_NODE_REFERENCES = {"relationships": ("subjectId", "targetId"), "cameras": ("nodeId",)}


def _check_references(project: Project, patch: dict[str, Any]) -> None:
    nodes = {node["id"] for node in project.store.assemble()["document"]["content"]["nodes"]}
    for field, keys in _NODE_REFERENCES.items():
        for index, entry in enumerate(patch.get(field) or []):
            for key in keys:
                values = entry.get(key) if isinstance(entry, dict) else None
                for value in values if isinstance(values, list) else [values]:
                    if isinstance(value, str) and value not in nodes:
                        raise LocalProjectError(
                            "DIRECTOR_NODE_NOT_FOUND",
                            f"{field}.{index}.{key}: no node {value!r}; nothing was written",
                            details={"field": field, "index": index, "id": entry.get("id"), "property": key,
                                     "ref": value})


def _public(bom: dict[str, Any]) -> dict[str, Any]:
    """The record as shown: ``guidesRead`` belongs to the hosted guide service and stays unused here."""
    return {key: value for key, value in bom.items() if key != "guidesRead"}


def write_bom(project: Project, bom: dict[str, Any]) -> None:
    bom = {**bom, "updatedAt": utc_timestamp()}
    try:
        encode_bom(bom)
    except ValueError as exc:
        raise LocalProjectError("BOM_TOO_LARGE", str(exc)) from exc
    atomic_write_json(project.paths.bom, bom)


def _with_observed(project: Project, bom: dict[str, Any]) -> dict[str, Any]:
    observed = observed_from_snapshot(project.store.assemble())
    return _public({**bom, "observed": observed, "verification": derive_verification(bom, observed)})


def bom_get(directory: str) -> dict[str, Any]:
    project = open_project(directory)
    return {**base_result(project), "path": str(project.paths.bom), "exists": project.paths.bom.is_file(),
            "bom": _with_observed(project, read_bom(project))}


def bom_checkpoint(directory: str, patch: dict[str, Any]) -> dict[str, Any]:
    project = open_project(directory)
    current = read_bom(project)
    try:
        merged = merge_checkpoint(current, patch, project.store.scene_sequence)
    except ValueError as exc:
        prefix = str(exc).split(":", 1)[0]
        code = _CHECKPOINT_CODES.get(prefix, "BOM_CHECKPOINT_INVALID")
        message, details = str(exc), None
        if code == "BOM_REVIEW_EVIDENCE_MISSING":
            evidence = current.get("verification") or {}
            details = {"evidenceSceneSequence": evidence.get("sceneSequence"),
                       "currentSceneSequence": project.store.scene_sequence,
                       "evidenceStale": bool(evidence.get("stale", True))}
            message = (f"{message}: the last complete `inspect views` evidence is from sceneSequence "
                       f"{details['evidenceSceneSequence']}, the project is at {details['currentSceneSequence']}; "
                       "rerun `inspect views` (any write, including adding or deleting a diagnostic camera, "
                       "invalidates it)")
        raise LocalProjectError(code, message, details=details) from exc
    _check_references(project, patch)
    merged.pop("observed", None)
    write_bom(project, merged)
    merged = read_bom(project)
    return {**base_result(project), "path": str(project.paths.bom), "bomRevision": merged["bomRevision"],
            "bom": _with_observed(project, merged)}


def record_views(project: Project, result: dict[str, Any]) -> None:
    write_bom(project, record_runtime_verification(read_bom(project), result))

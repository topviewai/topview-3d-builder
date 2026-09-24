"""Read-only views: document outline and entities, render runs and their PNGs, camera presets."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from topview_3d_cli.director_document import get_director_entity, summarize_director_snapshot
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import base_result, document_get, open_project
from topview_3d_cli.renderer import director_cli

ENTITY_TYPES = ("node", "clip", "fcurves")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def document_summary(directory: str) -> dict[str, Any]:
    project = open_project(directory)
    summary = summarize_director_snapshot(project.store.assemble())
    summary["message"] = ("Outline only: curves and full nodes omitted. "
                          "Use `document get <dir> --entity <id>` for one node, clip or fcurves shard.")
    return {**base_result(project), "summary": summary}


def document_entity(directory: str, entity_id: str, *, entity_type: str | None = None,
                    include_curves: bool = False) -> dict[str, Any]:
    """One node, clip or ``fcurves__<nodeId>`` shard; the type is inferred when omitted."""
    project = open_project(directory)
    snapshot = project.store.assemble()
    if entity_type:
        types = [entity_type]
    elif entity_id.startswith("fcurves__"):
        types = ["fcurves"]
    else:
        types = ["node", "clip", "fcurves"]
    for candidate in types:
        try:
            found = get_director_entity(snapshot, candidate, entity_id, include_curves=include_curves)
        except ValueError:
            continue
        key = found.get("entityId", entity_id)
        return {**base_result(project), **found, "entityId": key,
                "entityVersion": snapshot["entityVersions"].get(key)}
    raise LocalProjectError("DOCUMENT_ENTITY_NOT_FOUND", f"no {' or '.join(types)} {entity_id!r} in the document")


def document_view(directory: str, *, summary: bool, entity: str | None, entity_type: str | None,
                  include_curves: bool) -> dict[str, Any]:
    if summary and entity:
        raise LocalProjectError("USAGE_INVALID", "use either --summary or --entity")
    if entity_type and not entity:
        raise LocalProjectError("USAGE_INVALID", "--type needs --entity")
    if summary:
        return document_summary(directory)
    if entity:
        return document_entity(directory, entity, entity_type=entity_type, include_curves=include_curves)
    return document_get(directory)


def _read_run(run_dir: Path) -> dict[str, Any] | None:
    try:
        manifest = json.loads((run_dir / "render.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return manifest if isinstance(manifest, dict) else None


def _runs(renders: Path) -> list[tuple[Path, dict[str, Any]]]:
    rows = []
    for run_dir in renders.iterdir() if renders.is_dir() else []:
        manifest = _read_run(run_dir) if run_dir.is_dir() else None
        if manifest:
            rows.append((run_dir, manifest))
    rows.sort(key=lambda row: (str(row[1].get("createdAt") or ""), row[0].name))
    return rows


def renders_list(directory: str) -> dict[str, Any]:
    project = open_project(directory)
    sequence = project.store.scene_sequence
    runs = [{
        "runId": run_dir.name,
        "createdAt": manifest.get("createdAt"),
        "cameraNodeId": manifest.get("cameraNodeId"),
        "sceneSequence": manifest.get("sceneSequence"),
        "stale": manifest.get("sceneSequence") != sequence,
        "frames": [frame.get("frame") for frame in manifest.get("frames") or []],
        "width": manifest.get("width"),
        "height": manifest.get("height"),
        "blank": manifest.get("blank"),
        "blockedRequests": len(manifest.get("blockedRequests") or []),
    } for run_dir, manifest in _runs(project.paths.renders)]
    return {**base_result(project), "count": len(runs), "runs": runs}


def renders_show(directory: str, run_id: str | None = None, *, frame: int | None = None) -> dict[str, Any]:
    """Path and checksum of one PNG inside the project (the contact sheet unless --frame)."""
    project = open_project(directory)
    runs = _runs(project.paths.renders)
    if run_id is None:
        if not runs:
            raise LocalProjectError("RENDER_NOT_FOUND", "the project has no renders yet; run `topview-3d-cli render`")
        run_dir, manifest = runs[-1]
    else:
        run_dir, manifest = next(((path, data) for path, data in runs if path.name == run_id), (None, None))
        if run_dir is None:
            raise LocalProjectError("RENDER_NOT_FOUND", f"no render run {run_id!r}")
    if frame is None:
        entry = manifest.get("contactSheet") or {}
    else:
        entry = next((item for item in manifest.get("frames") or [] if item.get("frame") == frame), None)
        if entry is None:
            raise LocalProjectError("RENDER_NOT_FOUND", f"run {run_dir.name} has no frame {frame}")
    path = (run_dir / str(entry.get("file") or "")).resolve()
    if not entry.get("file") or path.parent != run_dir.resolve() or not path.is_file():
        raise LocalProjectError("RENDER_NOT_FOUND", f"{run_dir.name}: image file missing")
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if not data.startswith(PNG_SIGNATURE) or (entry.get("sha256") and entry["sha256"] != digest):
        raise LocalProjectError("RENDER_IMAGE_INVALID", f"{path} is not the PNG recorded in render.json")
    return {
        **base_result(project),
        "runId": run_dir.name,
        "kind": "contactSheet" if frame is None else "frame",
        "frame": frame,
        "path": str(path),
        "mimeType": "image/png",
        "sizeBytes": len(data),
        "sha256": digest,
        "cameraNodeId": manifest.get("cameraNodeId"),
        "sceneSequence": manifest.get("sceneSequence"),
        "stale": manifest.get("sceneSequence") != project.store.scene_sequence,
    }


def camera_presets() -> dict[str, Any]:
    listed = director_cli("list-camera-presets")
    return {"ok": True, "presets": listed.get("presets", [])}

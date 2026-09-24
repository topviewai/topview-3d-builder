"""``node batch`` and ``pose batch``: staged edits compiled to one atomic operation batch.

Every change is staged on a copy of the stored snapshot (static intents run in the Node renderer,
library poses compile in Chromium). Any rejected change aborts the command before anything is
written; the compiled batch then goes through the shared operation engine like ``document apply``.
"""
from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

from jsonschema import Draft7Validator

from topview_3d_cli.director_camera_view import apply_camera_view
from topview_3d_cli.director_document import new_scene_operation_id, normalize_node
from topview_3d_cli.director_geometry import check_primitive_geometry, compact_geometry
from topview_3d_cli.director_static import node_in
from topview_3d_cli.local_assets import asset_catalog, check_render_assets, find_asset, local_asset_map
from topview_3d_cli.local_catalog import find_any_asset
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import apply_operations, base_result, open_project
from topview_3d_cli.node_batch import (
    BATCH_OPERATION_LIMIT, affected_nodes, batch_schema, compact_node_state, compile_operations, expand_changes,
    node_state, obj, schema_error, stage_delete,
)
from topview_3d_cli.renderer import director_cli

NODE_BATCH_SCHEMA = batch_schema(require_sequence=False)
_UPDATE = NODE_BATCH_SCHEMA["properties"]["changes"]["items"]["oneOf"][3]["properties"]
POSE_BATCH_SCHEMA = obj({
    "expectedSceneSequence": {"type": "integer", "minimum": 0},
    "items": {"type": "array", "minItems": 1, "maxItems": 16, "items": {
        **obj({"nodeId": _UPDATE["nodeId"], "poseId": _UPDATE["nodeId"], "libraryId": _UPDATE["nodeId"],
               **{key: _UPDATE[key] for key in ("position", "rotation", "scale")}}, ("nodeId",)),
        "oneOf": [{"required": ["poseId"]}, {"required": ["libraryId"]}],
    }},
}, ("items",))
POSE_FILE_LIMIT = 1024 * 1024


def load_spec(path: str, invalid_code: str) -> dict[str, Any]:
    """Read a JSON object from a file or ``-`` (stdin)."""
    try:
        text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise LocalProjectError("INPUT_NOT_FOUND", str(path)) from exc
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LocalProjectError(invalid_code, f"{path}: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise LocalProjectError(invalid_code, f"{path} must contain a JSON object")
    try:
        json.dumps(value, allow_nan=False)
    except ValueError as exc:
        raise LocalProjectError(invalid_code, "NaN and Infinity are not allowed") from exc
    return value


def check_scene_sequence(spec: dict[str, Any], sequence: int) -> None:
    expected = spec.get("expectedSceneSequence")
    if expected is not None and expected != sequence:
        raise LocalProjectError("SCENE_SEQUENCE_CONFLICT",
                                f"expectedSceneSequence={expected} but the project is at {sequence}; re-read and re-plan",
                                details={"expected": expected, "current": sequence})


# Rejections that name something missing are input errors (exit 2), not scene conflicts.
_MISSING_REFERENCE = {"NODE_NOT_FOUND:": "DIRECTOR_NODE_NOT_FOUND", "ASSET_NOT_FOUND:": "ASSET_NOT_FOUND"}


def _reject(code: str, index: int, node_id: str, reason: str) -> LocalProjectError:
    return LocalProjectError(code, f"changes[{index}] ({node_id}): {reason}; nothing was written",
                             details={"index": index, "nodeId": node_id, "reason": reason})


class _Stager:
    """Runs static intents in the renderer in as few calls as possible, in change order."""

    def __init__(self, snapshot: dict[str, Any], reject_code: str):
        self.snapshot = snapshot
        self.pending: list[dict[str, Any]] = []
        self.reject_code = reject_code
        self.node_ids: dict[int, str] = {}

    def intent(self, index: int, node_id: str, intent: dict[str, Any]) -> None:
        self.node_ids[index] = node_id
        self.pending.append({"index": index, "intent": intent})

    def flush(self) -> None:
        if not self.pending:
            return
        try:
            result = director_cli("apply-intents", {"document": self.snapshot["document"],
                                                    "fcurves": self.snapshot.get("fcurves"),
                                                    "intents": self.pending})
        except LocalProjectError as exc:
            reason = (exc.details or {}).get("reason", "") if isinstance(exc.details, dict) else ""
            if exc.code == "RENDERER_FAILED" and reason.startswith("INTENT_REJECTED:"):
                _, index, message = reason.split(":", 2)
                raise _reject(self.reject_code, int(index), self.node_ids.get(int(index), ""), message) from exc
            raise
        finally:
            self.pending = []
        self.snapshot["document"] = result["document"]

    def direct(self, work: Callable[[], Any]) -> Any:
        self.flush()
        return work()


def _primitive_size(node: dict[str, Any]) -> dict[str, Any] | None:
    """Parameters and the scaled local size (width/height/depth before rotation) of a primitive."""
    primitive = node.get("primitive") or {}
    parameters = primitive.get("parameters") or {}
    kind = primitive.get("kind")
    if kind == "BoxGeometry":
        size = (parameters.get("width", 0), parameters.get("height", 0), parameters.get("depth", 0))
    elif kind == "SphereGeometry":
        size = (2 * parameters.get("radius", 0),) * 3
    elif kind in ("CylinderGeometry", "ConeGeometry"):
        radius = max(parameters.get("radiusTop", 0), parameters.get("radiusBottom", 0), parameters.get("radius", 0))
        size = (2 * radius, parameters.get("height", 0), 2 * radius)
    else:
        return None
    scale = node["transform"].get("scale") or {}
    return {"kind": kind, "parameters": parameters,
            "size": {axis: round(value * scale.get(axis, 1), 4) for axis, value in zip("xyz", size)}}


def _node_row(node: dict[str, Any], versions: dict[str, Any]) -> dict[str, Any]:
    row = compact_node_state(node_state(node, versions))
    if node.get("type") == "primitive":
        primitive = _primitive_size(node)
        if primitive:
            row["primitive"] = primitive
    return row


def _state(snapshot: dict[str, Any], node_ids: list[str]) -> dict[str, Any]:
    versions = snapshot.get("entityVersions") or {}
    ids = set(affected_nodes(snapshot, node_ids))
    return {
        "sceneSequence": snapshot.get("sceneSequence"),
        "nodes": [_node_row(node, versions)
                  for node in snapshot["document"]["content"]["nodes"] if node["id"] in ids],
        "geometry": compact_geometry(check_primitive_geometry(snapshot["document"])),
    }


def _commit(directory: str, before: dict[str, Any], staged: dict[str, Any], deleted_curves: set[str], *,
            stem: str, dry_run: bool) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], int]:
    try:
        operations, old, new = compile_operations(before, staged, deleted_curves)
    except ValueError as exc:
        raise LocalProjectError("BATCH_TOO_LARGE", str(exc)) from exc
    if operations:
        result = apply_operations(directory, operations, batch_id=new_scene_operation_id(stem), dry_run=dry_run)
    else:
        project = open_project(directory)
        result = {**base_result(project), "dryRun": dry_run, "strictVersions": False, "operationCount": 0,
                  "accepted": [], "warnings": [], "entityVersions": project.store.entity_versions()}
    return result, old, new, len(operations)


def _library_entry(catalog: list[dict[str, Any]], kind: str, library_id: str) -> dict[str, Any]:
    return find_any_asset(catalog, library_id, "character" if kind == "characters" else "prop")


def check_node_spec(spec: dict[str, Any], invalid_code: str = "NODE_BATCH_INVALID") -> None:
    error = schema_error(NODE_BATCH_SCHEMA, spec)
    if error:
        raise LocalProjectError(invalid_code, f"{error}; nothing was written")


def stage_node_changes(project: Any, spec: dict[str, Any]):
    """Stage validated ``changes`` on a copy: ``(before, staged, deleted_curves, expanded)``."""
    before = project.store.assemble()
    check_scene_sequence(spec, before["sceneSequence"])
    expanded = expand_changes(spec["changes"])
    if len(expanded) > BATCH_OPERATION_LIMIT:
        raise LocalProjectError("NODE_BATCH_INVALID", f"at most {BATCH_OPERATION_LIMIT} changes after repeat expansion")
    staged = copy.deepcopy(before)
    stager = _Stager(staged, "NODE_BATCH_REJECTED")
    catalog: list[dict[str, Any]] | None = None
    deleted_curves: set[str] = set()
    present = {node["id"] for node in before["document"]["content"]["nodes"]}
    for index, change in enumerate(expanded):
        action, node_id = change["action"], change["nodeId"]
        try:
            if "view" in change and any(key in change for key in ("position", "rotation", "distance", "subjectNodeId")):
                raise ValueError("CAMERA_VIEW_CONFLICT: use view with fov; omit position, rotation, distance and "
                                 "subjectNodeId")
            if "position" in change and "distance" in change:
                raise ValueError("CAMERA_POSITION_DISTANCE_CONFLICT: use view or distance, not both")
            if action.startswith("add_"):
                if node_id in present:
                    raise ValueError(f"NODE_ALREADY_EXISTS:{node_id}")
                present.add(node_id)
            elif node_id not in present:
                raise ValueError(f"NODE_NOT_FOUND:{node_id}")
            else:
                existing = next((node for node in staged["document"]["content"]["nodes"] if node["id"] == node_id), None)
                if existing and existing.get("locked"):
                    raise ValueError(f"NODE_LOCKED:{node_id}")
            if action == "delete":
                deleted_curves.update(stager.direct(lambda: stage_delete(staged, node_id)))
                present.discard(node_id)
                continue
            if action == "add_primitive":
                primitive = change["primitive"]
                if primitive["kind"] == "CylinderGeometry" and not any(
                        primitive["parameters"][key] > 0 for key in ("radiusTop", "radiusBottom")):
                    raise ValueError("CYLINDER_RADIUS_REQUIRED")
                node = normalize_node({"id": node_id, "type": "primitive", "name": change.get("name", node_id),
                                       "primitive": primitive})
                stager.direct(lambda: staged["document"]["content"]["nodes"].append(node))
            elif action == "add_library":
                if catalog is None:
                    catalog = asset_catalog(project.paths)
                try:
                    entry = _library_entry(catalog, change["kind"], change["libraryId"])
                except LocalProjectError as exc:
                    raise ValueError(f"ASSET_NOT_FOUND:{change['libraryId']}") from exc
                stager.intent(index, node_id, {
                    "type": "add-character" if change["kind"] == "characters" else "add-prop",
                    "nodeId": node_id, "libraryId": entry["id"],
                    "name": change.get("name") or entry.get("name") or node_id, "modelUrl": entry["key"]})
            elif action == "add_camera":
                subject_id = change.get("subjectNodeId") or (change.get("view") or {}).get("subjectNodeId")
                stager.intent(index, node_id, {"type": "add-camera", "nodeId": node_id, "presetId": change["presetId"],
                                               **({"subjectNodeId": subject_id} if subject_id else {})})
            patch = {key: change[key] for key in ("name", "position", "rotation", "scale") if key in change}
            if patch:
                stager.intent(index, node_id, {"type": "patch-transform", "nodeId": node_id, **patch})
            if "view" in change:
                stager.direct(lambda: apply_camera_view(staged["document"], node_id, change["view"]))
            for field, kind in (("fov", "set-fov"), ("distance", "set-distance")):
                if field in change:
                    stager.intent(index, node_id, {"type": kind, "cameraNodeId": node_id, field: change[field]})
        except ValueError as exc:
            reason = str(exc)
            code = next((code for prefix, code in _MISSING_REFERENCE.items() if reason.startswith(prefix)),
                        "NODE_BATCH_REJECTED")
            raise _reject(code, index, node_id, reason) from exc
    stager.flush()
    return before, staged, deleted_curves, expanded


def node_batch(directory: str, spec_path: str, *, dry_run: bool = False) -> dict[str, Any]:
    spec = load_spec(spec_path, "NODE_BATCH_INVALID")
    check_node_spec(spec)
    before, staged, deleted_curves, expanded = stage_node_changes(open_project(directory), spec)
    result, old, new, count = _commit(directory, before, staged, deleted_curves, stem="nodes", dry_run=dry_run)
    created = [key for key in new if key not in old]
    updated = [key for key in new if key in old and old[key] != new[key]]
    after = {**staged, "sceneSequence": result["sceneSequence"], "entityVersions": result["entityVersions"]}
    return {**result, "createdIds": created, "updatedIds": updated, "deletedIds": [key for key in old if key not in new],
            "changeCount": len(spec["changes"]), "expandedChangeCount": len(expanded), "operationCount": count,
            "state": _state(after, created + updated)}


def _pose_payload(entry: dict[str, Any]) -> dict[str, Any]:
    path = Path(entry["path"])
    if path.stat().st_size > POSE_FILE_LIMIT:
        raise LocalProjectError("POSE_ASSET_INVALID", f"{entry['id']}: pose file larger than 1 MiB")
    try:
        pose = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalProjectError("POSE_ASSET_INVALID", f"{entry['id']}: not JSON") from exc

    def vector(value, length):
        return isinstance(value, list) and len(value) == length and all(
            type(item) in (int, float) and math.isfinite(item) for item in value)
    bones = pose.get("bones") if isinstance(pose, dict) else None
    if (not isinstance(bones, dict) or not 1 <= len(bones) <= 256
            or not vector(pose.get("hips"), 3)
            or not all(isinstance(name, str) and vector(value, 4) and sum(x * x for x in value) > 0.01
                       for name, value in bones.items())):
        raise LocalProjectError("POSE_ASSET_INVALID", f"{entry['id']}: needs hips [x,y,z] and 1-256 bone quaternions")
    return pose


def pose_batch(directory: str, spec: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
    error = next(Draft7Validator(POSE_BATCH_SCHEMA).iter_errors(spec), None)
    if error:
        path = list(error.path)
        index = path[1] if len(path) > 1 and path[0] == "items" and isinstance(path[1], int) else None
        raise LocalProjectError("POSE_BATCH_INVALID", f"{'.'.join(map(str, path))}: {error.message[:450]}; "
                                "nothing was written", details={"index": index} if index is not None else None)
    ids = [item["nodeId"] for item in spec["items"]]
    repeated = next((index for index, node_id in enumerate(ids) if node_id in ids[:index]), None)
    if repeated is not None:
        raise LocalProjectError("POSE_BATCH_INVALID", f"items.{repeated}: {ids[repeated]} appears twice; each "
                                "character may appear once per batch",
                                details={"index": repeated, "nodeId": ids[repeated]})
    project = open_project(directory)
    before = project.store.assemble()
    check_scene_sequence(spec, before["sceneSequence"])
    staged = copy.deepcopy(before)
    document = staged["document"]
    clips = document["content"].get("timeline", {}).get("animation", {}).get("motionClips", [])
    catalog = asset_catalog(project.paths)
    items = []
    for index, item in enumerate(spec["items"]):
        where = {"index": index, "nodeId": item["nodeId"]}
        try:
            node = node_in(document, item["nodeId"])
        except ValueError as exc:
            raise LocalProjectError("DIRECTOR_NODE_NOT_FOUND", f"items.{index}: no node {item['nodeId']}",
                                    details=where) from exc
        if node.get("type") != "character":
            raise LocalProjectError("POSE_TARGET_INVALID", f"items.{index}: {item['nodeId']} is not a character",
                                    details=where)
        if node.get("locked"):
            raise _reject("POSE_BATCH_REJECTED", index, item["nodeId"], "NODE_LOCKED")
        if any((clip.get("target") or {}).get("nodeId") == item["nodeId"] for clip in clips):
            raise _reject("POSE_BATCH_REJECTED", index, item["nodeId"],
                          "POSE_BLOCKED_BY_MOTION: delete the character's motion clips first")
        try:
            entry = find_asset(catalog, "pose", item.get("poseId") or item["libraryId"])
        except LocalProjectError as exc:
            raise LocalProjectError(exc.code, f"items.{index}: {exc}",
                                    details={**where, "poseId": item.get("poseId") or item["libraryId"]}) from exc
        items.append({"nodeId": item["nodeId"], "libraryId": entry["id"], "pose": _pose_payload(entry)})
    mapping = local_asset_map(catalog)
    check_render_assets({"content": {"nodes": [node_in(document, node_id) for node_id in ids]}}, mapping)
    compiled = director_cli("apply-library-poses", {"document": document, "items": items,
                                                    "publicAssetBase": "", "localAssets": mapping})
    results = compiled.get("results") or []
    if len(results) != len(items):
        raise LocalProjectError("RENDER_RESULT_INVALID", "apply-library-poses returned the wrong number of results")
    poses = []
    for item, compiled_pose in zip(items, results):
        node_in(document, item["nodeId"])["character"]["animation"] = compiled_pose["animation"]
        poses.append({"nodeId": item["nodeId"], "poseId": item["libraryId"], "pose": compiled_pose.get("pose")})
    stager = _Stager(staged, "POSE_BATCH_REJECTED")
    for index, item in enumerate(spec["items"]):
        patch = {key: item[key] for key in ("position", "rotation", "scale") if key in item}
        if patch:
            stager.intent(index, item["nodeId"], {"type": "patch-transform", "nodeId": item["nodeId"], **patch})
    stager.flush()
    result, old, new, count = _commit(directory, before, staged, set(), stem="poses", dry_run=dry_run)
    after = {**staged, "sceneSequence": result["sceneSequence"], "entityVersions": result["entityVersions"]}
    return {**result, "poses": poses, "updatedIds": [key for key in new if old.get(key) != new[key]],
            "operationCount": count, "state": _state(after, ids)}

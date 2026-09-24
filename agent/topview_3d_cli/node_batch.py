"""Typed, ordered node changes (``node batch``) and their compilation to one operation batch.

Staging runs on a copy of the stored snapshot, so a rejected change writes nothing.
"""
from __future__ import annotations

import copy
from typing import Any

from jsonschema import Draft7Validator

from topview_3d_cli.director_document import apply_scene_set, fcurve_node_id, new_scene_operation_id
from topview_3d_cli.director_static import delete_node_operations

CLIP_ARRAYS = ("cameraMotionClips", "motionClips", "pathMotionClips")
BATCH_OPERATION_LIMIT = 64


def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required),
            "additionalProperties": False}


def batch_schema(*, require_sequence: bool = True) -> dict[str, Any]:
    identifier = {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,128}$"}
    number = {"type": "number"}
    positive = {"type": "number", "exclusiveMinimum": 0}
    vector = {**obj({axis: number for axis in "xyz"}), "minProperties": 1}
    scale = {**obj({axis: positive for axis in "xyz"}), "minProperties": 1}
    transform = {"position": vector, "rotation": vector, "scale": scale}
    point = obj({axis: number for axis in "xyz"}, "xyz")
    view = {"oneOf": [
        obj({"mode": {"const": "world"}, "position": point, "target": point},
            ("mode", "position", "target")),
        obj({"mode": {"const": "subject"}, "subjectNodeId": identifier,
             "offset": point, "targetOffset": point},
            ("mode", "subjectNodeId", "offset", "targetOffset")),
    ]}
    name = {"type": "string", "minLength": 1, "maxLength": 128, "pattern": "\\S"}
    camera = {
        "fov": {"type": "number", "minimum": 12, "maximum": 120},
        "distance": {"type": "number", "minimum": 0.1, "maximum": 200},
        "view": view,
    }
    geometry = []
    for kind, dimensions in (
        ("BoxGeometry", ("width", "height", "depth")),
        ("SphereGeometry", ("radius",)),
        ("CylinderGeometry", ("radiusTop", "radiusBottom", "height")),
        ("ConeGeometry", ("radius", "height")),
    ):
        parameters = {key: positive for key in dimensions}
        if kind == "CylinderGeometry":
            parameters.update({key: {"type": "number", "minimum": 0}
                               for key in ("radiusTop", "radiusBottom")})
        if kind in {"CylinderGeometry", "ConeGeometry"}:
            parameters["radialSegments"] = {"type": "integer", "minimum": 3, "maximum": 128}
        geometry.append(obj({"kind": {"const": kind}, "parameters": obj(parameters, dimensions)},
                            ("kind", "parameters")))

    def action(kind, fields, required=(), description=""):
        schema = obj({"action": {"const": kind}, "nodeId": identifier, **fields},
                     ("action", "nodeId", *required))
        if description:
            schema["description"] = description
        return schema
    return obj({
        "expectedSceneSequence": {"type": "integer", "minimum": 0},
        "changes": {"type": "array", "minItems": 1, "maxItems": 64, "items": {"oneOf": [
            action("add_primitive", {"name": name, "primitive": {"oneOf": geometry}, **transform},
                   ("primitive",), "Create a new primitive. Requires primitive geometry."),
            action("add_library", {"kind": {"enum": ["characters", "props"]},
                   "libraryId": identifier, "name": name, **transform}, ("kind", "libraryId"),
                   "Create a new character or prop from the asset library. Requires kind and libraryId."),
            action("add_camera", {"presetId": name, "subjectNodeId": identifier,
                   "name": name, **transform, **camera}, ("presetId",),
                   "Create a new camera. Requires presetId. Do not use update to create cameras."),
            {**action("update", {"name": name, **transform, **camera},
                      description="Change an existing node: name, partial transform, fov, distance. "
                      "Does not create nodes and does not accept presetId."),
             "minProperties": 3},
            action("delete", {}, description="Delete an existing node by nodeId."),
            action("repeat_primitive", {
                "name": name, "primitive": {"oneOf": geometry}, **transform,
                "count": {"type": "integer", "minimum": 2, "maximum": 32},
                "step": point,
            }, ("primitive", "count", "step"),
                   "Create regularly spaced primitive copies nodeId_1 through nodeId_count."),
        ]}},
    }, ("expectedSceneSequence", "changes") if require_sequence else ("changes",))


BATCH_SCHEMA = batch_schema()


def schema_error(schema: dict[str, Any], arguments: Any) -> str | None:
    """First schema violation as ``path: message``, preferring the change's own action schema."""
    error = next(Draft7Validator(schema).iter_errors(arguments), None)
    if error is None:
        return None
    for index, change in enumerate(arguments.get("changes", []) if isinstance(arguments, dict) else []):
        if not isinstance(change, dict):
            continue
        selected = next((item for item in schema["properties"]["changes"]["items"]["oneOf"]
                         if item["properties"]["action"]["const"] == change.get("action")), None)
        detail = next(Draft7Validator(selected).iter_errors(change), None) if selected else None
        if detail and list(detail.path)[:1] == ["primitive"] and isinstance(change.get("primitive"), dict):
            return f"changes.{index}.{_primitive_error(selected['properties']['primitive'], change['primitive'])}"
        if detail:
            return f"changes.{index}.{'.'.join(map(str, detail.path))}: {detail.message[:450]}"
    return f"{'.'.join(map(str, error.path))}: {error.message[:450]}"


def _primitive_error(schema: dict[str, Any], primitive: dict[str, Any]) -> str:
    """Validate against the branch for ``primitive.kind`` so the message names the kind and field."""
    branches = {branch["properties"]["kind"]["const"]: branch for branch in schema["oneOf"]}
    kind = primitive.get("kind")
    if kind not in branches:
        return f"primitive.kind: {kind!r} is not one of {sorted(branches)}"
    detail = next(Draft7Validator(branches[kind]).iter_errors(primitive), None)
    if detail is None:
        return f"primitive: invalid {kind}"
    return f"primitive.{'.'.join(map(str, detail.path))}: {detail.message[:400]} ({kind} takes " \
           f"{sorted(branches[kind]['properties']['parameters']['properties'])})"


def expand_changes(changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """``repeat_primitive`` becomes ``add_primitive`` for nodeId_1..nodeId_count."""
    expanded = []
    for change in changes:
        if change["action"] != "repeat_primitive":
            expanded.append(change)
            continue
        for copy_index in range(change["count"]):
            expanded.append({
                **{key: value for key, value in change.items() if key not in {"count", "step"}},
                "action": "add_primitive",
                "nodeId": f"{change['nodeId']}_{copy_index + 1}",
                "position": {
                    axis: change.get("position", {}).get(axis, 0) + copy_index * change["step"][axis]
                    for axis in "xyz"
                },
            })
    return expanded


def stage_delete(snapshot: dict[str, Any], node_id: str) -> set[str]:
    """Apply the cascading delete of ``node_id`` to a staged snapshot; return deleted fcurve ids."""
    batch, _ = delete_node_operations(snapshot, node_id)
    for operation in batch["operations"]:
        kind, entity_id, payload = (operation[key] for key in ("kind", "entityId", "payload"))
        content = snapshot["document"]["content"]
        if kind == "director.node.delete":
            content["nodes"] = [node for node in content["nodes"] if node["id"] != entity_id]
        elif kind == "director.node.upsert":
            content["nodes"] = [payload["node"] if node["id"] == entity_id else node for node in content["nodes"]]
        elif kind == "director.clip.delete":
            for key in CLIP_ARRAYS:
                animation = content["timeline"]["animation"]
                animation[key] = [clip for clip in animation.get(key, []) if clip["id"] != entity_id]
        elif kind == "director.fcurves.delete":
            curves = snapshot.get("fcurves") or {}
            snapshot["fcurves"] = curves
            curves.pop(entity_id, None)
            if curves.get("encoding") == "compact-v1":
                curves["fcurves"] = [c for c in curves.get("fcurves", []) if fcurve_node_id(c) != node_id]
        elif kind == "director.scene.set":
            snapshot["document"] = apply_scene_set(snapshot["document"], payload["scene"])
    return {op["entityId"] for op in batch["operations"] if op["kind"] == "director.fcurves.delete"}


def scene_fields(document: dict[str, Any]) -> dict[str, Any]:
    content = copy.deepcopy(document["content"])
    content.pop("nodes", None)
    for key in CLIP_ARRAYS:
        content.get("timeline", {}).get("animation", {}).pop(key, None)
    return content


def compile_operations(before: dict[str, Any], after: dict[str, Any], deleted_curves: set[str]):
    """Diff two snapshots into director operations; returns (operations, old nodes, new nodes)."""
    operations = []

    def add(kind, entity_id, payload):
        operations.append({"operationId": new_scene_operation_id("batch_node"),
                           "baseSequence": before["sceneSequence"], "entityId": entity_id,
                           "expectedEntityVersion": (before.get("entityVersions") or {}).get(entity_id),
                           "kind": kind, "payload": payload})
    old = {node["id"]: node for node in before["document"]["content"]["nodes"]}
    new = {node["id"]: node for node in after["document"]["content"]["nodes"]}
    for node_id, node in new.items():
        if old.get(node_id) != node:
            add("director.node.upsert", node_id, {"node": node})
    for node_id in old.keys() - new.keys():
        add("director.node.delete", node_id, {})
    for key in CLIP_ARRAYS:
        old_clips = before["document"]["content"]["timeline"]["animation"].get(key, [])
        kept = {clip["id"] for clip in after["document"]["content"]["timeline"]["animation"].get(key, [])}
        for clip in old_clips:
            if clip["id"] not in kept:
                add("director.clip.delete", clip["id"], {})
    for entity_id in sorted(deleted_curves):
        add("director.fcurves.delete", entity_id, {})
    old_scene, new_scene = scene_fields(before["document"]), scene_fields(after["document"])
    delta = {key: value for key, value in new_scene.items() if old_scene.get(key) != value}
    if delta:
        add("director.scene.set", "director", {"scene": {"content": {"version": 1, **delta}}})
    if len(operations) > BATCH_OPERATION_LIMIT:
        raise ValueError("DIRECTOR_BATCH_OPERATION_LIMIT: split at dependency boundaries (including delete cleanup)")
    return operations, old, new


def affected_nodes(snapshot: dict[str, Any], node_ids) -> list[str]:
    """Include children and bound cameras whose world state follows edited nodes."""
    nodes = snapshot["document"]["content"]["nodes"]
    affected = set(node_ids)
    while True:
        previous = len(affected)
        for node in nodes:
            camera = node.get("camera") or {}
            if (node.get("parentId") in affected
                    or (camera.get("subject") or {}).get("nodeId") in affected
                    or (camera.get("lookAtTarget") or {}).get("nodeId") in affected):
                affected.add(node["id"])
            if node["id"] in affected:
                affected.update(node.get("children") or [])
                if node.get("parentId"):
                    affected.add(node["parentId"])
        if len(affected) == previous:
            return [node["id"] for node in nodes if node["id"] in affected]


def compact_numbers(value, ndigits=3):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        return round(value, ndigits)
    if isinstance(value, list):
        return [compact_numbers(item, ndigits) for item in value]
    if isinstance(value, dict):
        return {key: compact_numbers(item, ndigits) for key, item in value.items()}
    return value


def _near(value, expected) -> bool:
    return isinstance(value, (int, float)) and abs(float(value) - expected) < 1e-6


def compact_node_state(row: dict[str, Any]) -> dict[str, Any]:
    row = compact_numbers(row)
    transform = row.get("transform")
    if isinstance(transform, dict):
        scale, rotation = transform.get("scale"), transform.get("rotation")
        if isinstance(scale, dict) and all(_near(scale.get(axis, 1), 1) for axis in "xyz"):
            transform.pop("scale", None)
        if isinstance(rotation, dict) and all(_near(rotation.get(axis, 0), 0) for axis in "xyz"):
            transform.pop("rotation", None)
    if row.get("visible") is True:
        row.pop("visible", None)
    if row.get("locked") is False:
        row.pop("locked", None)
    measurement = row.get("measurement")
    if isinstance(measurement, dict):
        position = transform.get("position") if isinstance(transform, dict) else None
        if measurement.get("origin") == position:
            measurement.pop("origin", None)
        axis = measurement.get("localForwardAxis")
        if isinstance(axis, dict) and _near(axis.get("x", 0), 0) and _near(axis.get("y", 0), 0) \
                and _near(axis.get("z", 0), 1):
            measurement.pop("localForwardAxis", None)
        surfaces = [{key: surface[key] for key in ("height", "worldWidth", "worldDepth") if key in surface}
                    for surface in measurement.get("supportSurfaces") or [] if isinstance(surface, dict)]
        if surfaces:
            measurement["supportSurfaces"] = surfaces
        else:
            measurement.pop("supportSurfaces", None)
        for key in list(measurement):
            if key not in {"status", "size", "bounds", "supportSurfaces", "landmarks", "origin", "localForwardAxis"}:
                measurement.pop(key, None)
    return row


def node_state(node: dict[str, Any], versions: dict[str, Any]) -> dict[str, Any]:
    row = {"nodeId": node["id"], "type": node["type"], "name": node.get("name"),
           "entityVersion": versions.get(node["id"]), "transform": copy.deepcopy(node["transform"])}
    if "parentId" in node:
        row["parentId"] = node["parentId"]
    if (node.get("metadata") or {}).get("assetId"):
        row["assetId"] = node["metadata"]["assetId"]
    for key in ("visible", "locked"):
        if key in node:
            row[key] = node[key]
    if node.get("camera"):
        row["camera"] = {key: copy.deepcopy(node["camera"][key])
                         for key in ("fov", "lookAt", "subject", "lookAtTarget") if key in node["camera"]}
    animation = (node.get("character") or {}).get("animation") or {}
    if animation.get("posePresetId"):
        row["posePresetId"] = animation["posePresetId"]
    return row

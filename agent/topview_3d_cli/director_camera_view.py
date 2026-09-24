"""Solve static camera aim from explicit world points."""
from __future__ import annotations

import math

from topview_3d_cli.director_static import node_in


def apply_camera_view(document: dict, node_id: str, view: dict) -> None:
    """Apply a world or character-relative camera view to an unparented camera."""
    node = node_in(document, node_id)
    if node["type"] != "camera":
        raise ValueError("DIRECTOR_CAMERA_REQUIRED")
    if node.get("locked"):
        raise ValueError("NODE_LOCKED")
    if node.get("parentId"):
        raise ValueError("CAMERA_PARENT_UNSUPPORTED: camera view requires a world-space root node")

    camera = node["camera"]
    subject = None
    if view["mode"] == "world":
        position, target = dict(view["position"]), dict(view["target"])
    else:
        subject = node_in(document, view["subjectNodeId"])
        if subject["type"] != "character":
            raise ValueError("CAMERA_SUBJECT_REQUIRES_CHARACTER")
        if subject.get("parentId"):
            raise ValueError("CAMERA_SUBJECT_PARENT_UNSUPPORTED: use measured world position and target")
        origin = subject["transform"]["position"]
        position = {axis: origin[axis] + view["offset"][axis] for axis in "xyz"}
        target = {axis: origin[axis] + view["targetOffset"][axis] for axis in "xyz"}

    delta = {axis: target[axis] - position[axis] for axis in "xyz"}
    distance = math.sqrt(sum(value * value for value in delta.values()))
    if not math.isfinite(distance) or not 0.1 <= distance <= 200:
        raise ValueError("CAMERA_VIEW_DISTANCE_OUT_OF_RANGE: position and target must be 0.1-200 metres apart")

    node["transform"]["position"] = position
    node["transform"]["rotation"] = {
        "x": math.degrees(math.atan2(delta["y"], math.hypot(delta["x"], delta["z"]))),
        "y": math.degrees(math.atan2(-delta["x"], -delta["z"])),
        "z": 0,
    }
    camera.pop("subject", None)
    camera.pop("lookAtTarget", None)
    camera["lookAt"] = target
    if subject:
        camera["subject"] = {
            "nodeId": subject["id"],
            "follow": True,
            "followRotation": False,
            "offset": dict(view["offset"]),
            "lookAtOffset": dict(view["targetOffset"]),
        }

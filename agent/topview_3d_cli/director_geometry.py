"""Conservative checks for unparented, axis-aligned box primitives."""
from __future__ import annotations

import math


def check_primitive_geometry(document: dict) -> dict:
    """Report exact containment and visible-ground coplanarity for simple boxes."""
    content = document["content"]
    boxes: list[tuple[str, list[float], list[float]]] = []
    skipped: list[str] = []
    issues: list[dict] = []
    for node in content["nodes"]:
        if node["type"] == "camera" or node.get("visible") is False:
            continue
        shape = node.get("primitive") or {}
        transform = node.get("transform") or {}
        rotation = transform.get("rotation") or {}
        if (node.get("parentId") or shape.get("kind") != "BoxGeometry"
                or any(abs(rotation.get(axis, 0) % 360) > 1e-8 for axis in "xyz")):
            skipped.append(node["id"])
            continue
        try:
            size = [shape["parameters"][key] * transform["scale"][axis]
                    for key, axis in zip(("width", "height", "depth"), "xyz")]
            position = [transform["position"][axis] for axis in "xyz"]
            if not all(math.isfinite(value) for value in size + position) or min(size) <= 0:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            skipped.append(node["id"])
            continue
        boxes.append((node["id"], [p - s / 2 for p, s in zip(position, size)],
                      [p + s / 2 for p, s in zip(position, size)]))

    display = (content.get("environment") or {}).get("display") or {}
    for node_id, low, high in boxes:
        if (display.get("groundVisible", True) and display.get("groundOpacity", 1) > 0
                and abs(high[1] - display.get("groundHeight", 0)) <= 1e-5):
            issues.append({"code": "BOX_TOP_COPLANAR_WITH_GROUND", "nodeId": node_id,
                           "surfaceY": high[1], "severity": "warning"})
        for other_id, other_low, other_high in boxes:
            if other_id == node_id:
                continue
            if all(a >= c - 1e-8 and b <= d + 1e-8
                   for a, b, c, d in zip(low, high, other_low, other_high)):
                issues.append({"code": "BOX_CONTAINED_IN_BOX", "nodeId": node_id,
                               "containerNodeId": other_id, "severity": "warning"})
                break
    return {
        "checkedBoxCount": len(boxes),
        "skippedNodeIds": skipped[:64],
        "skippedNodeCount": len(skipped),
        "issues": issues[:64],
        "issueCount": len(issues),
        "scope": "Static unparented axis-aligned boxes only; meshes, rotated/grouped parts and character contact remain unproven.",
    }


def compact_geometry(geometry: dict | None) -> dict:
    """Keep only actionable geometry evidence for tool results."""
    value = geometry if isinstance(geometry, dict) else {}
    return {
        "issues": list(value.get("issues") or [])[:64],
        "issueCount": int(value.get("issueCount") or 0),
        "skippedNodeCount": int(value.get("skippedNodeCount") or 0),
    }

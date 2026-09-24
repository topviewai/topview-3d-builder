"""Normalize and fail-closed-validate director-document-v1 JSON."""
from __future__ import annotations

import copy
import json
import re
import uuid
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

DIRECTOR_DOCUMENT_TYPE = "biz/scene3d-director-document"
NODE_TYPES = ("camera", "character", "prop", "path", "group", "primitive")
SCENE3D_OP_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SCENE3D_OP_ID_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")
SCHEMA_PATH = Path(__file__).resolve().parent / "contracts/director-v1/schema/director-document.schema.json"
FCURVES_SCHEMA_PATH = SCHEMA_PATH.with_name("fcurves-compact-v1.schema.json")
_VALIDATOR: Draft7Validator | None = None
_FCURVES_VALIDATOR: Draft7Validator | None = None


def _validator() -> Draft7Validator:
    global _VALIDATOR
    if _VALIDATOR is None:
        if not SCHEMA_PATH.is_file():
            raise FileNotFoundError(f"director-document schema missing: {SCHEMA_PATH}")
        _VALIDATOR = Draft7Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
    return _VALIDATOR


def new_scene_operation_id(stem: str = "op") -> str:
    suffix = uuid.uuid4().hex[:10]
    cleaned = _SCENE3D_OP_ID_UNSAFE.sub("_", str(stem or "op")).strip("_") or "op"
    cleaned = cleaned[: 128 - 1 - len(suffix)].rstrip("_") or "op"
    return f"{cleaned}_{suffix}"


def fcurve_node_id(curve: Any) -> str | None:
    """Node id of one compact-v1 curve (``t: ["node", id]`` or ``t: id``; legacy ``nodeId``)."""
    if not isinstance(curve, dict):
        return None
    target = curve.get("t")
    if isinstance(target, list) and len(target) >= 2 and isinstance(target[1], str):
        return target[1]
    if isinstance(target, str):
        return target
    legacy = curve.get("nodeId")
    return legacy if isinstance(legacy, str) and legacy else None


def xyz(x: float = 0, y: float = 0, z: float = 0) -> dict[str, float]:
    return {"x": float(x), "y": float(y), "z": float(z)}


def empty_director_document() -> dict[str, Any]:
    camera = default_camera_node("cam-main")
    return {
        "type": DIRECTOR_DOCUMENT_TYPE,
        "pippitAssetId": "local_director",
        "extra": {},
        "content": {
            "version": 1,
            "aspectRatio": "16:9",
            "activeShotCameraNodeId": camera["id"],
            "environment": {
                "background": {"mode": "color", "skyColor": "#87CEEB"},
                "display": {
                    "characterLabelsVisible": True,
                    "groundVisible": True,
                    "groundHeight": 0,
                    "groundOpacity": 1,
                },
            },
            "asset": {"motionPath": []},
            "nodes": [camera],
            "physicalConstraints": [],
            "timeline": {
                "version": 1,
                "fps": 24,
                "frameStart": 0,
                "frameEnd": 120,
                "usePreviewRange": False,
                "animation": {
                    "fcurves": [],
                    "cameraMotionClips": [],
                    "motionTransitions": [],
                    "motionClips": [],
                    "pathMotionClips": [],
                },
            },
        },
    }


def default_camera_node(node_id: str = "cam-main") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "camera",
        "name": "主相机",
        "visible": True,
        "locked": False,
        "transform": {
            "position": xyz(0, 1.8, 5),
            "rotation": xyz(-8, 0, 0),
            "scale": xyz(1, 1, 1),
        },
        "camera": {
            "projection": "perspective",
            "fov": 50,
            "fovAxis": "vertical",
            "near": 0.1,
            "far": 2000,
            "isPrimary": True,
            "lookAt": xyz(0, 1.2, 0),
        },
    }


def _as_xyz(value: Any, field: str, default: dict[str, float] | None = None) -> dict[str, float]:
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return xyz(value[0], value[1], value[2])
    if isinstance(value, dict) and all(axis in value for axis in ("x", "y", "z")):
        return xyz(value["x"], value["y"], value["z"])
    if default is not None:
        return dict(default)
    raise ValueError(f"INVALID_DIRECTOR_TRANSFORM:{field}")


def normalize_transform(raw: Any) -> dict[str, dict[str, float]]:
    source = raw if isinstance(raw, dict) else {}
    return {
        "position": _as_xyz(source.get("position"), "position", xyz()),
        "rotation": _as_xyz(source.get("rotation"), "rotation", xyz()),
        "scale": _as_xyz(source.get("scale"), "scale", xyz(1, 1, 1)),
    }


def _merge_metadata(node: dict[str, Any]) -> dict[str, Any]:
    metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
    asset = node.get("asset") if isinstance(node.get("asset"), dict) else {}
    if asset.get("file") and not metadata.get("modelUrl"):
        metadata["modelUrl"] = asset["file"]
    if asset.get("id") and not metadata.get("assetId"):
        metadata["assetId"] = asset["id"]
    return metadata


def _fill_camera(raw: Any) -> dict[str, Any]:
    camera = copy.deepcopy(raw) if isinstance(raw, dict) else {}
    camera["projection"] = camera.get("projection") or "perspective"
    camera["fov"] = float(camera["fov"]) if isinstance(camera.get("fov"), (int, float)) else 50
    camera["fovAxis"] = camera.get("fovAxis") or "vertical"
    camera["near"] = float(camera["near"]) if isinstance(camera.get("near"), (int, float)) else 0.1
    camera["far"] = float(camera["far"]) if isinstance(camera.get("far"), (int, float)) else 2000
    camera["isPrimary"] = camera["isPrimary"] if isinstance(camera.get("isPrimary"), bool) else True
    camera["lookAt"] = _as_xyz(camera.get("lookAt"), "lookAt", xyz(0, 1.2, 0))
    return camera


def _fill_character(raw: Any) -> dict[str, Any]:
    character = copy.deepcopy(raw) if isinstance(raw, dict) else {}
    appearance = character.get("appearance") if isinstance(character.get("appearance"), dict) else {}
    label = character.get("label") if isinstance(character.get("label"), dict) else {}
    animation = character.get("animation") if isinstance(character.get("animation"), dict) else {}
    character["placeholder"] = (
        character["placeholder"] if isinstance(character.get("placeholder"), bool) else True
    )
    character["gender"] = character.get("gender") or "unknown"
    if "motionId" not in character:
        character["motionId"] = None
    character["appearance"] = {**appearance, "color": appearance.get("color") or "#d7b5ee"}
    character["label"] = {
        **label,
        "showLabel": label["showLabel"] if isinstance(label.get("showLabel"), bool) else True,
        "scale": float(label["scale"]) if isinstance(label.get("scale"), (int, float)) else 1,
        "yOffset": float(label["yOffset"]) if isinstance(label.get("yOffset"), (int, float)) else 0.04,
    }
    character["animation"] = {
        **animation,
        "mode": animation.get("mode") or "pose",
        "controlValues": animation["controlValues"]
        if isinstance(animation.get("controlValues"), dict) else {},
    }
    return character


def _fill_prop(raw: Any, category: str | None) -> dict[str, Any]:
    prop = raw if isinstance(raw, dict) else {}
    return {"category": prop.get("category") or category or "set"}


def normalize_node(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("INVALID_DIRECTOR_NODE")
    node = copy.deepcopy(raw)
    node_id = str(node.get("id") or "").strip()
    node_type = str(node.get("type") or "").strip()
    if not node_id or node_type not in NODE_TYPES:
        raise ValueError("INVALID_DIRECTOR_NODE")
    node["id"] = node_id
    node["type"] = node_type
    node["name"] = str(node.get("name") or node_id)
    node["visible"] = node["visible"] if isinstance(node.get("visible"), bool) else True
    node["locked"] = node["locked"] if isinstance(node.get("locked"), bool) else False
    node["transform"] = normalize_transform(node.get("transform"))
    metadata = _merge_metadata(node)
    if metadata:
        node["metadata"] = metadata
    node.pop("asset", None)
    if node_type == "camera":
        node["camera"] = _fill_camera(node.get("camera"))
    elif node_type == "character":
        node["character"] = _fill_character(node.get("character"))
    elif node_type == "prop":
        node["prop"] = _fill_prop(node.get("prop"), None)
    elif node_type == "group":
        group = node.get("group") if isinstance(node.get("group"), dict) else {}
        appearance = group.get("appearance") if isinstance(group.get("appearance"), dict) else {}
        node["group"] = {
            "appearance": {"color": appearance.get("color") or "#888888"},
            "kind": group.get("kind") or "group",
        }
    elif node_type == "primitive":
        primitive = node.get("primitive") if isinstance(node.get("primitive"), dict) else {}
        node["primitive"] = {
            "kind": primitive.get("kind") or "cube",
            "parameters": primitive["parameters"]
            if isinstance(primitive.get("parameters"), dict) else {},
        }
    elif node_type == "path":
        path = node.get("path") if isinstance(node.get("path"), dict) else {}
        if not isinstance(path.get("points"), list) or not path["points"]:
            raise ValueError("INVALID_DIRECTOR_PATH:points required")
        node["path"] = {
            "source": path.get("source") or "manual",
            "curve": path.get("curve") or "catmullrom",
            "closed": path["closed"] if isinstance(path.get("closed"), bool) else False,
            "groundSnap": path["groundSnap"] if isinstance(path.get("groundSnap"), bool) else True,
            "parameterization": path.get("parameterization") or "arcLength",
            "smoothing": float(path["smoothing"]) if isinstance(path.get("smoothing"), (int, float)) else 0.5,
            "points": path["points"],
        }
    return node


def node_from_library(
    kind: str,
    entry: dict[str, Any],
    *,
    node_id: str | None = None,
    transform: dict[str, Any] | None = None,
) -> dict[str, Any]:
    library_id = str(entry.get("id") or "").strip()
    if not library_id:
        raise ValueError("DIRECTOR_LIBRARY_ENTRY_MISSING_ID")
    resolved_id = str(node_id or library_id)
    name = str(entry.get("name") or library_id)
    file_key = entry.get("file")
    if kind == "characters":
        node = {
            "id": resolved_id,
            "type": "character",
            "name": name,
            "metadata": {"assetId": library_id, "modelUrl": file_key},
            "character": _fill_character({}),
        }
    elif kind == "props":
        node = {
            "id": resolved_id,
            "type": "prop",
            "name": name,
            "metadata": {"assetId": library_id, "modelUrl": file_key},
            "prop": _fill_prop({}, entry.get("category") or "set"),
        }
    else:
        raise ValueError("add_director_library_node only supports characters or props")
    if transform:
        node["transform"] = transform
    return normalize_node(node)


def _fill_environment(raw: Any) -> dict[str, Any]:
    environment = raw if isinstance(raw, dict) else {}
    background = environment.get("background") if isinstance(environment.get("background"), dict) else {}
    display = environment.get("display") if isinstance(environment.get("display"), dict) else {}
    filled = {
        "background": {
            "mode": background.get("mode") or "color",
            "skyColor": background.get("skyColor") or "#87CEEB",
        },
        "display": {
            "characterLabelsVisible": display["characterLabelsVisible"]
            if isinstance(display.get("characterLabelsVisible"), bool) else True,
            "groundVisible": display["groundVisible"]
            if isinstance(display.get("groundVisible"), bool) else True,
            "groundHeight": float(display["groundHeight"])
            if isinstance(display.get("groundHeight"), (int, float)) else 0,
            "groundOpacity": float(display["groundOpacity"])
            if isinstance(display.get("groundOpacity"), (int, float)) else 1,
        },
    }
    for key, value in environment.items():
        if key not in filled:
            filled[key] = copy.deepcopy(value)
    return filled


def _fill_timeline(raw: Any) -> dict[str, Any]:
    timeline = raw if isinstance(raw, dict) else {}
    animation = timeline.get("animation") if isinstance(timeline.get("animation"), dict) else {}
    filled = {
        "version": timeline.get("version") if isinstance(timeline.get("version"), (int, float)) else 1,
        "fps": timeline.get("fps") if isinstance(timeline.get("fps"), (int, float)) else 24,
        "frameStart": timeline.get("frameStart") if isinstance(timeline.get("frameStart"), (int, float)) else 0,
        "frameEnd": timeline.get("frameEnd") if isinstance(timeline.get("frameEnd"), (int, float)) else 120,
        "usePreviewRange": timeline["usePreviewRange"]
        if isinstance(timeline.get("usePreviewRange"), bool) else False,
        "animation": {
            "fcurves": animation.get("fcurves") if isinstance(animation.get("fcurves"), list) else [],
            "cameraMotionClips": animation.get("cameraMotionClips")
            if isinstance(animation.get("cameraMotionClips"), list) else [],
            "motionTransitions": animation.get("motionTransitions")
            if isinstance(animation.get("motionTransitions"), list) else [],
            "motionClips": animation.get("motionClips")
            if isinstance(animation.get("motionClips"), list) else [],
            "pathMotionClips": animation.get("pathMotionClips")
            if isinstance(animation.get("pathMotionClips"), list) else [],
        },
    }
    for key, value in animation.items():
        if key not in filled["animation"]:
            filled["animation"][key] = copy.deepcopy(value)
    return filled


def normalize_document(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("INVALID_DIRECTOR_DOCUMENT")
    document = copy.deepcopy(raw)
    document["type"] = document.get("type") or DIRECTOR_DOCUMENT_TYPE
    if document["type"] != DIRECTOR_DOCUMENT_TYPE:
        raise ValueError("INVALID_DIRECTOR_DOCUMENT")
    document["pippitAssetId"] = str(document.get("pippitAssetId") or "director")
    content = document.get("content") if isinstance(document.get("content"), dict) else {}
    nodes = [normalize_node(node) for node in content.get("nodes") or [] if isinstance(node, dict)]
    cameras = [node for node in nodes if node.get("type") == "camera"]
    content["version"] = content.get("version") if isinstance(content.get("version"), (int, float)) else 1
    content["aspectRatio"] = content.get("aspectRatio") or "16:9"
    shot = content.get("activeShotCameraNodeId")
    if isinstance(shot, str) and shot:
        content["activeShotCameraNodeId"] = shot
    elif cameras:
        content["activeShotCameraNodeId"] = cameras[0]["id"]
    else:
        content.pop("activeShotCameraNodeId", None)
    content["environment"] = _fill_environment(content.get("environment"))
    content["asset"] = content.get("asset") if isinstance(content.get("asset"), dict) else {"motionPath": []}
    content["asset"].setdefault("motionPath", [])
    content["nodes"] = nodes
    content["physicalConstraints"] = (
        content.get("physicalConstraints")
        if isinstance(content.get("physicalConstraints"), list) else []
    )
    content["timeline"] = _fill_timeline(content.get("timeline"))
    document["content"] = content
    return document


def validate_director_node(node: dict[str, Any]) -> dict[str, Any]:
    document = empty_director_document()
    document["content"]["nodes"] = [node]
    document["content"]["activeShotCameraNodeId"] = (
        node["id"] if node.get("type") == "camera"
        else document["content"]["activeShotCameraNodeId"]
    )
    validate_director_document(document)
    return node


def validate_director_document(document: dict[str, Any]) -> dict[str, Any]:
    errors = sorted(_validator().iter_errors(document), key=lambda item: list(item.path))
    if errors:
        first = errors[0]
        path = ".".join(str(part) for part in first.path) or "<root>"
        raise ValueError(f"INVALID_DIRECTOR_DOCUMENT:{path}: {first.message}")
    return document


def validate_fcurves(fcurves: dict[str, Any]) -> dict[str, Any]:
    global _FCURVES_VALIDATOR
    if _FCURVES_VALIDATOR is None:
        _FCURVES_VALIDATOR = Draft7Validator(json.loads(FCURVES_SCHEMA_PATH.read_text(encoding="utf-8")))
    errors = sorted(_FCURVES_VALIDATOR.iter_errors(fcurves), key=lambda item: list(item.path))
    if errors:
        first = errors[0]
        path = ".".join(str(part) for part in first.path) or "<root>"
        raise ValueError(f"INVALID_DIRECTOR_FCURVES:{path}: {first.message}")
    return fcurves


_SCENE_ROOT_KEYS = {"type", "pippitAssetId", "extra", "content", "nodes"}
_CLIP_ARRAYS = ("cameraMotionClips", "motionClips", "pathMotionClips")


def _as_document(document: Any) -> dict[str, Any] | None:
    if not isinstance(document, dict):
        return None
    if "content" in document or document.get("type") == DIRECTOR_DOCUMENT_TYPE:
        return document
    inner = document.get("document")
    return inner if isinstance(inner, dict) else document


def _index_nodes(document: Any) -> dict[str, dict[str, Any]]:
    resolved = _as_document(document) or {}
    content = resolved.get("content") if isinstance(resolved, dict) else {}
    nodes = content.get("nodes") if isinstance(content, dict) else []
    return {
        str(node["id"]): node
        for node in nodes or []
        if isinstance(node, dict) and node.get("id")
    }


def preserve_node_metadata(node: dict[str, Any], existing: dict[str, Any] | None) -> dict[str, Any]:
    if not existing:
        return node
    incoming_meta = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
    existing_meta = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
    merged = dict(existing_meta)
    merged.update(incoming_meta)
    if existing_meta.get("modelUrl") and not incoming_meta.get("modelUrl"):
        merged["modelUrl"] = existing_meta["modelUrl"]
    if existing_meta.get("assetId") and not incoming_meta.get("assetId"):
        merged["assetId"] = existing_meta["assetId"]
    if merged:
        node["metadata"] = merged
    return node


def scene_content_from_payload(scene: Any) -> dict[str, Any]:
    if not isinstance(scene, dict):
        raise ValueError("INVALID_DIRECTOR_SCENE")
    content = scene.get("content") if isinstance(scene.get("content"), dict) else None
    if "nodes" in scene or (content is not None and "nodes" in content):
        raise ValueError("INVALID_DIRECTOR_SCENE:content cannot include nodes")
    animation = {}
    if content is not None:
        timeline = content.get("timeline") if isinstance(content.get("timeline"), dict) else {}
        animation = timeline.get("animation") if isinstance(timeline.get("animation"), dict) else {}
    if any(key in animation for key in _CLIP_ARRAYS):
        raise ValueError("INVALID_DIRECTOR_SCENE:content cannot include clips")
    if content is not None:
        return copy.deepcopy(content)
    extracted = {
        key: copy.deepcopy(value)
        for key, value in scene.items()
        if key not in _SCENE_ROOT_KEYS
    }
    return extracted


def apply_scene_set(document: dict[str, Any], scene: Any) -> dict[str, Any]:
    incoming = scene_content_from_payload(scene)
    current = copy.deepcopy(document) if isinstance(document, dict) else empty_director_document()
    content = current.setdefault("content", {})
    kept_nodes = copy.deepcopy(content.get("nodes") or [])
    kept_timeline = copy.deepcopy(content.get("timeline") or {})
    kept_animation = (kept_timeline.get("animation") if isinstance(kept_timeline, dict) else {}) or {}
    for key, value in incoming.items():
        if key == "timeline" and isinstance(value, dict):
            merged_timeline = dict(kept_timeline)
            incoming_animation = value.get("animation") if isinstance(value.get("animation"), dict) else {}
            merged_animation = dict(kept_animation)
            for anim_key, anim_value in incoming_animation.items():
                if anim_key not in _CLIP_ARRAYS:
                    merged_animation[anim_key] = copy.deepcopy(anim_value)
            merged_timeline.update({
                item_key: copy.deepcopy(item_value)
                for item_key, item_value in value.items()
                if item_key != "animation"
            })
            merged_timeline["animation"] = merged_animation
            content["timeline"] = merged_timeline
        else:
            content[key] = copy.deepcopy(value)
    content["nodes"] = kept_nodes
    if isinstance(scene, dict):
        if scene.get("type"):
            current["type"] = scene["type"]
        if "pippitAssetId" in scene:
            current["pippitAssetId"] = scene["pippitAssetId"]
        if "extra" in scene:
            current["extra"] = copy.deepcopy(scene["extra"])
    current["content"] = content
    return normalize_document(current)


def camera_clip_has_curves(clip: Any) -> bool:
    if not isinstance(clip, dict):
        return False
    motion = clip.get("motion") if isinstance(clip.get("motion"), dict) else {}
    curves = motion.get("curves")
    return isinstance(curves, list) and bool(curves)


def stored_evaluate_body(
    snapshot: Any,
    frames: Any,
    *,
    width: int | None = None,
    height: int | None = None,
) -> dict[str, Any]:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("document"), dict):
        raise ValueError("DIRECTOR_DOCUMENT_MISSING")
    if not isinstance(frames, list) or not frames:
        raise ValueError("INVALID_DIRECTOR_FRAMES")
    document = prepare_put_document(snapshot["document"], current=snapshot["document"])
    body: dict[str, Any] = {"document": document, "frames": list(frames)}
    fcurves = snapshot.get("fcurves")
    if isinstance(fcurves, dict) and fcurves.get("encoding") == "compact-v1":
        body["fcurves"] = copy.deepcopy(fcurves)
    if width is not None:
        body["width"] = width
    if height is not None:
        body["height"] = height
    return body


def _index_camera_clips(document: Any) -> dict[str, dict[str, Any]]:
    resolved = _as_document(document) or {}
    content = resolved.get("content") if isinstance(resolved, dict) else {}
    timeline = content.get("timeline") if isinstance(content, dict) else {}
    animation = timeline.get("animation") if isinstance(timeline, dict) else {}
    clips = animation.get("cameraMotionClips") if isinstance(animation, dict) else []
    return {
        str(clip["id"]): clip
        for clip in clips or []
        if isinstance(clip, dict) and clip.get("id")
    }


def _preserve_camera_motion_clips(document: dict[str, Any], current: Any) -> None:
    existing = _index_camera_clips(current)
    animation = document["content"].setdefault("timeline", {}).setdefault("animation", {})
    kept: list[dict[str, Any]] = []
    for clip in animation.get("cameraMotionClips") or []:
        if not isinstance(clip, dict):
            continue
        if camera_clip_has_curves(clip):
            kept.append(clip)
        elif existing.get(str(clip.get("id") or "")) and camera_clip_has_curves(existing[str(clip["id"])]):
            kept.append(copy.deepcopy(existing[str(clip["id"])]))
    animation["cameraMotionClips"] = kept


def prepare_put_document(document: Any, current: Any = None) -> dict[str, Any]:
    normalized = normalize_document(document)
    existing = _index_nodes(current)
    incoming_ids = {node["id"] for node in normalized["content"]["nodes"]}
    for node in normalized["content"]["nodes"]:
        preserve_node_metadata(node, existing.get(node["id"]))
    if not any(node.get("type") == "camera" for node in normalized["content"]["nodes"]):
        for node_id, node in existing.items():
            if node.get("type") == "camera" and node_id not in incoming_ids:
                normalized["content"]["nodes"].insert(0, copy.deepcopy(node))
    if not normalized["content"].get("activeShotCameraNodeId"):
        current_doc = _as_document(current) or {}
        current_shot = (current_doc.get("content") or {}).get("activeShotCameraNodeId")
        cameras = [node for node in normalized["content"]["nodes"] if node.get("type") == "camera"]
        normalized["content"]["activeShotCameraNodeId"] = (
            current_shot if isinstance(current_shot, str) and current_shot
            else (cameras[0]["id"] if cameras else "cam-main")
        )
    _preserve_camera_motion_clips(normalized, current)
    return validate_director_document(normalized)


def summarize_editorial(document: Any) -> dict[str, Any]:
    resolved = _as_document(document) or {}
    content = resolved.get("content") if isinstance(resolved, dict) else {}
    editorial = content.get("editorial") if isinstance(content, dict) else None
    if not isinstance(editorial, dict) or not isinstance(editorial.get("sequences"), list):
        editorial = {
            "version": 1,
            "activeSequenceId": "sequence_1",
            "sequences": [{"id": "sequence_1", "clips": []}],
        }
    sequences = []
    for sequence in editorial.get("sequences") or []:
        if not isinstance(sequence, dict):
            continue
        clips = []
        duration = 0
        for clip in sequence.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            start = clip.get("sourceFrameStart")
            end = clip.get("sourceFrameEnd")
            if isinstance(start, int) and isinstance(end, int) and end >= start:
                duration += end - start + 1
            clips.append({
                "id": clip.get("id"),
                "cameraNodeId": clip.get("cameraNodeId"),
                "sourceFrameStart": start,
                "sourceFrameEnd": end,
            })
        item = {"id": sequence.get("id"), "durationFrames": duration, "clips": clips}
        if sequence.get("name"):
            item["name"] = sequence["name"]
        sequences.append(item)
    return {
        "version": editorial.get("version") or 1,
        "activeSequenceId": editorial.get("activeSequenceId") or (
            sequences[0]["id"] if sequences else "sequence_1"
        ),
        "sequences": sequences,
    }


def summarize_director_snapshot(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise ValueError("DIRECTOR_DOCUMENT_MISSING")
    document = snapshot.get("document") if isinstance(snapshot.get("document"), dict) else snapshot
    content = document.get("content") if isinstance(document, dict) else {}
    nodes = content.get("nodes") if isinstance(content, dict) else []
    outlined = []
    cameras = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
        outlined.append({
            "id": node.get("id"),
            "type": node.get("type"),
            "name": node.get("name"),
            "visible": node.get("visible"),
            "locked": node.get("locked"),
            "assetId": metadata.get("assetId"),
        })
        if node.get("type") == "camera" and node.get("id"):
            cameras.append(node["id"])
    timeline = content.get("timeline") if isinstance(content.get("timeline"), dict) else {}
    animation = timeline.get("animation") if isinstance(timeline.get("animation"), dict) else {}
    clips = []
    for clip_kind, key in (
        ("cameraMotion", "cameraMotionClips"),
        ("motion", "motionClips"),
        ("pathMotion", "pathMotionClips"),
    ):
        for clip in animation.get(key) or []:
            if not isinstance(clip, dict):
                continue
            target = clip.get("target") if isinstance(clip.get("target"), dict) else {}
            clips.append({
                "id": clip.get("id"),
                "clipKind": clip_kind,
                "nodeId": target.get("nodeId"),
                "frameStart": clip.get("frameStart"),
                "frameEnd": clip.get("frameEnd"),
            })
    fcurves = snapshot.get("fcurves") if isinstance(snapshot.get("fcurves"), dict) else {}
    fcurve_ids = []
    for item in fcurves.get("fcurves") or []:
        node_id = fcurve_node_id(item)
        if node_id:
            entity_id = "fcurves__" + node_id
            if entity_id not in fcurve_ids:
                fcurve_ids.append(entity_id)
    return {
        "suggestedMode": "new" if len(cameras) == 1 and len(outlined) == 1 else "edit",
        "activeCameraNodeId": content.get("activeShotCameraNodeId"),
        "sceneSequence": snapshot.get("sceneSequence"),
        "entityVersions": snapshot.get("entityVersions") or {},
        "timeline": {
            "fps": timeline.get("fps"),
            "frameStart": timeline.get("frameStart"),
            "frameEnd": timeline.get("frameEnd"),
        },
        "nodes": outlined,
        "cameras": cameras,
        "clips": clips,
        "fcurvesNodeIds": fcurve_ids,
        "editorial": summarize_editorial(document),
        "message": (
            "Outline only: curves and full nodes omitted. "
            "Use get_director_entity for one node/clip. "
            "Do not hand-edit this outline."
        ),
    }


def get_director_entity(snapshot: Any, entity_type: str, entity_id: str, *, include_curves: bool = False) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise ValueError("DIRECTOR_DOCUMENT_MISSING")
    document = snapshot.get("document") if isinstance(snapshot.get("document"), dict) else {}
    content = document.get("content") if isinstance(document, dict) else {}
    if entity_type == "node":
        for node in content.get("nodes") or []:
            if isinstance(node, dict) and node.get("id") == entity_id:
                return {"entityType": "node", "entity": copy.deepcopy(node)}
        raise ValueError(f"DIRECTOR_ENTITY_NOT_FOUND:node:{entity_id}")
    if entity_type == "clip":
        animation = ((content.get("timeline") or {}).get("animation")
                     if isinstance(content.get("timeline"), dict) else {})
        for key in ("cameraMotionClips", "motionClips", "pathMotionClips"):
            for clip in (animation or {}).get(key) or []:
                if not isinstance(clip, dict) or clip.get("id") != entity_id:
                    continue
                body = copy.deepcopy(clip)
                if not include_curves:
                    motion = body.get("motion") if isinstance(body.get("motion"), dict) else None
                    if motion and "curves" in motion:
                        motion = dict(motion)
                        motion.pop("curves", None)
                        motion["curvesOmitted"] = True
                        body["motion"] = motion
                return {"entityType": "clip", "entity": body, "includeCurves": include_curves}
        raise ValueError(f"DIRECTOR_ENTITY_NOT_FOUND:clip:{entity_id}")
    if entity_type == "fcurves":
        node_id = entity_id.removeprefix("fcurves__") if entity_id.startswith("fcurves__") else entity_id
        matched = []
        fcurves = snapshot.get("fcurves") if isinstance(snapshot.get("fcurves"), dict) else {}
        for item in fcurves.get("fcurves") or []:
            if fcurve_node_id(item) == node_id:
                matched.append(copy.deepcopy(item) if include_curves else {
                    "nodeId": node_id,
                    "channel": item.get("p", item.get("channel")),
                    "index": item.get("i"),
                    "keyCount": len(item.get("k") or item.get("keys") or []),
                })
        if not matched:
            raise ValueError(f"DIRECTOR_ENTITY_NOT_FOUND:fcurves:{entity_id}")
        return {"entityType": "fcurves", "entityId": f"fcurves__{node_id}", "entity": matched}
    raise ValueError("INVALID_DIRECTOR_ENTITY_TYPE")


_EVAL_POSE_KEYS = frozenset({
    "camera", "lookAt", "position", "rotation", "scale", "transform",
})


def summarize_evaluate_frames(result: Any) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise ValueError("DIRECTOR_EVALUATE_RESULT_INVALID")
    summary: dict[str, Any] = {}
    if "ok" in result:
        summary["ok"] = result["ok"]
    if "issues" in result:
        summary["issues"] = copy.deepcopy(result["issues"])
    frames: list[dict[str, Any]] = []
    for item in result.get("frames") or []:
        if not isinstance(item, dict):
            continue
        frame: dict[str, Any] = {}
        if "frame" in item:
            frame["frame"] = item["frame"]
        for key, value in item.items():
            if key == "frame" or key in _EVAL_POSE_KEYS:
                continue
            if isinstance(value, bool) or value is None:
                frame[key] = value
            elif isinstance(value, str) and len(value) <= 120:
                frame[key] = value
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                frame[key] = value
            elif isinstance(value, dict):
                flags = {
                    flag_key: flag_value
                    for flag_key, flag_value in value.items()
                    if flag_key not in _EVAL_POSE_KEYS
                    and (
                        isinstance(flag_value, bool)
                        or (isinstance(flag_value, str) and len(flag_value) <= 80)
                    )
                }
                if flags:
                    frame[key] = flags
        if isinstance(item.get("nodes"), list):
            frame["nodes"] = [{k: copy.deepcopy(v) for k, v in node.items()
                               if k in {"nodeId", "type", "inFrustum", "cameraDistance", "groundPenetration", "finite", "positiveScale", "visible", "animated"}}
                              for node in item["nodes"] if isinstance(node, dict)]
        frames.append(frame)
    summary["frames"] = frames
    for key, value in result.items():
        if key in summary or key == "frames":
            continue
        if isinstance(value, (bool, int, float, str)) or value is None:
            summary[key] = value
    return summary



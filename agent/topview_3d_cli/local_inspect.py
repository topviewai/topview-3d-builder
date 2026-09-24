"""Read-only checks: ``evaluate`` (dry-run numbers), ``inspect nodes`` (mesh measurements), ``inspect views``.

Nothing here edits the director document. ``inspect views`` writes render runs and records the
runtime evidence in ``.topview-3d/bom.json``.
"""
from __future__ import annotations

import copy
import itertools
import math
from typing import Any

from jsonschema import Draft7Validator

from topview_3d_cli.director_document import new_scene_operation_id, stored_evaluate_body, summarize_evaluate_frames
from topview_3d_cli.director_geometry import check_primitive_geometry, compact_geometry
from topview_3d_cli.director_operations import DirectorConflictError, DirectorOperationError
from topview_3d_cli.director_static import camera_view, node_in
from topview_3d_cli.local_assets import asset_catalog, check_render_assets, local_asset_map
from topview_3d_cli.local_bom import record_views
from topview_3d_cli.local_edit import check_node_spec, check_scene_sequence, load_spec, stage_node_changes
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import base_result, open_project, validate_assembled
from topview_3d_cli.local_render import BENIGN_RENDER_WARNINGS, render_snapshot, require_camera
from topview_3d_cli.node_batch import obj
from topview_3d_cli.renderer import director_cli

MAX_FRAMES = 32
GROUND_TOLERANCE = 0.02
_IDENTIFIER = {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,128}$"}
VIEWS_SCHEMA = obj({
    "expectedSceneSequence": {"type": "integer", "minimum": 0},
    "views": {"type": "array", "minItems": 1, "maxItems": 8, "items": obj({
        "cameraNodeId": _IDENTIFIER,
        "frames": {"type": "array", "minItems": 1, "maxItems": 3, "uniqueItems": True,
                   "items": {"type": "integer", "minimum": 0}},
    }, ("cameraNodeId", "frames"))},
    "width": {"type": "integer", "minimum": 64, "maximum": 1024},
    "height": {"type": "integer", "minimum": 64, "maximum": 1024},
    "primaryCameraNodeId": _IDENTIFIER,
}, ("views",))


def parse_frames(text: str | None, default: list[int] | None = None) -> list[int]:
    if text is None:
        return list(default or [0])
    try:
        frames = [int(part) for part in text.split(",") if part.strip()]
    except ValueError as exc:
        raise LocalProjectError("USAGE_INVALID", f"--frames expects comma-separated integers, got {text!r}") from exc
    if not 1 <= len(frames) <= MAX_FRAMES or any(frame < 0 for frame in frames) or len(set(frames)) != len(frames):
        raise LocalProjectError("USAGE_INVALID", f"--frames needs 1-{MAX_FRAMES} distinct non-negative integers")
    return frames


def _camera(body: dict[str, Any], camera_id: str | None) -> dict[str, Any]:
    require_camera(body["document"], camera_id)
    return camera_view(body, camera_id)


def _staged_plan(project: Any, plan: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    kinds = [key for key in ("changes", "operations") if key in plan]
    extra = set(plan) - {"changes", "operations", "expectedSceneSequence"}
    if len(kinds) != 1 or extra:
        raise LocalProjectError("PLAN_INVALID", "a plan has exactly one of changes or operations "
                                                "(plus optional expectedSceneSequence)")
    check_scene_sequence(plan, project.store.scene_sequence)
    if kinds[0] == "changes":
        check_node_spec(plan, "PLAN_INVALID")
        return "changes", stage_node_changes(project, plan)[1]
    operations = plan["operations"]
    if not isinstance(operations, list):
        raise LocalProjectError("PLAN_INVALID", "operations must be a list")
    for operation in operations:
        if isinstance(operation, dict) and "operationId" not in operation:
            operation["operationId"] = new_scene_operation_id("plan")
    store = copy.deepcopy(project.store)
    try:
        store.apply(operations, strict_versions=False)
    except (DirectorOperationError, DirectorConflictError) as exc:
        raise LocalProjectError(exc.code, str(exc)) from exc
    return "operations", store.assemble()


def evaluate(directory: str, plan_path: str | None = None, *, frames: list[int], camera: str | None) -> dict[str, Any]:
    """Numbers for the stored scene, or for a plan staged in memory; nothing is written."""
    project = open_project(directory)
    result = base_result(project)
    plan_kind, snapshot = None, project.store.assemble()
    if plan_path:
        plan_kind, snapshot = _staged_plan(project, load_spec(plan_path, "PLAN_INVALID"))
        validate_assembled(snapshot)
    body = _camera(stored_evaluate_body(snapshot, frames), camera)
    evaluation = summarize_evaluate_frames(director_cli("evaluate", body))
    geometry = compact_geometry(check_primitive_geometry(snapshot["document"]))
    return {**result, "persisted": False, "plan": plan_kind, "frames": frames,
            "cameraNodeId": body.get("cameraNodeId") or body["document"]["content"].get("activeShotCameraNodeId"),
            "evaluation": evaluation, "geometry": geometry,
            "ok": evaluation.get("ok") is True and not geometry.get("issues")}


def _vector(point: dict[str, Any]) -> tuple[float, float, float]:
    return point["x"], point["y"], point["z"]


def _pair(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    low_a, high_a = _vector(a["bounds"]["min"]), _vector(a["bounds"]["max"])
    low_b, high_b = _vector(b["bounds"]["min"]), _vector(b["bounds"]["max"])
    gaps = [max(low_b[i] - high_a[i], low_a[i] - high_b[i], 0.0) for i in range(3)]
    overlap = [min(high_a[i], high_b[i]) - max(low_a[i], low_b[i]) for i in range(3)]
    intersecting = all(value > 0 for value in overlap)
    return {
        "nodeIds": [a["nodeId"], b["nodeId"]],
        "originDistance": round(math.dist(_vector(a["origin"]), _vector(b["origin"])), 4),
        "horizontalOriginDistance": round(math.dist((a["origin"]["x"], a["origin"]["z"]),
                                                    (b["origin"]["x"], b["origin"]["z"])), 4),
        "boundsGap": round(math.sqrt(sum(value * value for value in gaps)), 4),
        "boundsIntersect": intersecting,
        **({"overlapSize": dict(zip("xyz", (round(value, 4) for value in overlap)))} if intersecting else {}),
    }


def inspect_nodes(directory: str, node_ids: list[str], *, frame: int = 0) -> dict[str, Any]:
    """World-space mesh bounds plus derived grounding and pairwise distance / overlap."""
    if not 1 <= len(node_ids) <= 16 or len(set(node_ids)) != len(node_ids):
        raise LocalProjectError("USAGE_INVALID", "inspect nodes takes 1-16 distinct node ids")
    project = open_project(directory)
    snapshot = project.store.assemble()
    document = snapshot["document"]
    for node_id in node_ids:
        try:
            node_in(document, node_id)
        except ValueError as exc:
            raise LocalProjectError("DIRECTOR_NODE_NOT_FOUND", node_id) from exc
    mapping = local_asset_map(asset_catalog(project.paths))
    check_render_assets({"content": {"nodes": [node_in(document, node_id) for node_id in node_ids]}}, mapping)
    measured = director_cli("inspect-nodes", {
        "document": document, "fcurves": snapshot["fcurves"], "nodeIds": node_ids, "frames": [frame],
        "localAssets": mapping, "publicAssetBase": ""})
    ground = float(((document.get("content") or {}).get("environment") or {}).get("display", {}).get("groundHeight") or 0)
    nodes = []
    for row in measured.get("nodes") or []:
        row = dict(row)
        if row.get("status") == "measured" and row.get("type") != "camera":
            bottom = row["bounds"]["min"]["y"] - ground
            row["grounding"] = {"groundHeight": ground, "bottomOffset": round(bottom, 4),
                                "status": "grounded" if abs(bottom) <= GROUND_TOLERANCE
                                else ("floating" if bottom > 0 else "penetrating")}
        nodes.append(row)
    solid = [row for row in nodes if row.get("status") == "measured" and row.get("type") != "camera"]
    return {**base_result(project), "frame": frame, "ok": measured.get("ok") is True,
            "groundTolerance": GROUND_TOLERANCE, "nodes": nodes,
            "pairs": [_pair(a, b) for a, b in itertools.combinations(solid, 2)],
            "warnings": measured.get("warnings") or [], "blockedRequests": measured.get("blockedRequests") or []}


def _aggregate_issues(issues: Any) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for issue in issues or []:
        if not isinstance(issue, dict) or not issue.get("code"):
            continue
        key = (str(issue["code"]), str(issue.get("severity") or "warning"))
        row = grouped.setdefault(key, {"code": key[0], "severity": key[1], "nodeIds": []})
        if issue.get("nodeId") and issue["nodeId"] not in row["nodeIds"]:
            row["nodeIds"].append(issue["nodeId"])
    return list(grouped.values())


def _numerical(result: dict[str, Any]) -> dict[str, Any]:
    value = summarize_evaluate_frames(result)
    frames = []
    for frame in value.get("frames") or []:
        compact = {key: frame[key] for key in ("frame", "cameraTargetDistance", "targetInFrustum")
                   if frame.get(key) is not None}
        if len(compact) > 1:
            frames.append(compact)
    return {"ok": value.get("ok") is True, "issues": _aggregate_issues(value.get("issues")),
            **({"frames": frames} if frames else {})}


# Other nodes leaving a close shot is normal; only the camera's own target must stay in frame.
ADVISORY_ISSUES = frozenset({"MESH_OUTSIDE_FRUSTUM", "ORIGIN_OUTSIDE_FRUSTUM"})


def _view_blockers(row: dict[str, Any]) -> list[str]:
    camera = row["cameraNodeId"]
    numerical = row["numerical"]
    blockers = [f"{camera}: {issue['code']} {','.join(issue['nodeIds'])}".rstrip()
                for issue in numerical["issues"] if issue["code"] not in ADVISORY_ISSUES]
    if not numerical["ok"] and not blockers:
        blockers.append(f"{camera}: evaluation failed")
    missed = [frame["frame"] for frame in numerical.get("frames") or [] if frame.get("targetInFrustum") is False]
    if missed:
        blockers.append(f"{camera}: TARGET_OUTSIDE_FRUSTUM frames {','.join(map(str, missed))}")
    if row.get("renderStatus") != "complete":
        blockers.append(f"{camera}: render {row.get('renderStatus')}"
                        + (f" ({row['renderError']})" if row.get("renderError") else ""))
    return blockers


def _file(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: entry[key] for key in ("path", "sha256", "sizeBytes") if key in entry}


def _character_bounds(project: Any, snapshot: dict[str, Any], frames: list[int]) -> dict[str, dict[str, Any]]:
    """Posed mesh bounds of every visible character per frame, for grounding and framing checks."""
    document = snapshot["document"]
    ids = [node["id"] for node in document["content"]["nodes"]
           if node.get("type") == "character" and node.get("visible") is not False]
    if not ids:
        return {}
    mapping = local_asset_map(asset_catalog(project.paths))
    check_render_assets({"content": {"nodes": [node_in(document, node_id) for node_id in ids]}}, mapping)
    bounds: dict[str, dict[str, Any]] = {}
    for frame in frames:
        measured = director_cli("inspect-nodes", {
            "document": document, "fcurves": snapshot["fcurves"], "nodeIds": ids, "frames": [frame],
            "localAssets": mapping, "publicAssetBase": ""})
        bounds[str(frame)] = {row["nodeId"]: row["bounds"] for row in measured.get("nodes") or []
                              if row.get("status") == "measured" and row.get("bounds")}
    return bounds


def _default_views(document: dict[str, Any], cameras: list[str], frames: list[int]) -> list[dict[str, Any]]:
    ids = cameras or [node["id"] for node in document["content"]["nodes"] if node.get("type") == "camera"]
    return [{"cameraNodeId": camera_id, "frames": frames} for camera_id in ids]


def inspect_views(directory: str, views_path: str | None = None, *, cameras: list[str] | None = None,
                  frames: list[int] | None = None, primary: str | None = None) -> dict[str, Any]:
    """Numbers plus one render run per camera on one scene sequence; evidence goes to the BOM."""
    project = open_project(directory)
    snapshot = project.store.assemble()
    if views_path:
        if cameras or frames or primary:
            raise LocalProjectError("USAGE_INVALID", "use either a views file or --camera/--frames/--primary")
        spec = load_spec(views_path, "VIEWS_INVALID")
    else:
        spec = {"views": _default_views(snapshot["document"], cameras or [], frames or [0]),
                **({"primaryCameraNodeId": primary} if primary else {})}
    error = next(Draft7Validator(VIEWS_SCHEMA).iter_errors(spec), None)
    if error:
        raise LocalProjectError("VIEWS_INVALID", f"{'.'.join(map(str, error.path))}: {error.message[:450]}")
    check_scene_sequence(spec, snapshot["sceneSequence"])
    for view in spec["views"]:
        require_camera(snapshot["document"], view["cameraNodeId"])
    primary = spec.get("primaryCameraNodeId")
    if primary and primary not in {view["cameraNodeId"] for view in spec["views"]}:
        raise LocalProjectError("VIEWS_INVALID", "primaryCameraNodeId must be one of the views")
    size = {key: spec[key] for key in ("width", "height") if key in spec}
    geometry = check_primitive_geometry(snapshot["document"])
    bounds_error = None
    try:
        bounds = _character_bounds(project, snapshot,
                                   sorted({frame for view in spec["views"] for frame in view["frames"]}))
    except LocalProjectError as exc:
        bounds, bounds_error = {}, f"{exc.code}: {str(exc)[:200]}"
    rows = []
    for view in spec["views"]:
        row: dict[str, Any] = {**view, "sceneSequence": snapshot["sceneSequence"]}
        body = _camera(stored_evaluate_body(snapshot, view["frames"]), view["cameraNodeId"])
        if bounds:
            body["nodeBounds"] = bounds
        row["numerical"] = _numerical(director_cli("evaluate", body))
        try:
            rendered = render_snapshot(project, {**snapshot, "document": body["document"]},
                                       {"frames": view["frames"], "cameraNodeId": view["cameraNodeId"], **size})
        except LocalProjectError as exc:
            row.update(renderStatus="failed", renderError=f"{exc.code}: {str(exc)[:200]}")
            rows.append(row)
            continue
        output = rendered["result"]
        warnings = [str(item) for item in output.get("warnings") or []
                    if not any(marker in str(item) for marker in BENIGN_RENDER_WARNINGS)][:20]
        frame_files = [frame for frame in output.get("frames") or [] if isinstance(frame, dict)]
        row["render"] = {"runId": rendered["runId"], "contactSheet": _file(output.get("contactSheet") or {}),
                         "frameSha256s": [frame["sha256"] for frame in frame_files if frame.get("sha256")],
                         "frames": [{"frame": frame.get("frame"), **_file(frame)} for frame in frame_files]}
        if warnings:
            row["renderWarnings"] = warnings
        row["renderStatus"] = ("complete" if row["render"]["contactSheet"].get("path") and not output.get("blank")
                               and not warnings else "needs-review")
        rows.append(row)
    stale = open_project(directory).store.scene_sequence != snapshot["sceneSequence"]
    selected = next((row for row in rows if row["cameraNodeId"] == primary
                     and row.get("render", {}).get("contactSheet", {}).get("path")), None)
    blockers = [*(["the scene changed while inspecting; rerun"] if stale else []),
                *(f"geometry: {issue['code']} {issue.get('nodeId', '')}".rstrip() for issue in geometry["issues"]),
                *(blocker for row in rows for blocker in _view_blockers(row))]
    result = {
        **base_result(project), "stale": stale, "views": rows, "geometry": compact_geometry(geometry),
        "measurement": "character meshes" if bounds else f"character origins ({bounds_error or 'no characters'})",
        "checksComplete": not blockers, "checksBlockedBy": blockers[:20],
        "visualStatus": "pending-model-review",
    }
    if selected:
        result["primaryStoryPreview"] = {"cameraNodeId": primary, "frames": selected["frames"],
                                         "sceneSequence": snapshot["sceneSequence"],
                                         **selected["render"]["contactSheet"]}
    record_views(project, result)
    result["bomPath"] = str(project.paths.bom)
    return result

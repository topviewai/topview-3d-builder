"""Render runs under ``.topview-3d/renders/<runId>`` with the Node renderer and local model files."""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from topview_3d_cli.local_assets import asset_catalog, check_render_assets, local_asset_map
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import CLI_VERSION, Project, open_project
from topview_3d_cli.renderer import director_cli
from topview_3d_cli.runtime import builder_version

# Console noise from the headless page, not scene problems: the builder's two bundles each import
# Mediabunny, and SwiftShader reports ReadPixels stalls.
BENIGN_RENDER_WARNINGS = ("Mediabunny was loaded twice", "GPU stall due to ReadPixels")
RENDER_PAYLOAD_KEYS = {"frames", "width", "height", "cameraNodeId", "publicAssetBase"}


def document_sha256(document: dict[str, Any]) -> str:
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def require_camera(document: dict[str, Any], camera_id: str | None) -> str:
    """The camera to use: ``camera_id`` (which must exist and be a camera) or the document's default."""
    nodes = document["content"]["nodes"]
    if camera_id:
        node = next((item for item in nodes if item["id"] == camera_id), None)
        if node is None:
            raise LocalProjectError("CAMERA_NOT_FOUND", f"no node {camera_id!r}; cameras: "
                                    f"{[item['id'] for item in nodes if item.get('type') == 'camera']}",
                                    details={"cameraNodeId": camera_id})
        if node.get("type") != "camera":
            raise LocalProjectError("CAMERA_REQUIRED", f"{camera_id} is a {node.get('type')}, not a camera",
                                    details={"cameraNodeId": camera_id})
        return camera_id
    active = document["content"].get("activeShotCameraNodeId")
    if any(item["id"] == active and item.get("type") == "camera" for item in nodes):
        return active
    fallback = next((item["id"] for item in nodes if item.get("type") == "camera"), None)
    if fallback is None:
        raise LocalProjectError("CAMERA_REQUIRED", "the scene has no camera; add one with `node batch` add_camera")
    return fallback


def render_snapshot(project: Project, assembled: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """One render run of ``assembled``; the run directory is removed again when rendering fails."""
    body: dict[str, Any] = {"frames": [0], **options}
    mapping = local_asset_map(asset_catalog(project.paths))
    warnings = check_render_assets(assembled["document"], mapping, str(body.get("publicAssetBase") or ""))
    run_id = uuid.uuid4().hex
    output_dir = project.paths.renders / run_id
    body.update({
        "document": assembled["document"],
        "fcurves": assembled["fcurves"],
        "sceneSequence": assembled["sceneSequence"],
        "outputDir": str(output_dir),
        "publicAssetBase": body.get("publicAssetBase") or "",
        "localAssets": mapping,
        "metadata": {
            "revision": project.metadata.get("revision", 0),
            "documentSha256": document_sha256(assembled["document"]),
            "builderVersion": builder_version(),
            "cliVersion": CLI_VERSION,
        },
    })
    try:
        result = director_cli("render-frames", body)
    except LocalProjectError:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise
    if isinstance(result.get("warnings"), list):
        result["warnings"] = [item for item in result["warnings"]
                              if not any(marker in str(item) for marker in BENIGN_RENDER_WARNINGS)]
    return {"ok": True, "runId": run_id, **body["metadata"], "sceneSequence": assembled["sceneSequence"],
            "warnings": warnings, "result": result}


def render(directory: str, payload_path: str | None = None) -> dict[str, Any]:
    project = open_project(directory)
    options: dict[str, Any] = {}
    if payload_path:
        try:
            supplied = json.loads(Path(payload_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LocalProjectError("RENDER_PAYLOAD_INVALID", str(exc)) from exc
        if not isinstance(supplied, dict) or set(supplied) - RENDER_PAYLOAD_KEYS:
            raise LocalProjectError("RENDER_PAYLOAD_INVALID",
                                    f"payload must be an object with keys from {sorted(RENDER_PAYLOAD_KEYS)}")
        options.update(supplied)
    assembled = project.store.assemble()
    options["cameraNodeId"] = require_camera(assembled["document"], options.get("cameraNodeId"))
    return render_snapshot(project, assembled, options)

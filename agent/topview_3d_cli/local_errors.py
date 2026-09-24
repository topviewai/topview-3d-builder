"""Stable error codes and exit codes of the local ``topview-3d-cli`` CLI.

Keep this table in sync with ``docs/topview-3d-cli.md``; ``test_local_cli`` enforces it.
"""
from __future__ import annotations

from typing import Any

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_INVALID_INPUT = 2

# code -> (exit code, meaning)
ERROR_CODES: dict[str, tuple[int, str]] = {
    # Command line and input files
    "USAGE_INVALID": (2, "Unknown command, missing argument or bad option."),
    "PROJECT_NOT_INITIALIZED": (2, "The directory has no .topview-3d project; run `project init`."),
    "PROJECT_EXISTS": (2, "`project init` target already contains a project; pass --force to replace it."),
    "OPERATIONS_NOT_FOUND": (2, "The operations file does not exist."),
    "OPERATIONS_JSON_INVALID": (2, "The operations file is not JSON or not an operation batch."),
    "RENDER_PAYLOAD_INVALID": (2, "The render payload is not a JSON object of frames/width/height/cameraNodeId/publicAssetBase."),
    "ASSET_IMPORT_INVALID": (2, "`asset import` got a bad kind, id, file type, cover or pose JSON."),
    "ASSET_NOT_FOUND": (2, "No asset with that id and kind in the local manifests (in a batch, details.index)."),
    "POSE_TARGET_INVALID": (2, "`pose apply` / `pose batch` target is not a character."),
    "INPUT_NOT_FOUND": (2, "A spec, plan, views or checkpoint file does not exist."),
    "NODE_BATCH_INVALID": (2, "`node batch` spec is not JSON or fails the change schema."),
    "POSE_BATCH_INVALID": (2, "`pose batch` spec fails its schema or repeats a character."),
    "BATCH_TOO_LARGE": (2, "The edit compiles to more than 64 operations; split it."),
    "PLAN_INVALID": (2, "`evaluate` plan is not JSON or not exactly one of changes/operations."),
    "VIEWS_INVALID": (2, "`inspect views` spec fails its schema, or the primary camera is not among the views."),
    "CAMERA_REQUIRED": (2, "A --camera / cameraNodeId is not a camera node, or the scene has no camera."),
    "CAMERA_NOT_FOUND": (2, "A --camera / cameraNodeId names no node in the scene."),
    "DANGLING_REFERENCE": (2, "The batch would leave a clip, fcurves or node reference pointing at a missing node."),
    "ENTITY_NOT_FOUND": (2, "Delete targets an entity that never existed."),
    "DIRECTOR_NODE_NOT_FOUND": (2, "A referenced node does not exist (the message names it; batches add details.index)."),
    "DOCUMENT_ENTITY_NOT_FOUND": (2, "`document get --entity` found no node, clip or fcurves shard with that id."),
    "RENDER_NOT_FOUND": (2, "No such render run or frame image in .topview-3d/renders."),
    "BOM_CHECKPOINT_INVALID": (2, "`bom checkpoint` patch fails its schema or repeats/conflicts ids."),
    "BOM_TOO_LARGE": (2, "The merged BOM would exceed 64 KiB."),
    # Operation shape (nothing is applied)
    "INVALID_DIRECTOR_BATCH": (2, "Batch must contain 1..64 operations."),
    "INVALID_DIRECTOR_OPERATION": (2, "Operation is not an object or has a bad baseSequence/expectedEntityVersion."),
    "INVALID_OPERATION_ID": (2, "operationId must match [A-Za-z0-9_-]{1,128}."),
    "UNSUPPORTED_DIRECTOR_KIND": (2, "kind is not one of the seven director.* kinds."),
    "INVALID_DIRECTOR_PAYLOAD": (2, "payload is not an object or has missing/extra fields."),
    "INVALID_ENTITY_ID": (2, "entityId is missing, malformed, or not fcurves__<nodeId> for fcurves kinds."),
    "INVALID_DIRECTOR_SCENE": (2, "scene.set payload is invalid (entityId, nodes/clips in content, type/version)."),
    "INVALID_DIRECTOR_NODE": (2, "Node fails normalization/schema or node.id != entityId."),
    "INVALID_DIRECTOR_TRANSFORM": (2, "Node transform is not position/rotation/scale of finite x/y/z."),
    "INVALID_DIRECTOR_CLIP": (2, "Clip kind, id, frame range or camera motion.curves is invalid."),
    "INVALID_DIRECTOR_FCURVES": (2, "fcurves payload is not version 1 compact-v1 or fails its schema."),
    "INVALID_DIRECTOR_DOCUMENT": (2, "The batch would produce a document that fails the director schema."),
    # State conflicts (nothing is applied)
    "ENTITY_VERSION_CONFLICT": (1, "expectedEntityVersion does not match the entity's current version."),
    "ENTITY_DELETED": (1, "Target entity was deleted (strict mode also forbids recreating it)."),
    "ENTITY_TYPE_CONFLICT": (1, "entityId already belongs to another entity type."),
    "SEQUENCE_GAP": (1, "baseSequence is negative or ahead of the project's sceneSequence."),
    "OPERATION_KEY_REUSED": (1, "operationId was already accepted with a different body."),
    "SCENE_SEQUENCE_CONFLICT": (1, "expectedSceneSequence does not match the project; re-read and re-plan."),
    "DIRECTOR_NODE_LOCKED": (1, "`node delete` target is locked."),
    "NODE_BATCH_REJECTED": (1, "One `node batch` change cannot apply to the current scene (details: index, nodeId, reason)."),
    "POSE_BATCH_REJECTED": (1, "A pose target is locked or still has motion clips (details: index, nodeId, reason)."),
    "BOM_REVISION_CONFLICT": (1, "expectedBomRevision does not match the stored BOM."),
    "BOM_REVIEW_EVIDENCE_MISSING": (1, "modelReview needs current `inspect views` evidence with matching image sha256."),
    "DIRECTOR_LAST_CAMERA_REQUIRED": (1, "The last camera cannot be deleted."),
    "DIRECTOR_DELETE_CHILDREN_FIRST": (1, "Delete the node's children first."),
    "DIRECTOR_DELETE_TOO_MANY_DEPENDENCIES": (1, "Cascading delete would exceed one 64-operation batch."),
    # Project state and runtime
    "PROJECT_JSON_INVALID": (1, "A project state file is corrupt."),
    "PROJECT_FORMAT_UNSUPPORTED": (1, "The project was written by a newer CLI (schemaVersion too high)."),
    "DOCUMENT_INVALID": (1, "`document validate` found schema errors or references to missing nodes."),
    "BUILDER_PACKAGE_UNREADABLE": (1, "editor/packages/builder/package.json is missing or has no version."),
    "ASSET_MANIFEST_INVALID": (1, "An asset manifest is corrupt or lists a path outside its root."),
    "POSE_ASSET_INVALID": (1, "A pose file is larger than 1 MiB or lacks hips and 1-256 bone quaternions."),
    "BOM_JSON_INVALID": (1, ".topview-3d/bom.json is corrupt; fix or delete it."),
    "RENDER_IMAGE_INVALID": (1, "A render image is not a PNG or no longer matches the sha256 in render.json."),
    "ASSET_FILE_MISSING": (1, "A manifest entry points to a file that does not exist."),
    "ASSET_NOT_AVAILABLE": (1, "A character or prop model in the document has no local asset (see details)."),
    "RUNTIME_MISSING": (1, "The renderer runtime is missing (incomplete install, or an unbuilt checkout)."),
    "NODE_UNAVAILABLE": (1, "`node` is not on PATH."),
    "NPM_UNAVAILABLE": (1, "`browser ensure` needs `npm` (it ships with Node.js)."),
    "PLAYWRIGHT_INSTALL_FAILED": (1, "`browser ensure` could not install the pinned Playwright into the user cache."),
    "BROWSER_INSTALL_FAILED": (1, "`browser ensure` could not install or launch Chromium."),
    "BROWSER_NOT_INSTALLED": (1, "Playwright or Chromium is missing; run `topview-3d-cli browser ensure`."),
    "RENDER_FAILED": (1, "The Node renderer exited with an error."),
    "RENDERER_FAILED": (1, "A non-render Node renderer command (for example pose compilation) failed."),
    "RENDER_RESULT_MISSING": (1, "The Node renderer printed no result."),
    "RENDER_RESULT_INVALID": (1, "The Node renderer printed a non-JSON result."),
    "DOCTOR_FAILED": (1, "Plain `doctor` found a missing or outdated dependency (`doctor --json` always exits 0)."),
    "STUDIO_UNAVAILABLE": (1, "Studio is not in this install: it lives in editor/apps/studio of a checkout with Next.js installed."),
    "STUDIO_START_FAILED": (1, "Node started Studio, but it did not list this project on port 3002."),
    "STUDIO_PROJECT_MISSING": (1, "Studio is already running on port 3002 without this project; stop it and retry."),
    "INTERNAL_ERROR": (1, "Unexpected failure; the message carries the exception."),
}


def exit_code_for(code: str) -> int:
    return ERROR_CODES.get(code, (EXIT_FAILED, ""))[0]


class LocalProjectError(RuntimeError):
    """A stable, user-facing local project error (codes: ``ERROR_CODES``)."""

    def __init__(self, code: str, message: str | None = None, *, details: Any = None):
        self.code = code
        self.details = details
        super().__init__(message or code)

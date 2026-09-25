# `topview-3d-cli` local CLI contract

`topview-3d-cli` edits a local, offline director project with the same operation semantics as the hosted
`Scene3dLiveOperationService`, and renders it with the Node/Playwright renderer in
`editor/packages/director-cli`. Installation: see the README.

The agent skill in `skills/topview-3d-cli/` is written against this contract. `scripts/lint_skills.py`
checks every command and long option it quotes against the parser (`local_cli.command_table()`), so
renaming or removing a command or option fails the lint until the skill is updated.

## Output and exit codes

- Success: one JSON object on **stdout**, exit **0**.
- Failure: `{"ok": false, "code": "<CODE>", "error": "<message>"}` on **stderr**, plus `details`
  when there is more to say (the failing `index`, the missing reference, or a renderer's full
  `stderr`; the message itself stays one line).
  - Exit **2**: the input is wrong (usage, missing project, malformed file, invalid operation or payload,
    a reference to a node, asset, pose or camera that does not exist).
    Fix the input and retry.
  - Exit **1**: the input was well-formed but could not be carried out (version conflict, a missing
    dependency, a renderer failure, corrupt project state).
- `doctor --json` prints the JSON report and **always exits 0**; callers gate on its `ok` field.
  Plain `doctor` prints a human-readable report and exits 1 (`DOCTOR_FAILED`) when a check fails.
- A failed write command (`document apply`, `node delete`, `node batch`, `pose apply`, `pose batch`,
  `bom checkpoint`) never writes anything. Every state file stays byte-identical. `--dry-run` runs the
  full validation and reports the result, including the `sceneSequence` the write would reach.
- Spec files (`node batch`, `pose batch`, `evaluate`, `inspect views`, `bom checkpoint`) are JSON
  objects; `-` reads stdin. NaN and Infinity are rejected.

## Commands

| Command | Purpose |
| --- | --- |
| `topview-3d-cli --version` | Print the CLI version. |
| `topview-3d-cli doctor [--json]` | Check python ≥ 3.11, node ≥ 20.6, the renderer runtime (`packaged` or `workspace`, see below), the built-in assets, the pinned Playwright, and Chromium; in a checkout also pnpm. Each failing check carries a `hint`. |
| `topview-3d-cli browser ensure [--with-deps]` | Idempotent. Installs the pinned Playwright into the user cache (packaged runtime only, with the `npm` that ships with Node) and then Chromium into Playwright's browser cache. `--with-deps` also installs Linux system packages. `render` never downloads anything; it fails with `BROWSER_NOT_INSTALLED` instead. |
| `topview-3d-cli studio open <dir>` | From a repository checkout, start `editor/apps/studio` with Node on `127.0.0.1:3002` when that port is free. It records the absolute project path in the user cache, so a Studio already running for another directory can open this one. The `url` uses an id of that path, not the folder name. It does not open a browser. Fails with `STUDIO_UNAVAILABLE` outside a checkout, `STUDIO_PROJECT_MISSING` when the running Studio does not see this project yet, or `STUDIO_START_FAILED` when it does not become ready. |
| `topview-3d-cli project init <dir> [--force]` | Create `<dir>/.topview-3d/` holding the empty director document and default camera (`cam-main`). |
| `topview-3d-cli project status <dir>` | Metadata, a document summary, and dangling references. |
| `topview-3d-cli project adopt <dir> <edit.json\|->` | Write a Studio edit back into the entity store. The JSON object has `document`, `fcurves`, or both; the omitted side stays as stored. Later CLI commands then continue from that edit. `adopted` is false when nothing changed. |
| `topview-3d-cli document get <dir> [--summary \| --entity ID [--type node\|clip\|fcurves] [--include-curves]]` | Full document, merged fcurves, `entityVersions`, `sceneSequence`. `--summary` returns an outline without curves; `--entity` returns one node, clip or `fcurves__<nodeId>` shard with its `entityVersion` (`DOCUMENT_ENTITY_NOT_FOUND` otherwise). |
| `topview-3d-cli document validate <dir>` | Schema-validate the stored document and fcurves; fails with `DOCUMENT_INVALID` (and `details.danglingReferences`) when a clip, fcurves shard or node references a missing node. |
| `topview-3d-cli document apply <dir> <ops.json\|-> [--strict] [--dry-run]` | Apply one atomic batch. Refused with `DANGLING_REFERENCE` when it would add a reference to a missing node (references already stored do not block unrelated edits). |
| `topview-3d-cli node batch <dir> <spec.json\|-> [--dry-run]` | `{"expectedSceneSequence"?, "changes": [...]}` with 1..64 changes: `add_primitive`, `add_library` (`kind` `characters`/`props`, `libraryId` from the local manifests), `add_camera` (`presetId`, optional `subjectNodeId`), `update` (name, partial transform, `fov`, `distance`, or `view` = `{mode: world, position, target}` / `{mode: subject, subjectNodeId, offset, targetOffset}`), `delete` (cascading) and `repeat_primitive` (`nodeId_1..nodeId_count`). Changes are staged in order and compiled into one atomic batch of at most 64 operations. The result lists `createdIds`, `updatedIds`, `deletedIds`, compact `state` rows (primitives add `primitive: {kind, parameters, size}`, `size` scaled and before rotation) and the primitive `geometry` check. A change that cannot apply fails with `NODE_BATCH_REJECTED` and `details: {index, nodeId, reason}`; a missing node or asset fails with `DIRECTOR_NODE_NOT_FOUND` / `ASSET_NOT_FOUND` and the same details. |
| `topview-3d-cli node delete <dir> <nodeId> [--dry-run]` | Delete a node and, in the same batch, its clips, its `fcurves__<nodeId>`, and every reference to it (camera subject/lookAt target, children, transitions, editorial clips, physical constraints). |
| `topview-3d-cli render <dir> [payload.json]` | Render frames (default `[0]`) from the stored document and fcurves straight into `.topview-3d/renders/<runId>/`: `frame-<n>.png`, `contact-sheet.png` and `render.json` (run id, time, resolution, camera, sceneSequence, revision, document SHA-256, builder and CLI versions, blocked requests). The payload may only set `frames`, `width`, `height`, `cameraNodeId` and `publicAssetBase`. Models resolve through the local asset manifests; a missing character/prop model fails with `ASSET_NOT_AVAILABLE`, a missing motion only adds `MOTION_NOT_AVAILABLE:<id>` to `warnings` (the character keeps its pose/fcurves). Chromium blocks every request outside the local server and the optional `publicAssetBase`. `cameraNodeId` is checked before the renderer starts (`CAMERA_NOT_FOUND`, or `CAMERA_REQUIRED` for a non-camera node or a scene without cameras). Known headless console noise (`Mediabunny was loaded twice`, `GPU stall due to ReadPixels`) is dropped from the renderer's `warnings`. |
| `topview-3d-cli evaluate <dir> [plan.json\|-] [--frames 0,24] [--camera ID]` | Numerical checks (camera framing, origins in frustum, ground penetration, non-finite transforms) of the stored scene, or of a plan staged in memory: `{"changes": [...]}` (the `node batch` syntax) or `{"operations": [...]}` (the `document apply` syntax), plus optional `expectedSceneSequence`. Pure Node, no browser. Nothing is written (`persisted: false`). |
| `topview-3d-cli inspect nodes <dir> <nodeId>… [--frame N]` | Chromium mesh measurement of 1..16 nodes: world `bounds`, `size`, `origin`, landmarks or support surfaces, plus `grounding` (`grounded`/`floating`/`penetrating` against `groundHeight`, tolerance 0.02) and `pairs` (origin distance, horizontal distance, bounds gap, `boundsIntersect` and `overlapSize`). |
| `topview-3d-cli inspect views <dir> [views.json\|-] [--camera ID]… [--frames 0,24] [--primary ID]` | For each camera (default: every camera, frame 0), numerical checks plus one render run in `.topview-3d/renders/`. The spec is `{"expectedSceneSequence"?, "views": [{cameraNodeId, frames (1..3)}] (1..8), "width"?, "height"?, "primaryCameraNodeId"?}`. Characters are measured by their posed mesh bounds (`measurement`), so grounding and target framing follow the mesh, not the origin. Returns `renderStatus` per view, `checksComplete` with `checksBlockedBy` (stale scene, geometry issues, errors or below-ground warnings, the camera's target out of frame, incomplete renders; other nodes outside the frustum are informational), `primaryStoryPreview`, and records the evidence as the BOM `verification`. |
| `topview-3d-cli renders list <dir>` | Render runs from each `render.json`, oldest first, with `stale` when the run's `sceneSequence` is not the current one. |
| `topview-3d-cli renders show <dir> [runId] [--frame N]` | Absolute path, size and verified sha256 of the contact sheet (default) or one frame of a run (default: latest). `RENDER_NOT_FOUND` / `RENDER_IMAGE_INVALID` otherwise. |
| `topview-3d-cli camera presets` | Camera preset ids, names and fov for `add_camera`. |
| `topview-3d-cli bom get <dir>` | The plan / constraint record `.topview-3d/bom.json` (empty when missing) with `observed` nodes and `verification.stale` derived from the current scene. |
| `topview-3d-cli bom checkpoint <dir> <patch.json\|->` | Merge `intent`, `relationships`, `constraints`, `cameras`, `notes`, `remove` and/or `modelReview` with compare-and-set on `expectedSceneSequence` and `expectedBomRevision`. `modelReview` needs current `inspect views` evidence; an omitted `sha256` is filled from it. |
| `topview-3d-cli asset list [<dir>] [--kind K]` | List built-in assets, plus the project's `.topview-3d/assets` when `<dir>` is given (project entries override built-ins with the same id). |
| `topview-3d-cli asset import (--project <dir> \| --builtin) <file> --kind character\|prop\|pose --id ID [--key K] [--cover IMG] [--name N] [--rig R] [--license L] [--source S]` | Copy a `.glb`/`.gltf` model or pose `.json` (and an optional `.webp`/`.png`/`.jpg` cover) into the asset root and add its manifest entry (size and SHA-256 recorded). `--key` is the value documents use in `metadata.modelUrl`. |
| `topview-3d-cli asset search [query] [--project <dir>] [--kind K] [--category C] [--tag T]… [--rig R] [--limit 20] [--offset 0]` | Every query token must match name, id, category, tags or rig (case-insensitive). Results are scored (name 3, exact tag 2, other fields 1) and carry `facets` (kind, category, rig, top tags) over all matches, `total`, `complete` and `nextOffset`. |
| `topview-3d-cli asset show <id> [--project <dir>] [--kind K]` | One entry with its absolute `path` and `coverPath`, pose `boneCount`/`hips`, and a `usage` snippet (a `node batch` change or a `pose batch` item). Pose ids work without the `a3d_pose_` prefix. |
| `topview-3d-cli pose catalog [--project <dir>] [--category C] [--tag T]` | Every pose sorted by category and name, with the category counts. |
| `topview-3d-cli pose apply <dir> <nodeId> <poseId> [--dry-run]` | A one-item `pose batch`. |
| `topview-3d-cli pose batch <dir> <spec.json\|-> [--dry-run]` | `{"expectedSceneSequence"?, "items": [{nodeId, poseId \| libraryId, position?, rotation?, scale?}]}` (1..16 characters, each once). Poses compile in one Chromium page onto the characters' joint controls; transforms apply afterwards; all in one batch. A locked character or one with motion clips fails with `POSE_BATCH_REJECTED`. |

### Operation batch

`document apply` accepts either an array of operations or
`{"schemaVersion": 2, "batchId": "...", "expectedSceneSequence": N, "operations": [...]}` (all but
`operations` optional). With `expectedSceneSequence` the batch is refused with
`SCENE_SEQUENCE_CONFLICT` (`details: {expected, current}`) unless the project is at that sequence.
`-` reads the batch from stdin.

- A batch holds 1..64 operations, applied all-or-nothing.
- Each operation is `{operationId?, kind, entityId, payload, baseSequence?, expectedEntityVersion?}`.
- A missing `operationId` is filled in with `cli_<random>`.

| kind | entityId | payload (exact keys) |
| --- | --- | --- |
| `director.scene.set` | `director` | `{scene: {content: {...}}}`. This is a shallow merge of content fields; `nodes` and clip arrays are rejected. |
| `director.node.upsert` | node id | `{node}`. The node is normalized and schema-checked. |
| `director.node.delete` | node id | `{}`. Deletes **only** the node (hosted-service parity); `node delete` handles the cascade. |
| `director.clip.upsert` | clip id | `{clipKind: cameraMotion\|motion\|pathMotion, clip}` |
| `director.clip.delete` | clip id | `{}` |
| `director.fcurves.set` | `fcurves__<nodeId>` | `{version: 1, encoding: "compact-v1", fcurves: [...]}`. Every curve targets `t: ["node", <nodeId>]`. |
| `director.fcurves.delete` | `fcurves__<nodeId>` | `{}` |

References to missing nodes or clips are not errors. They appear as `warnings` in the result and as
`danglingReferences` in `status` and `validate`.

## Single-writer versioning

A local project has exactly one writer: the process running `topview-3d-cli`. No lock file is taken, so do
not run two writing commands against the same project at once. Within that model:

- `sceneSequence` rises by 1 for every accepted operation. Genesis (`project init`) uses 2: one for
  `scene.set` and one for the default camera.
- `baseSequence` is optional. If supplied, it must satisfy `0 ≤ baseSequence ≤ sceneSequence`, otherwise
  `SEQUENCE_GAP`. A stale (lower) base is accepted, as in the hosted service.
- `expectedEntityVersion`:
  - **Default (local) mode.**
    - Omitted or `null` overwrites the entity, whatever its current version.
    - A number must equal the current version.
    - A deleted id may be recreated, and its version continues from the tombstone.
  - **`--strict`** (hosted-service mode).
    - Creation requires `null` and yields version 1.
    - Updates and deletes require the exact current version.
    - Deleted ids stay deleted (`ENTITY_DELETED`).
- `operationId` is an idempotency key. Replaying the same body returns the original result without
  re-applying it. Reusing the id with a different body raises `OPERATION_KEY_REUSED`.

## Project format (schemaVersion 2)

```
<dir>/.topview-3d/
  metadata.json   format, schemaVersion, cliVersion, builderVersion, revision, sceneSequence, updatedAt
  entities.json   authoritative entity store: versions, tombstones, sequence, operation log
  document.json   derived: assembled director document (read-only view)
  fcurves.json    derived: merged compact-v1 fcurves (read-only view)
  bom.json        plan / constraint record written by `bom checkpoint` and `inspect views`
  assets/  renders/
```

- Each successful write:
  - validates the assembled document and fcurves;
  - writes `entities.json`, then the derived views, then `metadata.json`, each atomically (temp file + rename);
  - increments `revision` by 1.
- Hand edits to `document.json` or `fcurves.json` are ignored and overwritten on the next write.
- A schemaVersion 1 project (only `document.json`) is read through an in-memory genesis migration.
  `status` reports `migrationPending`, and the next write persists schemaVersion 2.
- `agent/topview_3d_cli/tests/fixtures/local-project/` is a reference project, rebuilt by applying its
  `operations.json` to a fresh `project init`.

## Runtime

The Python package finds the Node renderer in one of two places:

- **packaged** (installed wheel): the renderer, the builder build, the Draco decoder and the built-in
  assets ship inside the package (`topview_3d_cli/_runtime/`). Playwright is installed by
  `browser ensure` into the user cache, `<cache>/node/<cliVersion>/`, where `<cache>` is
  `~/Library/Caches/topview-3d-cli` (macOS), `%LOCALAPPDATA%\topview-3d-cli\Cache` (Windows) or
  `$XDG_CACHE_HOME/topview-3d-cli` / `~/.cache/topview-3d-cli` (Linux). `TOPVIEW3D_CACHE_DIR` overrides `<cache>`.
- **workspace** (editable install in a checkout): `editor/packages/director-cli`, the builder `dist/`
  and `builtin-assets/` straight from the repository; Playwright comes from the pnpm workspace.

A checkout wins when both exist; `TOPVIEW3D_RUNTIME=packaged|workspace` forces one.

## Offline assets

Rendering never downloads assets by default. Two manifests (`manifest.json`, format
`scene3d-asset-manifest`, version 1) list what exists locally:

- the built-in root: `builtin-assets/` in a checkout, shipped inside the package otherwise (override
  with `TOPVIEW3D_BUILTIN_ASSETS`);
- the project root `<dir>/.topview-3d/assets/` (filled by `asset import --project`).

Each entry has `id`, `kind` (`character`, `prop`, `pose` or `primitive`) and `name`.
The repository ships the four built-in characters (Child, Youth, Female, Man), 121 poses with cover
images, and the five primitives. The characters, poses, and covers are Topview assets under CC-BY-4.0
(`builtin-assets/LICENSE`, attribution "© Topview, CC BY 4.0" in each entry's `attribution`); the code is
Apache-2.0. File-backed
entries also have `file` (relative to the manifest; `..` is rejected), `bytes` and `sha256`. Characters
and props need `key`, the value documents store in `metadata.modelUrl`. Primitives carry
`primitive.kind` and `primitive.parameters` and need no file. Optional fields: `category`, `tags`,
`rig`, `license`, `attribution`, `source`, `cover` (an image relative to the manifest).

Phase 1 ships no motion library. A motion clip whose asset is not local still renders (the character
keeps its base pose, pose controls and fcurves) and `render` reports `MOTION_NOT_AVAILABLE:<id>`.

`publicAssetBase` (render payload, or `TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE`) is empty by default. When set,
`3d-builder/public/...` keys missing locally are loaded from it, and its origin becomes the only external
origin Chromium may reach.

## Error codes

This table must match `agent/topview_3d_cli/local_errors.py`; `test_local_cli.py` enforces it.

| Code | Exit | Meaning |
| --- | --- | --- |
| `USAGE_INVALID` | 2 | Unknown command, missing argument or bad option. |
| `PROJECT_NOT_INITIALIZED` | 2 | The directory has no .topview-3d project; run `project init`. |
| `PROJECT_EXISTS` | 2 | `project init` target already contains a project; pass --force to replace it. |
| `PROJECT_ADOPT_INVALID` | 2 | `project adopt` body must be a JSON object with document and/or fcurves. |
| `OPERATIONS_NOT_FOUND` | 2 | The operations file does not exist. |
| `OPERATIONS_JSON_INVALID` | 2 | The operations file is not JSON or not an operation batch. |
| `RENDER_PAYLOAD_INVALID` | 2 | The render payload is not a JSON object of frames/width/height/cameraNodeId/publicAssetBase. |
| `ASSET_IMPORT_INVALID` | 2 | `asset import` got a bad kind, id, file type, cover or pose JSON. |
| `ASSET_NOT_FOUND` | 2 | No asset with that id and kind in the local manifests (in a batch, details.index). |
| `POSE_TARGET_INVALID` | 2 | `pose apply` / `pose batch` target is not a character. |
| `INPUT_NOT_FOUND` | 2 | A spec, plan, views or checkpoint file does not exist. |
| `NODE_BATCH_INVALID` | 2 | `node batch` spec is not JSON or fails the change schema. |
| `POSE_BATCH_INVALID` | 2 | `pose batch` spec fails its schema or repeats a character. |
| `BATCH_TOO_LARGE` | 2 | The edit compiles to more than 64 operations; split it. |
| `PLAN_INVALID` | 2 | `evaluate` plan is not JSON or not exactly one of changes/operations. |
| `VIEWS_INVALID` | 2 | `inspect views` spec fails its schema, or the primary camera is not among the views. |
| `CAMERA_REQUIRED` | 2 | A --camera / cameraNodeId is not a camera node, or the scene has no camera. |
| `CAMERA_NOT_FOUND` | 2 | A --camera / cameraNodeId names no node in the scene. |
| `DANGLING_REFERENCE` | 2 | The batch would leave a clip, fcurves or node reference pointing at a missing node. |
| `ENTITY_NOT_FOUND` | 2 | Delete targets an entity that never existed. |
| `DIRECTOR_NODE_NOT_FOUND` | 2 | A referenced node does not exist (the message names it; batches add details.index). |
| `DOCUMENT_ENTITY_NOT_FOUND` | 2 | `document get --entity` found no node, clip or fcurves shard with that id. |
| `RENDER_NOT_FOUND` | 2 | No such render run or frame image in .topview-3d/renders. |
| `BOM_CHECKPOINT_INVALID` | 2 | `bom checkpoint` patch fails its schema or repeats/conflicts ids. |
| `BOM_TOO_LARGE` | 2 | The merged BOM would exceed 64 KiB. |
| `INVALID_DIRECTOR_BATCH` | 2 | Batch must contain 1..64 operations. |
| `INVALID_DIRECTOR_OPERATION` | 2 | Operation is not an object or has a bad baseSequence/expectedEntityVersion. |
| `INVALID_OPERATION_ID` | 2 | operationId must match [A-Za-z0-9_-]{1,128}. |
| `UNSUPPORTED_DIRECTOR_KIND` | 2 | kind is not one of the seven director.* kinds. |
| `INVALID_DIRECTOR_PAYLOAD` | 2 | payload is not an object or has missing/extra fields. |
| `INVALID_ENTITY_ID` | 2 | entityId is missing, malformed, or not fcurves__<nodeId> for fcurves kinds. |
| `INVALID_DIRECTOR_SCENE` | 2 | scene.set payload is invalid (entityId, nodes/clips in content, type/version). |
| `INVALID_DIRECTOR_NODE` | 2 | Node fails normalization/schema or node.id != entityId. |
| `INVALID_DIRECTOR_TRANSFORM` | 2 | Node transform is not position/rotation/scale of finite x/y/z. |
| `INVALID_DIRECTOR_CLIP` | 2 | Clip kind, id, frame range or camera motion.curves is invalid. |
| `INVALID_DIRECTOR_FCURVES` | 2 | fcurves payload is not version 1 compact-v1 or fails its schema. |
| `INVALID_DIRECTOR_DOCUMENT` | 2 | The batch would produce a document that fails the director schema. |
| `ENTITY_VERSION_CONFLICT` | 1 | expectedEntityVersion does not match the entity's current version. |
| `ENTITY_DELETED` | 1 | Target entity was deleted (strict mode also forbids recreating it). |
| `ENTITY_TYPE_CONFLICT` | 1 | entityId already belongs to another entity type. |
| `SEQUENCE_GAP` | 1 | baseSequence is negative or ahead of the project's sceneSequence. |
| `OPERATION_KEY_REUSED` | 1 | operationId was already accepted with a different body. |
| `SCENE_SEQUENCE_CONFLICT` | 1 | expectedSceneSequence does not match the project; re-read and re-plan. |
| `DIRECTOR_NODE_LOCKED` | 1 | `node delete` target is locked. |
| `NODE_BATCH_REJECTED` | 1 | One `node batch` change cannot apply to the current scene (details: index, nodeId, reason). |
| `POSE_BATCH_REJECTED` | 1 | A pose target is locked or still has motion clips (details: index, nodeId, reason). |
| `BOM_REVISION_CONFLICT` | 1 | expectedBomRevision does not match the stored BOM. |
| `BOM_REVIEW_EVIDENCE_MISSING` | 1 | modelReview needs current `inspect views` evidence with matching image sha256. |
| `DIRECTOR_LAST_CAMERA_REQUIRED` | 1 | The last camera cannot be deleted. |
| `DIRECTOR_DELETE_CHILDREN_FIRST` | 1 | Delete the node's children first. |
| `DIRECTOR_DELETE_TOO_MANY_DEPENDENCIES` | 1 | Cascading delete would exceed one 64-operation batch. |
| `PROJECT_JSON_INVALID` | 1 | A project state file is corrupt. |
| `PROJECT_FORMAT_UNSUPPORTED` | 1 | The project was written by a newer CLI (schemaVersion too high). |
| `DOCUMENT_INVALID` | 1 | `document validate` found schema errors or references to missing nodes. |
| `BUILDER_PACKAGE_UNREADABLE` | 1 | editor/packages/builder/package.json is missing or has no version. |
| `ASSET_MANIFEST_INVALID` | 1 | An asset manifest is corrupt or lists a path outside its root. |
| `POSE_ASSET_INVALID` | 1 | A pose file is larger than 1 MiB or lacks hips and 1-256 bone quaternions. |
| `BOM_JSON_INVALID` | 1 | .topview-3d/bom.json is corrupt; fix or delete it. |
| `RENDER_IMAGE_INVALID` | 1 | A render image is not a PNG or no longer matches the sha256 in render.json. |
| `ASSET_FILE_MISSING` | 1 | A manifest entry points to a file that does not exist. |
| `ASSET_NOT_AVAILABLE` | 1 | A character or prop model in the document has no local asset (see details). |
| `RUNTIME_MISSING` | 1 | The renderer runtime is missing (incomplete install, or an unbuilt checkout). |
| `NODE_UNAVAILABLE` | 1 | `node` is not on PATH. |
| `NPM_UNAVAILABLE` | 1 | `browser ensure` needs `npm` (it ships with Node.js). |
| `PLAYWRIGHT_INSTALL_FAILED` | 1 | `browser ensure` could not install the pinned Playwright into the user cache. |
| `BROWSER_INSTALL_FAILED` | 1 | `browser ensure` could not install or launch Chromium. |
| `BROWSER_NOT_INSTALLED` | 1 | Playwright or Chromium is missing; run `topview-3d-cli browser ensure`. |
| `RENDER_FAILED` | 1 | The Node renderer exited with an error. |
| `RENDERER_FAILED` | 1 | A non-render Node renderer command (for example pose compilation) failed. |
| `RENDER_RESULT_MISSING` | 1 | The Node renderer printed no result. |
| `RENDER_RESULT_INVALID` | 1 | The Node renderer printed a non-JSON result. |
| `DOCTOR_FAILED` | 1 | Plain `doctor` found a missing or outdated dependency (`doctor --json` always exits 0). |
| `STUDIO_UNAVAILABLE` | 1 | Studio is not in this install: it lives in editor/apps/studio of a checkout with Next.js installed. |
| `STUDIO_START_FAILED` | 1 | Node started Studio, but it did not list this project on port 3002. |
| `STUDIO_PROJECT_MISSING` | 1 | Studio is already running on port 3002 without this project; stop it and retry. |
| `INTERNAL_ERROR` | 1 | Unexpected failure; the message carries the exception. |

# EDIT mode

Start from the existing document and change only what the user asks. Every change is a
topview-3d-cli write (`node batch`, `pose batch`, or `document apply`). Do not edit the open
Studio page, and do not use browser automation to move nodes.

- Read `layout.md` if not yet read; reconcile `topview-3d-cli bom get` with
  `topview-3d-cli document get --summary` and apply the layout procedure to the affected objects and their
  dependents. After changes, checkpoint retired references and reset affected relations to
  `unknown`.
- Additions follow `add-prop.md` and `add-character.md`, including the pose after placement. Add
  props before people, and cameras after their subjects exist.
- Prefer primitives for new props and requested replacements; do not replace existing objects
  merely because they could be simplified.
- All structural changes go through `topview-3d-cli node batch` (contract below): `update` to move,
  rotate, scale, rename or change a camera's `fov` / `distance`; `delete` to remove. Delete also
  removes dependent clips, curves and camera references and protects the last camera
  (`topview-3d-cli node delete <dir> <id>` does the same for one node). Never rebuild the document to
  remove one object.
- A requested posture change on an existing person follows `pose.md`; keep the identity and model
  and verify support contact again.
- For cameras, prefer an `update` with `view` (see `camera.md`) so position and aim are explicit.
  Use `distance` alone only when the existing aim is right; it moves along the look-at line and is
  not a FOV change.
- Preserve unrelated nodes, camera targets, timeline settings, animation and cuts. Existing
  keyframes can override static transforms at some frames; surface the conflict and verify the
  requested frame instead of deleting the curves.
- Keep the dedicated bird's-eye inspection camera (BOM camera role `layout_overview`) and refit it
  to the updated layout per `camera.md`; no duplicates.

Before changing transforms, read `checks.md` and dry-run the plan. Position is absolute; omitted
axes stay unchanged. Rotation is in degrees; scale must be positive (`0.001` for a very thin
axis). A node cannot be deleted while locked, while it is a non-empty group, or when it is the
last camera.

## Batch node changes

`topview-3d-cli node batch <dir> changes.json [--dry-run]` takes the current `expectedSceneSequence` and
1–64 ordered `changes`. topview-3d-cli supplies operation ids and entity versions, stages the whole batch
on a copy, then writes it at once. Later changes may refer to nodes created earlier in the same
batch. An add cannot overwrite an existing node. Invalid input or a stale sequence rejects the
whole batch with nothing written (`NODE_BATCH_INVALID`, `NODE_BATCH_REJECTED` with
`details.index`, `SCENE_SEQUENCE_CONFLICT`): re-read and re-plan rather than resubmitting blindly.
A change naming a node or asset that does not exist fails with `DIRECTOR_NODE_NOT_FOUND` or
`ASSET_NOT_FOUND` (exit 2, also with `details.index`).
Dependency cleanup counts toward the 64-operation limit (`BATCH_TOO_LARGE`); split a large batch
at a meaningful stage boundary.

Each change has `action` and an explicit `nodeId`:

- `add_primitive`: `primitive: {kind, parameters}` per the contract in `add-prop.md`; optional
  `name` and partial `position` / `rotation` / `scale`.
- `repeat_primitive`: the same geometry and transform plus `count` (2–32) and a full XYZ `step`;
  creates the nodes `NODE_1` … `NODE_N`, where NODE is the given `nodeId` and N is `count`. The 64-change limit applies after expansion.
- `add_library`: `kind: "characters" | "props"` and the full `libraryId`; optional `name` and
  partial transforms.
- `add_camera`: `presetId` (from `topview-3d-cli camera presets`), optional `name`, `subjectNodeId`,
  `view` and `fov`. `view.mode: "world"` takes complete `position` and `target`;
  `view.mode: "subject"` takes the character's `subjectNodeId`, `offset` and `targetOffset`.
- `update`: any combination of `name`, partial `position` / `rotation` / `scale`, camera `fov` /
  `distance`, or `view` + `fov`. Omitted axes stay. Never combine `view` with a separate position,
  rotation, `distance` or `subjectNodeId`, or position with `distance`.
- `delete`: only `nodeId`. Delete children before their group; add a replacement camera before
  deleting the last one.

The result has `createdIds`, `updatedIds`, `deletedIds`, `sceneSequence`, `operationCount`,
`state` (per-node transform and entity version, plus `primitive.kind`, `parameters` and scaled
`size` for primitives) and the primitive `geometry` check. Updated ids
include cameras and parents adjusted by delete cleanup. Poses go through `topview-3d-cli pose batch`.

Example (replace the ids and sequence with current values):

```json
{"expectedSceneSequence": 12, "changes": [
  {"action": "update", "nodeId": "hero", "position": {"x": 1.2, "z": 2}, "rotation": {"y": 90}},
  {"action": "update", "nodeId": "cam-main",
   "view": {"mode": "world", "position": {"x": 0, "y": 1.4, "z": 4}, "target": {"x": 0, "y": 1.4, "z": 0}},
   "fov": 45},
  {"action": "delete", "nodeId": "obsolete_prop"}
]}
```

## Movement with keyframes

There is no motion library, so limbs never animate. When the user explicitly wants movement
(someone crossing the room, a door swinging, a camera push-in), keep a fitting static pose and add
keyframes to the node's root transform with `topview-3d-cli document apply`. Curves exist for `transform.position`,
`transform.rotation` (degrees) and `transform.scale`; `i` is the axis (0 = x, 1 = y, 2 = z) and
each keyframe is `[frame, value, "linear" | "bezier"]`. One `director.fcurves.set` replaces every curve
of that node, so read the existing ones first with
`topview-3d-cli document get <dir> --entity fcurves__<nodeId> --include-curves`
(`DOCUMENT_ENTITY_NOT_FOUND` means the node has no keyframes yet).

```json
{"expectedSceneSequence": 14, "operations": [{"kind": "director.fcurves.set", "entityId": "fcurves__hero",
  "payload": {"version": 1, "encoding": "compact-v1", "fcurves": [
    {"id": "hero-x", "t": ["node", "hero"], "p": "transform.position", "i": 0,
     "k": [[0, -1.5, "linear"], [96, 1.5, "linear"]]}
  ]}}]}
```

The same file works for both steps: preview it with
`topview-3d-cli evaluate <dir> motion.json --frames 0,48,96` and `topview-3d-cli document apply <dir> motion.json --dry-run`,
then apply it and check the start, middle and end frames with
`topview-3d-cli inspect views <dir> --camera <id> --frames 0,48,96`.
A walking stride pose sliding across the floor is still a static pose; say so.

The optional top-level `expectedSceneSequence` makes `document apply` refuse the file with
`SCENE_SEQUENCE_CONFLICT` (details `expected`, `current`) when the project moved on; always include
it. `document apply` also refuses operations that would leave a reference to a missing node
(`DANGLING_REFERENCE`, exit 2, listing each `entityId.field -> ref`), and `document validate` fails
with `DOCUMENT_INVALID` when such references are already stored. Remove the curves with a
`director.fcurves.delete` operation on the same entity id; every operation needs a `payload`, which
is empty here:

```json
{"expectedSceneSequence": 15, "operations": [
  {"kind": "director.fcurves.delete", "entityId": "fcurves__hero", "payload": {}}]}
```

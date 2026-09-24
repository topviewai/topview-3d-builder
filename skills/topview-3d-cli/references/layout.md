# Layout from the BOM (NEW and EDIT)

The scene document is the authority for the actual nodes, transforms, geometry, poses and camera
settings. The BOM (`.topview-3d/bom.json`) stores only the meaning and requirements the scene cannot
reconstruct. It is not a second scene snapshot and not a constraint solver.

Layout represents physical space abstractly so that several cameras describe one consistent world.
Prioritize the relative positions of all characters and their relationships to entrances, paths
and essential props. Then solve proportions, support and contact, clearance, facing and depth
layers. Use recognizable simple shapes; decorative detail does not improve the spatial contract.
Record these relationships once in the BOM and keep them across cameras; do not move subjects
separately for each shot.

## BOM fields you write (`topview-3d-cli bom checkpoint`)

Pass the current `expectedSceneSequence` and `expectedBomRevision` (both from `topview-3d-cli bom get`).
`relationships`, `constraints` and `cameras` merge by stable `id`; `remove` retires ids. `intent`
and `notes` are replaced only when supplied. Keep the whole record compact (at most 64 KiB).

- **intent**: the user's request in their own words, the inferred purpose (labelled as inference),
  active requirements, assumptions, open questions.
- **relationships**: one entry per spatial relation: `id`, `type` (beside / faces / behind /
  sits_on / approaches …), `subjectId`, `targetId`, `priority` (`hard` / `soft`), `source` (the
  user's wording or "design choice"), concise `parameters` (reference frame for left / right /
  behind, centre distance or surface gap, tolerance) and `status` (`unknown` / `passed` /
  `failed`). Missing evidence is `unknown`, never a pass.
- **constraints**: durable decisions: story identity → node ids (all parts of one object),
  established model-local fronts, measured support heights and seat surfaces that an active
  relation depends on (with the `sceneSequence` they were measured at), 180° axis endpoints and
  the chosen side.
- **cameras**: stable `id` and `nodeId`, `role` (`story` / `layout_overview`), a concise purpose
  and subject ids. Actual transforms and lens values stay in the scene.
- **notes**: short reminders: pending work, blockers, simplifications you told the user about.

A minimal patch:

```json
{
  "expectedSceneSequence": 12,
  "expectedBomRevision": 3,
  "relationships": [
    {"id": "rel-a-faces-b", "type": "faces", "subjectId": "person-a", "targetId": "person-b",
     "priority": "hard", "source": "user: they talk face to face", "status": "unknown"}
  ],
  "cameras": [
    {"id": "overview", "nodeId": "cam-overview", "role": "layout_overview", "purpose": "layout evidence"}
  ]
}
```

Do not store full nodes, primitive parameters, model paths, default transforms, bounds arrays or
repeated prose; ids let the commands recover those. `observed` and `verification` are derived by
topview-3d-cli (`inspect views` records verification): read them, never write them. Submit visual
judgments separately in `modelReview` with exact camera, frame and image hash evidence (see
`checks.md`). `verification.stale: true` means the scene changed after the last complete check.

## Plan, apply and reconcile

1. **Inventory and constrain.** Match the identities in BOM `constraints` to the nodes in
   `topview-3d-cli document get <dir> --summary`. Reconcile changes made outside this session, confirmed
   deletions and dependent support or camera links. Retire superseded relations; never resurrect a
   deleted object from stale notes. In EDIT keep unrelated nodes. Checkpoint new or changed
   identities and relations before editing, not a full numeric plan.
2. **Choose and measure.** Prefer 1–4 basic shapes per suitable prop (`add-prop.md`,
   `add-character.md`). Proposed dimensions are not evidence. `node batch` returns each primitive's
   `primitive.size` in `state.nodes` (scaled, before rotation); measure characters, imported props and
   anything rotated, scaled or
   posed with `topview-3d-cli inspect nodes <dir> <id>...`.
3. **Solve support and facing.** Place anchors and supporting props, then dependent props, then
   people. Use actual bounds, origin offsets, support heights and intended gaps: for a
   translation-only grounding move, delta Y = support height − world minimum Y + intended gap;
   measure again after a rotation, scale or pose. Move assemblies around their shared pivot and
   update every part. Establish the semantic front visually before computing facing; local +Z or
   zero yaw proves nothing. Body facing, gaze and pose are separate constraints. Resolve
   conflicting hard requirements; relax design preferences first.
4. **Dry-run and batch.** Every write needs the current `expectedSceneSequence` (from
   `document get --summary` or the previous write's result). Send the proposed changes to
   `topview-3d-cli evaluate <dir> plan.json` and compare its flags with the BOM relations; then run
   `topview-3d-cli node batch <dir> changes.json --dry-run` and finally without `--dry-run`. Use one batch
   for supports and props, one for people, one for cameras, respecting dependencies. Combine a
   node's name, position, rotation and scale in one change; use an explicit camera `view` plus
   `fov` when changing aim. `evaluate` does not load the BOM or solve contacts. On
   `SCENE_SEQUENCE_CONFLICT` re-read the state; do not replay or bump the number blindly.
5. **Fit people and pose.** Place first, then follow `pose.md`. Ordinary sitting requires a chair,
   sofa, bench or stool unless floor sitting was explicit; this is a support constraint, not an
   instruction to search the library. Reuse an existing seat or build a simple one from 1–4
   primitives. Use the usable seat surface rather than the chair's total height. A pose invalidates
   earlier body bounds, contact and facing checks and camera framing; use the `pose batch` result
   and measure again.
6. **Compose and inspect.** Follow `camera.md` for the retained bird's-eye view and the requested
   story cameras, then `checks.md` for numerical and visual evidence. The overview checks count,
   layout, facing and circulation; side or story views check heights and contact. An overhead view
   alone cannot prove the absence of penetration.
7. **Checkpoint.** Once per stage or verification pass, run `topview-3d-cli bom checkpoint` with the
   changed semantic entries and, after looking at the renders, `modelReview`. Mark a relation
   `passed` only with evidence from the current `sceneSequence`; later edits reset the affected
   relations to `unknown`. Numerical or render completion never means visual acceptance.

## Repeated functional geometry

Use the `node batch` action `repeat_primitive` for repeated stairs, rails or bars: one primitive,
an initial position, `count` (2–32) and a world XYZ `step`; it creates `NODE_1` …
`NODE_N` (NODE is the given `nodeId`, N is `count`). Each tread or useful surface must stay exposed; do not bury steps inside a
large solid base. The `geometry` check in the result flags exact axis-aligned box containment and
tops coplanar with the visible ground. Resolve functional failures and explain intentional
supports; these checks do not prove mesh, rotated-part or character collision safety.

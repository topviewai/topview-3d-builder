# Check, render and revise

Use the BOM relations as the checklist. The checks do not read the BOM: compare their evidence
with the intended geometry, support, clearances, semantic front and facing relations. Track each
hard relation as `passed`, `failed` or `unknown`; unknown is not a pass.

Judge the scene as an abstract spatial reference for video generation. First check all named
characters' relative positions, facing, spacing and foreground or background roles, then physical
contact and clearance and consistency across cameras. Recognizable approximate props are enough;
missing decorative detail is not a defect unless essential to the requested action. Do not spend a
correction pass on realism while blocking or spatial relationships are still wrong.

1. **Numerical check before writing.** Measure with `topview-3d-cli inspect nodes`. Dry-run proposed
   transform, lens and distance changes with `topview-3d-cli evaluate <dir> plan.json` (nothing is
   written): positive scale, finite coordinates, ground penetration, subject-camera distance, FOV
   and framing. If a problem appears, go back to layout planning. Write accepted changes with
   `topview-3d-cli node batch`. Bounds and frustum tests are numerical evidence, not proof of visual
   quality or absence of occlusion; explain intentional overlaps (support surfaces) rather than
   treating every box overlap as a collision.
2. **Visual check and revision.** Ensure or refit the bird's-eye camera per `camera.md`, then run
   `topview-3d-cli inspect views` once for it and every intended story camera, normally at frame 0 (or the
   user's frame):

   ```bash
   topview-3d-cli inspect views <dir> --camera cam-story --camera cam-overview --primary cam-story
   ```

   It freezes one `sceneSequence`, runs the numerical checks, renders each view into
   `.topview-3d/renders/` and records the evidence as BOM `verification`. Each `views[]` row has
   `numerical` issues, `renderStatus` and `render.contactSheet` (`path`, `sha256`). **Open every
   returned PNG and look at it before judging**: all required objects are visible, people match
   their identities and places, scale, ground contact and orientation are plausible, framing,
   occlusion and composition match the request. Check the overview against the BOM for
   completeness, whole-layout fit, relative positions, assembly parts, spacing and facing; check
   story views for purpose, shot size, eyelines, axis consistency, framing and occlusion. Use side
   or front evidence for seat and ground contact.

   Put story cameras first and the overview last, and pass the BOM story camera as `--primary`.
   Geometry warnings flag exact box containment and visible-ground coplanarity; meshes,
   rotated or grouped parts and character contact remain unproven. Repair functional surfaces or
   explain intentional supports. `checksComplete` covers numbers, conservative box geometry and
   render success only.

   `checksComplete` is true only when all of these hold, and otherwise `checksBlockedBy` lists the
   reasons in plain text (for example `cam-story: MESH_BELOW_GROUND hero` or
   `cam-story: TARGET_OUTSIDE_FRUSTUM frames 0`):

   - the scene did not change while inspecting (`stale: false`);
   - the primitive `geometry` check has no issues;
   - no view has an error or a below-ground warning (`MESH_BELOW_GROUND`,
     `ORIGIN_BELOW_GROUND`), and each camera's own target stays in frame (`targetInFrustum`);
   - every view rendered (`renderStatus: "complete"`, not blank, no renderer warnings).

   `inspect views` measures characters by their posed mesh (`measurement: "character meshes"`), so
   a seated or crouched character whose origin sits below the floor is not flagged when the mesh is
   on it (tolerance 0.02 m). `MESH_OUTSIDE_FRUSTUM` / `ORIGIN_OUTSIDE_FRUSTUM` for other nodes stay
   in `numerical.issues` as information and do not block: props leaving a close shot is normal.
   If `measurement` says `character origins`, the mesh measurement failed (the reason follows) and
   origins were used instead.

   Adding or deleting a temporary diagnostic camera is a write: it bumps `sceneSequence`, marks the
   recorded evidence stale and makes a later `modelReview` fail. Delete the temporary camera first,
   then run the final `inspect views`, then submit the review.

   Thin lines, stripes, seams, moiré, z-fighting flicker and edge aliasing are renderer artifacts:
   describe them, do not move cameras or rebuild geometry to erase them. Only correct problems you
   can cite from `inspect nodes` or `evaluate` numbers, or a BOM hard relation marked `failed`. At
   most one `inspect views` per correction pass; after two unchanged checks of the same relation,
   stop and report. Never move a BOM `story` camera for diagnosis (use the overview or a temporary
   `add_camera` that you delete later). If an image cannot be opened, say visual verification is
   incomplete; never claim to have seen it. Never add keyframes as a workaround.
3. **Persist and report.** Run `topview-3d-cli bom checkpoint <dir> patch.json` with the current scene
   and BOM revisions plus the changed semantic entries. `verification` is read-only. Submit
   `modelReview` with the exact camera ids, frames and sha256 values that `inspect views` returned;
   leave failures and unknowns explicit:

   ```json
   {"expectedSceneSequence": 18, "expectedBomRevision": 5,
    "modelReview": {
      "views": [{"cameraNodeId": "cam-story", "frames": [0], "status": "passed",
                 "reason": "both people visible, eyelines meet"}],
      "constraints": [{"id": "rel-mother-sits", "status": "unknown",
                       "reason": "seat contact not visible from this angle"}]}}
   ```

   `modelReview` needs both `views` (1–24, each with `cameraNodeId`, `frames` (1–3), `status`
   (`passed` / `failed` / `unknown`) and a non-empty `reason`) and `constraints` (may be `[]`; each
   item has the relation `id`, `status` and a non-empty `reason`). An omitted `sha256` is filled
   from the recorded evidence; `BOM_REVIEW_EVIDENCE_MISSING` means the evidence is missing or stale
   and its `details` give `evidenceSceneSequence` and `currentSceneSequence`, so inspect again. `modelReview.coverageComplete` is true only
   when every BOM camera appears in `views` and every hard relationship in `constraints`;
   `missingCoverage` lists what is still unreviewed. Summarize the actual edits, what was
   verified and what remains. Give file paths, never image bytes or Base64.

## Command contracts

- `topview-3d-cli evaluate <dir> [plan.json] [--frames 0,24] [--camera ID]`: the plan is
  `{"changes": [...]}` in `node batch` syntax or `{"operations": [...]}` in `document apply`
  syntax, staged on a copy (`persisted: false`). Without a plan it checks the stored scene. Pure
  Node, no browser.
- `topview-3d-cli inspect nodes <dir> <id>... [--frame N]`: 1–16 nodes; world `bounds`, `size`, `origin`,
  support-surface candidates or character landmarks, `grounding` (`grounded` / `floating` /
  `penetrating`, tolerance 0.02 m) and `pairs` (origin distance, horizontal distance, bounds gap,
  `boundsIntersect`, `overlapSize`). Local +Z is not proof of a semantic front.
- `topview-3d-cli inspect views <dir> [views.json] [--camera ID]... [--frames 0,24] [--primary ID]`:
  without cameras it covers every camera at frame 0. A spec file allows 1–8 `views` of
  `{cameraNodeId, frames (1–3)}` plus optional `width`, `height`, `primaryCameraNodeId` and
  `expectedSceneSequence`. Failures are per view (`renderStatus`), not per call.
- `topview-3d-cli render <dir> [payload.json]`: one render run of `frames` (default `[0]`), optional
  `cameraNodeId`, `width`, `height`; without a camera it uses the active one. Use it for a single
  closer follow-up after the shared pass. It writes `frame-<n>.png` and `contact-sheet.png`.
- `topview-3d-cli renders show <dir> [runId] [--frame N]`: absolute path, size and verified sha256 of a
  run's contact sheet (default) or one frame; `topview-3d-cli renders list <dir>` lists runs and marks
  `stale` ones. Open the path to look at the image.

`evaluate` works on primitive boxes and node origins only (see its `measurement` field), so a
character or imported model is judged by its origin there: `ORIGIN_BELOW_GROUND` for a seated
character or `ORIGIN_OUTSIDE_FRUSTUM` in a close shot can be false alarms. `inspect views` uses the
posed mesh bounds (`basis: "mesh"` in the metrics). For primitives, `inFrustum` is true if the world
box intersects the frustum and ground penetration fires only when the entire box is below ground.
Use `inspect nodes` bounds before claiming contact, clearance or complete framing.

## BOM checkpoint fields

`topview-3d-cli bom checkpoint <dir> patch.json` takes `expectedSceneSequence`, `expectedBomRevision`
and at least one of:

- `intent`: a string (or a small object) with the user's request;
- `relationships`, `constraints`, `cameras`: arrays of objects with a stable `id` (up to 24 fields
  each); an existing `id` is updated field by field, a new one is added. In `relationships`,
  `subjectId` and `targetId` (strings or lists) and in `cameras` the `nodeId` must name existing
  nodes, otherwise `DIRECTOR_NODE_NOT_FOUND` (exit 2) with `details.field`, `index`, `property`, `ref`.
  A relationship is hard unless `"priority": "soft"`; cameras carry a `role` (`story`,
  `layout_overview`, ...);
- `notes`: an array of strings (replaces the list);
- `remove`: `{"relationships": [ids], "constraints": [ids], "cameras": [ids]}`;
- `modelReview`: see step 3.

`verification`, `observed` and `updatedAt` are written by topview-3d-cli, never by the patch.

# Static cameras: story coverage and layout inspection

Read `topview-3d-cli bom get <dir>` and `topview-3d-cli document get <dir> --summary` before choosing cameras.
Design a coherent set of static views for film and TV storytelling; do not add camera moves,
timeline cuts or lens and depth-of-field controls unless the user asks for movement (then see the
keyframes section in `edit.md`).

These views guide downstream video generation from one coherent physical world. Preserve character
blocking, prop positions, scale, eyelines and occlusion across all views of one moment. If a shot
is difficult, adjust the camera first; do not move people or props to manufacture a better
individual image. Fine surface detail is not a camera goal.

## A bird's-eye inspection view is mandatory

Every scene, NEW and EDIT, keeps one dedicated inspection camera, clearly named ("Layout check ·
bird's eye") and recorded in BOM `cameras` with role `layout_overview`. It is additional to the
requested story views and is rendered in every visual check.

1. Reuse the recorded overview node if it still exists. Otherwise look for an existing camera with
   the same purpose; otherwise create one with an unused id. Never repurpose a story camera or add
   another overview every turn.
2. Use preset `bird-eye` (or `top-wide` / `forty-five` and adjust); `topview-3d-cli camera presets` lists
   every preset id with its fov. For the whole-layout camera omit `subjectNodeId`.
3. Measure the union of all placed props and people and the relevant room footprint
   (`topview-3d-cli inspect nodes`; exclude cameras and an oversized background ground). Aim downward near
   the XZ centre and fit the full footprint with margin using height and vertical FOV, instead of
   leaving the preset aimed at the world origin.
4. For a straight-down view the rotation is `{x: -90, y: 0, z: 0}`. With width W along X, depth D
   along Z, aspect ratio a and vertical FOV v, start above the highest included bound by at least
   `1.15 * max(D/2, W/(2a)) / tan(v/2)` (degrees → radians). This is an initial fit, not proof of
   visibility: dry-run, apply, render and adjust if clipped. The camera is perspective, not
   orthographic.
5. Refit after additions, deletions, moves, scale or pose changes, keeping a stable screen
   orientation so revisions are comparable. If roofs or tall structures hide the layout, report it
   and add useful views; do not delete or hide user objects.

## Design story views before choosing presets

Add cameras with their explicit `view` and `fov` in one `topview-3d-cli node batch` after their subjects
exist. Put a new camera's `presetId`, `view` and `fov` in the same `add_camera` change when they
are already planned; keep a follow-up `update` for a measurement- or render-driven correction.
For each requested view record purpose, subjects, shot size and required visible relationships in
BOM `cameras`. Respect the requested count and style; avoid redundant cameras. For unspecified
dialogue coverage, a master two-shot plus complementary views is a starting plan, not a
requirement to create every shot.

| Purpose | Starting composition |
| --- | --- |
| Establish space | Wide view that makes the setting and spatial relationships readable |
| Dialogue / interaction | Two-shot or medium showing both identities and the shared prop or action |
| Reaction / emotion | Medium close-up or close-up of the intended face |
| Person's viewpoint | Over-the-shoulder with the foreground shoulder framing, not hiding, the other person |
| Story-critical detail | Insert or detail view only when that detail matters |

Use eye level for ordinary conversation, adjusted for seated or standing eye heights. High or low
angles and Dutch tilt need a narrative reason. The inspection overview is exempt from the
story-purpose requirement.

## Primary story image

Choose one story camera as the primary delivery image and record it in BOM `cameras` with role
`story`. It is normally the master, the two-shot or the most important action view. The bird's-eye
camera is never primary. Pass the story camera as `--primary` to `topview-3d-cli inspect views`.

## Continuity, framing and perspective

- **180-degree axis:** identify the line of action (usually between speakers) and keep related
  story cameras on one side to preserve screen direction and eyelines. Record the axis endpoints
  and the chosen side in BOM `constraints`. For a world-XZ axis A→B, the sign of
  `(B.x-A.x)*(C.z-A.z) - (B.z-A.z)*(C.x-A.x)` gives camera C's side; near zero is on the axis and
  needs judgment. An intentional break needs a stated reason.
- **Eyelines:** people look toward their partner or object. Check complementary views together
  (head height and gaze) rather than turning each character to its own camera. An over-the-shoulder
  camera targets the person being seen.
- **Distinct coverage:** meaningfully different shot sizes or angles for views that may be cut
  together; no near-duplicates or purposeless axis reversals.
- **Composition:** readable faces and props, sensible headroom, space in the gaze direction; avoid
  cropping at joints, edge tangencies, poles through heads and foreground obstructions unless the
  user's style asks for it.
- **Perspective:** position and height set the viewpoint; FOV and distance set the framing. Moving
  the camera changes perspective; FOV alone changes the field of view. Avoid an extremely close
  wide-angle face shot for ordinary dialogue. `fov` is vertical, in degrees (12–120), not a focal
  length. Judge framing at the render's aspect ratio.
- If a camera conflicts with a hard BOM relation, adjust the camera first; revise the layout
  explicitly only if the relationship itself must change.

## Apply, then verify

1. Prefer `view.mode: "subject"` for a person-related camera. Give the character's
   `subjectNodeId`, an `offset` and a `targetOffset`. Both are in **world axes, measured from the
   subject's origin** (its feet for the built-in characters), not in the character's local frame:
   camera position = subject origin + `offset`, aim point = subject origin + `targetOffset`, and
   neither turns with the character's yaw. The camera follows the subject's translation only.
   Presets are a starting point, not finished framing.
2. Use `view.mode: "world"` with complete XYZ `position` and `target` for unbound cameras;
   topview-3d-cli solves the rotation. Do not combine `view` with a separate position, rotation,
   `distance` or `subjectNodeId`. Use `distance` alone only when the current aim is right.
3. Follow `checks.md`: dry-run with `topview-3d-cli evaluate <dir> plan.json --camera <id>`, apply, then
   run `topview-3d-cli inspect views` for every story camera plus the overview in one call with
   `--primary`; open the returned PNG paths and judge layout and continuity across views. Then
   checkpoint camera purposes and verified relations; the actual settings live in the scene.

**Over-the-shoulder recipe.** For a shot over A's shoulder onto B, bind the camera to B (the
face the shot is about). Take the world origins from `topview-3d-cli document get <dir> --summary`, let
`d` be the horizontal unit vector from A to B and `s` a horizontal unit vector perpendicular to `d`
on the shoulder side. Place the camera at `A − 0.5·d + 0.35·s`, height 1.5–1.6 m, and aim at B's
eye line: `offset` = that position − B's origin, `targetOffset` = `{"x": 0, "y": 1.5, "z": 0}`,
`fov` 30–40. Example: A at `(0, 0, 0)` faces B at `(0, 0, 2)` (`d` = +Z, `s` = −X) gives the camera
at `(-0.35, 1.55, -0.5)`, so `offset` = `{"x": -0.35, "y": 1.55, "z": -2.5}`. Render it and check that
A's shoulder and head frame one side without covering B's face; nudge `s` or the height, not the
layout.

New projects start with one camera, `cam-main`, the active camera. Reuse it as the first story
camera (an `update` with `view` and `fov`) or refit it as the overview, and record its role in the
BOM; it cannot be deleted while it is the only camera, so add the replacement first.

Example `add_camera` changes (replace the sequence and ids with current values):

```json
{"expectedSceneSequence": 12, "changes": [
  {"action": "add_camera", "nodeId": "hero_closeup", "presetId": "front-close",
   "view": {"mode": "subject", "subjectNodeId": "hero", "offset": {"x": 1, "y": 1.6, "z": 3},
            "targetOffset": {"x": 0, "y": 1.4, "z": 0}}, "fov": 40},
  {"action": "add_camera", "nodeId": "layout_overview", "name": "Layout check · bird's eye",
   "presetId": "bird-eye", "view": {"mode": "world", "position": {"x": 0, "y": 9, "z": 0.01},
            "target": {"x": 0, "y": 0, "z": 0}}, "fov": 60}
]}
```

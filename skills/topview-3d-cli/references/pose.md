# Static pose after character placement

Poses are static. There is no motion library in this version: a walking or running pose is one
stride instant, not a cycle. When the user needs movement, keep the static pose and move the whole
character with root keyframes (`edit.md`); say that limbs do not animate.

1. **Determine the pose after placement.** Infer a static posture from the prompt. Unless the user
   explicitly asks for floor sitting (席地而坐 / 坐在地上), cross-legged sitting or kneeling,
   ordinary "sitting / sit down / seated" means sitting on a chair, sofa, bench or stool. This
   describes the contact type; first reuse an existing measurable seat, otherwise build a simple
   chair, stool or bench from 1–4 primitives. Do not pick a ground-contact pose merely because its
   name contains `sit`.

   Run `topview-3d-cli pose catalog` once; it returns every pose (id, name, category, tags). Match the
   action mappings below against this list; do not search poses by keyword to decide the posture.
   **For mapped poses, select directly from the text: no cover is needed to choose.** The mappings
   describe previously reviewed limb shapes and support requirements. Look at covers only for an
   unmapped pose or when the catalog contradicts a mapping: `topview-3d-cli asset show <poseId>` returns
   `coverPath`; open the image and judge limb positions, facing and contact. Do not choose an
   unfamiliar pose by name alone.

   **Unmapped-pose fallback:** if a needed cover cannot be viewed, do not leave people unposed.
   Note visual verification as pending in BOM `notes`, apply only a pose whose id, category and
   name make the posture and support type unambiguous (the word `sit` alone is not enough), then
   render a useful view and look at it before claiming acceptance. Do not infer hand-object contact
   or detailed limb shape from names. If no candidate is unambiguous, record the blocker.
2. **Fit seated characters to the seat.** Identify the actual support node. A ground plane is not
   a substitute for an ordinary seated character. A primitive seat is valid when its seat surface
   height, width and depth are measurable. Distinguish the total chair or back height from the
   **seat surface height and usable seat width and depth** (`topview-3d-cli inspect nodes` support
   surfaces, confirmed in a render). After the pose is applied, measure the character again
   (`topview-3d-cli inspect nodes <dir> <characterId> <seatId>`: bounds, hips / knee / ankle landmarks,
   pair gaps). Adjust position, facing, uniform scale or pick another pose so the pelvis and thighs
   rest above the seat, hips fit between arms, knees clear the table and feet reach their support
   without penetrating it. A bone point is not the skin surface: leave body thickness and check a
   side or front render. Do not put the pelvis at the chair's total height or claim collision-free
   placement from whole-body boxes alone. If the seat geometry cannot be established, say so and
   choose a measurable support instead of guessing.
3. **Recheck and refine.** A pose changes bounds: re-run the numerical checks, render, look, and
   correct visible contact or penetration. Checkpoint only semantic support and facing evidence
   (relation status plus sequence) to the BOM; re-run the affected relations from `layout.md` and
   refit the bird's-eye camera. If the applied pose is already right and only placement or facing
   changes, use `node batch` `update` changes; do not apply the same pose again.

## Common action mappings and priority

Explicit user and story requirements take priority. Otherwise choose the simplest pose that
expresses the requested action, with the fewest extra gestures or support requirements. Use the
default pool first; use a contextual variant only when the scene calls for it. Do not add raised
arms, crossed legs, hip gestures, running or leaning merely to vary a group. Reusing a suitable
pose is fine; vary placement and facing instead.

The mappings are sufficient to choose these reviewed poses without looking at images. Match the
requested action and support type, use the preferred id, and stop once its conditions are met.
For generic standing, walking and chair sitting use the preferred default rather than choosing
freely across the catalog. If several contextual variants match equally, use the first listed.

Use an id only if it appears in the current catalog. If it is absent, try another mapped candidate
with the same action and support before an unmapped one, and record an unavailable exact posture
in BOM `notes`. The mappings do not establish scene-specific contact, clearance or facing: after
applying, still measure, render and check. Do not infer suitability from the `stand`, `sit`,
`move`, `lie` or `action` categories alone; categories also contain unusual poses.

### Default pool

| User intent | Preferred pose id | Alternatives and limits |
| --- | --- | --- |
| Standing / 站立、站着、普通等待 | `a3d_pose_stand-look-fwd` | `a3d_pose_stand-arms-down` for arms down. Keep feet supported and arms relaxed. |
| Standing, looking left or right / 站着向左或向右看 | `a3d_pose_stand-look-l` / `a3d_pose_stand-look-r` | Match the actual gaze target; rotate the character for whole-body facing changes. |
| Walking / 走路、走动、向前走 | `a3d_pose_loco-walk-fwd` | `a3d_pose_loco-walking` has a more crossed-leg gait; secondary option. Static stride poses, not motion. |
| Sitting on a chair / 坐着、坐在椅子上 | `a3d_pose_sit-lean-fwd-hands-in-front` | Slight forward lean, hands in front. Fit to a measurable seat; not a perfectly upright neutral sit. |

### Contextual everyday variants

Only choose a row when its action or context is requested or clearly established.

| User intent / context | Preferred pose id | Required interpretation and checks |
| --- | --- | --- |
| Standing conversation or explanation / 站着交谈、讲解 | `a3d_pose_stand-arms-slightly-spread` | Small open-hand gesture for the speaker; listeners can keep a default standing pose. |
| Hands behind back / 背手站立、背手观看 | `a3d_pose_stand-arms-behind-back` | Waiting or observing when this gesture fits; not mandatory for every waiting person. |
| One hand on hip / 单手扶腰、单手叉腰 | `a3d_pose_stand-l-hip-m` / `a3d_pose_stand-l-hip-f` / `a3d_pose_stand-r-hip` | Left hand with a mild weight shift; left hand with a stronger hip shift; right hand. Choose by the requested hand and stance, not by the suffix. |
| Elbow resting on a counter / 扶靠柜台、肘部靠栏杆 | `a3d_pose_stand-left-elbow-resting-obj` | Needs a support surface at the elbow; check contact after posing. |
| Leaning with crossed legs / 交叉腿倚靠、靠墙休息 | `a3d_pose_stand-legs-x-leaning-obj` | Needs a suitable support; do not leave a leaning body unsupported. |
| Walking while looking right / 边走边向右看 | `a3d_pose_loco-walk-fwd-look-r` | Needs a reason to look sideways; not the default walking pose. |
| Running / 跑步、向前跑 | `a3d_pose_loco-run-fwd` | Only for running; a static running instant. |
| Seated, leaning forward / 坐着前倾、肘部搭腿 | `a3d_pose_sit-elbows-on-legs-lean-fwd` | Seated conversation or waiting; check elbows, thighs and seat contact. |
| Seated, leaning back and looking down / 后靠低头坐着 | `a3d_pose_sit-reclined-look-down` | Needs seat and back support; not a default attentive sitting pose. |
| Seated with crossed legs, hand on knee / 翘腿坐、手搭膝盖 | `a3d_pose_sit-legs-x-right-arm-over-knee` | Chair-supported crossed legs, not floor cross-legged sitting. Check leg and table clearance. |
| Seated with crossed legs and arms / 翘腿抱臂坐 | `a3d_pose_sit-legs-x-arms-x` | An explicit crossed-arm gesture; do not infer an emotion from it. |
| Floor sitting with knees raised / 坐在地上、屈膝坐 | `a3d_pose_sit-arms-resting-on-knees` | Ground-supported with raised knees; never the default chair-sitting candidate. |
| Lying on back with one knee bent / 仰卧屈起一条腿休息 | `a3d_pose_lay-on-back-left-leg-bent` | Needs bed or ground support; not neutral straight-legged sleep. |
| Side lying with head propped up / 侧卧撑头休息 | `a3d_pose_lay-on-left-side-left-arm-supporting-hea` | Verify torso and elbow support; a propped-head rest, not ordinary sleep. |

### Avoid common mismatches

- Ordinary standing or walking: exclude T-poses, raised-leg balances, hands behind the head, large
  raised-arm gestures, hip-held walking, sneaking, sprinting, dance and floating poses unless the
  action requires them.
- Ordinary chair sitting: exclude ground sitting, hugging raised knees, floor cross-legged poses,
  toe-reaching stretches, backward chair sitting and hands behind the head unless appropriate.
  Distinguish 翘腿坐 (crossed legs on a chair) from 盘腿坐 (floor-style folded legs).
- Squatting / 蹲下: `a3d_pose_crouch-look-fwd-f` and `a3d_pose_crouch-look-fwd-m` are wide,
  action-like crouches; other `crouch` poses may be kneeling. None is a neutral deep squat. Look at
  feet, knees and hands before using one for an everyday task.
- Picking something up / 捡东西: a bent torso or downward gaze alone is not enough; verify the
  reaching hand against the object and the lower body's support.
- Sleeping / 睡觉: `lie` / `lay` poses include propped-up, gesturing and even seated shapes. Do not
  substitute head-propping, raised limbs or hands behind the head for a neutral sleeping pose.
- Phone use, reading, typing or holding a cup / 看手机、打电话、阅读、打字、端杯: these need verified
  hand-object alignment. A generic arm gesture does not fulfil the action. If no pose fits, report
  the limitation and label the simplified staging in BOM `notes` and in your answer.

## Command contract

```bash
topview-3d-cli pose batch <dir> poses.json --dry-run
topview-3d-cli pose batch <dir> poses.json
topview-3d-cli pose apply <dir> <characterId> <poseId>     # a one-item batch
```

`poses.json` holds `expectedSceneSequence` and 1–16 `items`, each
`{"nodeId", "poseId"}` (or `libraryId`) with optional `position` / `rotation` / `scale` to combine
placement with the pose; each character appears once. The poses compile in one browser page, the
commit is atomic, and the result lists `poses` and the new `state`. Locked characters, non-character
targets and characters with motion clips are rejected before any write
(`POSE_TARGET_INVALID`, `POSE_BATCH_REJECTED`). A pose compile needs Chromium like rendering. Then
measure the posed characters with `topview-3d-cli inspect nodes`, batch the contact corrections through
`topview-3d-cli node batch`, and check the useful views together with `topview-3d-cli inspect views`.

```json
{"expectedSceneSequence": 6, "items": [
  {"nodeId": "mother", "poseId": "a3d_pose_sit-lean-fwd-hands-in-front"},
  {"nodeId": "child", "poseId": "a3d_pose_stand-look-fwd", "rotation": {"y": -90}}
]}
```

---
name: topview-3d-cli
description: >
  Block out, edit, check and render 3D staging scenes on the local machine with the topview-3d-cli command:
  simple primitive props, built-in mannequin characters, static library poses, story cameras plus a
  bird's-eye layout camera, numerical checks and PNG renders, all offline in a project directory.
  Use when the user asks to stage, block out, lay out or storyboard a scene in 3D; place people,
  props or cameras; pose characters; check framing, grounding, spacing or collisions; render views
  of a scene as a reference for video generation; or works in a directory that contains
  `.topview-3d/`. Also use when a topview-3d-cli command fails or topview-3d-cli still has to be installed.
  The Codex plugin is shown as Topview 3D Builder. After a scene is built, open the local Studio in the In-App Browser.
---

# topview-3d-cli

`topview-3d-cli` edits and renders a local director project: a directory with a `.topview-3d/` folder. The
goal is an abstract, physically consistent staging reference for video generation: simple shapes,
correct scale and support, clear blocking, one world seen from several static cameras. Character
positions come first, then plausibility and camera continuity, then composition. Fine visual detail
is not a goal; a phone can be a slab. Respond in the user's language.

Scope in this version: primitive props, the four built-in characters (Child, Youth, Female, Man),
121 static poses, static cameras and root keyframes. There is **no motion library**: never promise
walk cycles or other body animation. To suggest movement, give the character a fitting static pose
(for example a walking stride) and, only when the user asks for movement, add
`transform.position` / `transform.rotation` keyframes (see `references/edit.md`). Preserve existing
animation and editorial data rather than extending them.

## Step 1: check the environment

Run this before anything else in a session:

```bash
topview-3d-cli doctor --json
```

It always exits 0; gate on the top-level `ok`. When `ok` is false, read each failing
`checks.<name>.hint` and follow `references/doctor-browser.md`:

- **`topview-3d-cli` not found:** run it without installing, pinned to this skill's version:
  `uvx --python 3.12 topview-3d-cli@0.1.2 doctor --json` (`--python 3.12` lets uv fetch a suitable
  Python when the default one is older than 3.11). Without `uvx`, use
  `pipx run --spec topview-3d-cli==0.1.2 topview-3d-cli doctor --json`, then
  `python3 -m pip install --user topview-3d-cli==0.1.2`. If that pip or pipx install fails
  because the configured index has no such version (a mirror that has not synced yet reports
  `from versions: none`), retry the same command with `--index-url` set to the official PyPI
  simple index: scheme https, host `pypi.org`, path `/simple/`. For pipx, pass that index inside
  `--pip-args`. Use the same prefix for every later command. When the user supplies a wheel file instead (for example before a release), run
  `uvx --python 3.12 --from <path-to-wheel> topview-3d-cli doctor --json`; for a source checkout see
  `references/doctor-browser.md`.
- **`node` fails:** Node.js 20.6 or newer (with npm) is required; ask the user to install it.
- **`playwright` or `chromium` fails:** run `topview-3d-cli browser ensure` once (it downloads the pinned
  Chromium into the user cache).
- **Rendering fails inside an agent sandbox** although `doctor` passes: the sandbox blocks the
  browser, not topview-3d-cli. Say so, ask the user to approve running the render command outside the
  sandbox, and keep working on everything that does not need a browser. Never build a substitute
  renderer (image libraries, SVG, hand-drawn frames).

## CLI contract

- Every command prints one JSON object on stdout. Failures print `{"ok": false, "code", "error"}`
  on stderr, with `details` (such as the failing `index`) when available. Exit 0 is success, 2 is
  invalid input, including an id that names no existing node, asset, pose or camera (fix the
  input), 1 is a command that could not
  be carried out (conflict, missing dependency, renderer failure).
- Spec files are JSON objects; `-` reads stdin. Write them to a temporary file first.
- Validate before writing: `--dry-run` on `document apply`, `node batch` and `pose batch`, and
  `topview-3d-cli evaluate <dir> plan.json` for a plan's numbers. Nothing is written when a command fails.
- Pass `expectedSceneSequence` from the latest result. On `SCENE_SEQUENCE_CONFLICT` re-read and
  re-plan; never bump the number blindly.
- Copy ids (`libraryId`, `poseId`, `presetId`, node ids) verbatim from command output. Never invent
  ids, dimensions or measurements.
- After a render, open the returned PNG files and look at them before judging. A render that was
  not viewed is not visual evidence.
- One writer at a time: do not run a writing command while Studio is saving the same project.
  After the user edits in Studio, re-read with `document get` before planning the next change.
  Studio writes back through `project adopt`, so the project on disk is the edited scene.

## Each session starts with context

```bash
topview-3d-cli project status <dir>            # or: topview-3d-cli project init <dir> for a new scene
topview-3d-cli document get <dir> --summary    # nodes, cameras, sceneSequence
topview-3d-cli bom get <dir>                   # the plan record: intent, relations, cameras, verification
```

Read them before planning; re-read only after your own writes or a conflict. `topview-3d-cli document get
<dir> --entity <nodeId>` returns one full node or clip.

## Workflow stages

Read the reference for a stage once per session, before its first command:

| Stage | What to do | Reference |
| --- | --- | --- |
| 1. Understand | Resolve intent from the conversation and current state; record it in the BOM | `references/state-intent.md` |
| 2. Layout | Relationships, support, facing, clearance; BOM fields | `references/layout.md` |
| 3. Props | 1–4 primitives first; imported models only when needed | `references/add-prop.md` |
| 4. People | Pick from the built-in characters; place before posing | `references/add-character.md` |
| 5. Pose | Reviewed text mappings; seat fitting | `references/pose.md` |
| 6. Cameras | Mandatory bird's-eye overview plus purposeful story views | `references/camera.md` |
| 7. Edit | Change only what was asked; batch syntax; keyframes | `references/edit.md` |
| 8. Check | Numbers, renders, look at the PNGs, revise | `references/checks.md` |
| 9. Studio | Open the finished scene in the local Studio with the In-App Browser | `references/doctor-browser.md` |

Asset search rules for props, characters and poses are in `references/asset-selection.md`.
Installation, the browser and sandbox limits are in `references/doctor-browser.md`.

## Commands

| Need | Command |
| --- | --- |
| New project / state | `topview-3d-cli project init <dir>`, `topview-3d-cli project status <dir>` |
| Read the document | `topview-3d-cli document get <dir> --summary`, `topview-3d-cli document get <dir> --entity <id>` |
| Add, change, delete nodes | `topview-3d-cli node batch <dir> changes.json [--dry-run]`, `topview-3d-cli node delete <dir> <id>` |
| Low-level operations (scene settings, keyframes) | `topview-3d-cli document apply <dir> ops.json [--dry-run]` |
| Find assets | `topview-3d-cli asset search <words> --kind character\|pose\|prop`, `topview-3d-cli asset show <id>` |
| Pose list | `topview-3d-cli pose catalog [--category sit]` |
| Pose people | `topview-3d-cli pose batch <dir> poses.json [--dry-run]`, `topview-3d-cli pose apply <dir> <nodeId> <poseId>` |
| Camera presets | `topview-3d-cli camera presets` |
| Numbers without a browser | `topview-3d-cli evaluate <dir> [plan.json] [--frames 0,24] [--camera <id>]` |
| Mesh measurements | `topview-3d-cli inspect nodes <dir> <id>... [--frame N]` |
| Numbers plus renders per camera | `topview-3d-cli inspect views <dir> --camera <id> ... --primary <id>` |
| One render | `topview-3d-cli render <dir> [payload.json]` |
| Find a rendered PNG | `topview-3d-cli renders list <dir>`, `topview-3d-cli renders show <dir> [runId] [--frame N]` |
| Plan record | `topview-3d-cli bom get <dir>`, `topview-3d-cli bom checkpoint <dir> patch.json` |
| Structural validation | `topview-3d-cli document validate <dir>` |
| Open in Studio | `topview-3d-cli studio open <dir>`, then open the returned `url` in the In-App Browser |

## Hard rules

1. Coordinates are right-handed, Y up, metres; rotations are Euler degrees; scale is a positive
   multiplier (`0.001` for a paper-thin axis). Node ids match `[A-Za-z0-9_-]{1,128}`.
2. Measure before grounding or seating (`topview-3d-cli inspect nodes`); frustum and ground checks in
   `evaluate` use node origins and primitive boxes only.
3. Every scene keeps one dedicated bird's-eye camera (BOM camera role `layout_overview`), refitted
   after layout changes. It is layout evidence, never the primary story image.
4. Choose one BOM `story` camera as `--primary` for `inspect views`.
5. Ordinary "sitting" means a chair, sofa, bench or stool unless floor sitting, cross-legged sitting
   or kneeling is explicit. Reuse a seat or build one from 1–4 primitives first.
6. Report gaps honestly: a simplified substitute is described as such; an unverified constraint
   stays `unknown`.
7. Thin lines, stripes, z-fighting and aliasing are renderer artifacts, not defects. Edit only with
   a measurement or a failed BOM hard relation behind it. One `inspect views` per correction pass.
8. Default timeline: 24 fps, 120 frames. Never paste image bytes or Base64 into messages; give
   paths.
9. Open the local Studio in the In-App Browser. `studio open` only starts the server and returns
   `url`; open that `url` in the In-App Browser, not the system browser.

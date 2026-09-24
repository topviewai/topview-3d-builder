# Scene3D local CLI migration plan

## Target branch

The working branch is `codex/scene3d-local-cli` in the new repository
`scene3d-open-source`. The branch starts from these upstream snapshots:

- editor `topview-3d-builder`: `0f5df076bc6fdc1de1f59d2f117a8fcc736864a9`
- agent `marketing-studio`: `116c0c9c6bec169fed275df68acb2426ef2e4d0a`

The source checkouts are references only. All new implementation belongs in
this repository.

## Product goal

Publish **Scene3D by TopView** as a skills-only plugin in the OpenAI (ChatGPT / Codex) public
plugin directory. The plugin is a set of skills that drive a local Python `topview-3d-cli` CLI:

```text
skills/topview-3d-cli (SKILL.md + references/)
    -> uvx --from <pkg>==X topview-3d-cli ...        (local process on the user's machine)
        -> local .topview3d project              (single writer, offline)
        -> Node + Playwright renderer          (PNG output inside the project)
```

- There is no MCP server, no login, no account, and no API key. The plugin never calls Topview
  services. Nothing is sent anywhere, and there is **no telemetry**.
- Python 3.11 is the runtime for document rules and operation planning.
- Node and Playwright remain the renderer; a Node-only rewrite is optional and not planned.
- Docker is not part of the execution path.

### Plugin identity

| Field | Value |
| --- | --- |
| Display name | Scene3D by TopView |
| Plugin name (`name` in every manifest) | `topview-3d-builder` |
| Publisher / developer | Topview |
| License | Apache-2.0 (code); built-in assets CC-BY-4.0 |
| PyPI distribution | `topview-3d-cli` (wheel `topview_3d_cli-X-py3-none-any.whl`) |

| Python import package | `topview_3d_cli` (`python -m topview_3d_cli`) |
| Command | `topview-3d-cli` (no `scene3d` alias) |
| Skill | `skills/topview-3d-cli` (`topview-3d-builder:topview-3d-cli`, 33 characters) |
| Project data directory | `.topview3d/` |
| User cache | `~/Library/Caches/topview-3d-cli`, `%LOCALAPPDATA%\topview-3d-cli\Cache`, `~/.cache/topview-3d-cli` |
| Environment variables | `TOPVIEW3D_*` |

Until stage 10 these were `topview-scene3d` (plugin and distribution), `topview_scene3d`, `scene3d`,
`skills/scene3d`, `.scene3d/`, a `scene3d` cache directory and `SCENE3D_*`. Nothing was published
under the old names, so the old project directory is not read. Document formats keep their names
(`biz/scene3d-director-document`, `scene3d-asset-manifest`, `scene3d-local-project`), as do error
codes and the director-cli package.

### Hosts

- **P0: OpenAI plugin directory (ChatGPT / Codex).** The plugin depends on local command execution,
  which is not the usual skills-only profile, so **contact OpenAI before submission** to confirm it
  is accepted. See the submission guide at
  <https://developers.openai.com/plugins/guides/submit-claude-plugin.md>.
- **P1:** Cursor, Claude Code, Codex CLI, and `npx skills add`. They reuse the same `skills/`
  directory and the same CLI, adding only a manifest per host.

### Reference layout (hyperframes)

`/Users/albert/Project/hyperframes` is a read-only reference for the repository shape:

- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json` with `marketplace.json`, and
  `.cursor-plugin/plugin.json` all point at `"skills": "./skills/"`.
- `skills/<name>/SKILL.md` is the single source for every host.
- `scripts/package-codex-plugin.mjs` builds the upload with `git archive --format=zip` from `HEAD`
  (`.codex-plugin`, the manifest's assets, `skills/`) and enforces the 100 MB limit.
- `scripts/lint-skills.ts` validates frontmatter and host-specific pitfalls.
- `scripts/set-version.ts` sets one version across packages and manifests.
- `doctor --json` always exits 0; callers gate on the payload's `ok`
  (`skills/hyperframes-cli/references/doctor-browser.md`).

## Scope and non-goals

In scope:

- local projects, deterministic operations, validation, and rendering;
- offline asset search and poses over built-in data;
- a CLI installable without a checkout;
- the plugin manifests and skills;
- release materials.

Out of scope:

- concurrent writers and remote project state;
- accounts, authorization, and billing;
- a hosted MCP service and a ChatGPT embedded UI;
- Studio as a dependency of the P0 plugin flow. Studio stays a developer tool in this repository.

## CLI contract

The normative contract is [topview-3d-cli.md](topview-3d-cli.md). It covers the commands,
the operation kinds, the error-code table, and the project format. In short:

- Success prints one JSON object on stdout and exits `0`.
- Failures print `{ok:false, code, error}` on stderr. Exit `2` means invalid input or shape; exit `1`
  means execution or state failure.
- `topview-3d-cli` is a console script from `agent/pyproject.toml`. `python -m topview_3d_cli`
  is equivalent.

## Local project format (schemaVersion 2)

```text
.topview3d/
├── metadata.json   format, schemaVersion, cliVersion, builderVersion, revision, sceneSequence, updatedAt
├── entities.json   authoritative entity store (versions, tombstones, sequence, operation log)
├── document.json   derived view: assembled director document
├── fcurves.json    derived view: merged compact-v1 fcurves
├── assets/
└── renders/
```

This replaces schemaVersion 1, where `document.json` was authoritative. The entity store is
needed to keep hosted-service semantics: per-entity versions, tombstones, `fcurves__<nodeId>`
entities, and operation-id idempotency.

- A schemaVersion 1 project is migrated in memory by a genesis replay of its
  `document.json`. The migration is persisted on the next successful write.
- Every write validates the assembled document and fcurves first.
- Files are then written atomically, entity store first.

### Single-writer versioning

- One `topview-3d-cli` process at a time may write a project. No lock file is taken.
- `baseSequence` is optional. It is only checked against `0 ≤ base ≤ sceneSequence` (`SEQUENCE_GAP`).
- In default local mode, a missing or `null` `expectedEntityVersion` overwrites; a number must match.
  A deleted id may be recreated.
- `--strict` applies hosted-service rules exactly:
  - creation requires `null`;
  - updates and deletes require the current version;
  - tombstones are permanent.

## Operation engine

`agent/topview_3d_cli/director_operations.py` is the single implementation of the
`Scene3dLiveOperationService` semantics, used by every CLI write. Its behavior:

- Entity types and ids:
  - `DIRECTOR_SCENE` is `director`;
  - `DIRECTOR_NODE` is the node id;
  - `DIRECTOR_CLIP` is `{clipKind, clip}`;
  - `DIRECTOR_FCURVES` is `fcurves__<nodeId>`, stored as `{version:1, encoding:compact-v1, fcurves}`.
- `sceneSequence` advances by one per accepted operation.
- Batches hold 1..64 operations and are atomic.
- Payload keys must match exactly.
- `director.scene.set` shallow-merges content fields.
- Missing references are warnings, not errors.
- `director.node.delete` deletes only the node, as in the Java service. The cascade across clips,
  fcurves, and references is planned by `director_static.delete_node_operations` and exposed as
  `topview-3d-cli node delete`.

`topview_3d_cli/tests/test_director_operations.py` mirrors the Java service tests.

## Stages

Status: stages 0–5 and 7–9 are done on this branch; stage 10 is done except running CI on GitHub.
Stage 6 is done except CI on Linux and Windows and PyPI publishing (see stages 6 and 10).

| # | Stage | Earlier plan |
| --- | --- | --- |
| 0 | Trim and license | 0 |
| 1 | Builder from source | 1 |
| 2 | CLI contract | 2 |
| 3 | Shared operation engine | 3 |
| 4 | Local rendering inside the project | 5 |
| 5 | Offline asset layer | 4 |
| 6 | CLI distributable (no checkout) | new |
| 7 | CLI command completion | new |
| 8 | Skill migration and old Agent runtime removal | 7, enlarged |
| 9 | Studio offline and publish hygiene | 6, enlarged |
| 10 | Plugin packaging | new |
| 11 | Release materials and submission | 8 |

- Rendering moves ahead of the asset layer for two reasons: it is small, and both the asset layer
  ("renders offline") and the no-checkout acceptance on Windows need it.
- Stage 9 does not block the plugin flow. It can run in parallel from stage 4, but it must finish
  before the repository or any package becomes public.
- Contacting OpenAI about local execution (stage 11) should start **now**, because the answer can
  change stages 6–10.

### 0. Trim and license — done

- Keep only the import closure of `agents/scene3d`, the builder, and the studio.
- Apache-2.0.
- No secrets in the tree.

### 1. Builder from source — done

- `@topview/3d-director-cli` is a pnpm workspace package that depends on `@topview/3d-builder`
  from source (no tgz).
- `builderVersion` is read from `package.json`.

### 2. CLI contract — done

Delivered:

- `agent/pyproject.toml`: Python ≥ 3.11, core dependency `jsonschema`, `topview-3d-cli` console script.
- A stable error-code table and exit codes.
- A full `doctor` (python, node, pnpm, builder version and dist, director-cli dependencies, Chromium).
- The reference fixture project, now `agent/topview_3d_cli/tests/fixtures/local-project/`.
- `scripts/install.sh` and `scripts/install.ps1`, both idempotent. They use uv when available and
  fall back to venv plus pip.

Acceptance:

- A clean checkout plus the install script reaches `doctor` ok, then `project init`, `document apply`,
  and `render`.
- Invalid input exits 2 without writing anything.
- The error table and the documentation are kept equal by a test.

### 3. Shared operation engine — done

Delivered:

- The operation engine above.
- The schemaVersion 2 project format and v1 migration.
- `--strict` / `--dry-run`, `node delete`, and fcurves passed to the renderer.

Acceptance:

- The Java-parity tests pass.
- The CLI and the development backend produce identical `sceneSequence`, versions, and assembled
  documents for the same batch.

### 4. Local rendering inside the project — done

Delivered:

- `render.mjs` takes `outputDir` as a parameter. It must be an absolute path to
  `<…>/renders/<runId>`: no `.` or `..` segments, a `runId` matching `[A-Za-z0-9_-]{1,128}`, and a parent
  named `renders`. The checks accept POSIX and Windows paths. The `/tmp/director` root is gone.
- The CLI renders straight into `.topview3d/renders/<runId>/`; nothing is moved afterwards.
- Each render writes `render.json`: run id, creation time, resolution, camera, `sceneSequence`, frames
  and contact sheet (file names, sizes, SHA-256), blocked requests, and CLI metadata (revision,
  document SHA-256, builder version, CLI version).
- `browser ensure` remains the only browser setup path (stage 6).

Acceptance: done on macOS (see stage 5). Linux and Windows are covered by the path tests;
running them on those machines is part of the stage 6 CI.

### 5. Offline asset layer — done

Phase 1 built-in assets are limited to:

- the four character GLBs (Child, Youth, Female, Man);
- the pose library;
- the code-generated primitives (Box, Sphere, Cylinder, Cone, Plane).

Library props (`default/objects`), architecture parts, other library content, and **motions** are not
shipped in phase 1 (motions: see "Phase 2: motion library"). No Mixamo-derived data enters the working tree.

Delivered:

- Asset manifests (`scene3d-asset-manifest` v1): the built-in root `builtin-assets/`, overridable with
  `TOPVIEW3D_BUILTIN_ASSETS`, and the project root `.topview3d/assets/`. Entries record id, kind, key,
  file, size, SHA-256, licence, and source. Paths outside the root are rejected.
- `topview-3d-cli asset list` and `topview-3d-cli asset import` (character, prop, pose; no motion kind).
- `render` resolves every character and prop model through the manifests and passes an explicit
  key-to-file map to the renderer. The renderer serves only those files. A model missing locally fails
  before Chromium starts (`ASSET_NOT_AVAILABLE`).
- Chromium blocks every request outside the local server and the optional public asset base, and
  `render.json` lists anything blocked.
- `TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE` defaults to empty; the CloudFront default is removed. The
  official-CDN allowlist in `library_media.py` belongs to the hosted agent and is not on the local path
  (removed in stage 8).
- The builder loads the Draco decoder from same-origin `/draco/` by default
  (`setDefaultDracoDecoderPath` changes it). The builder dist ships `dist/draco/`, the renderer serves it,
  and Studio copies it to `public/draco/`.
- Without motion assets:
  - a motion clip whose asset is missing does not fail loading or rendering;
  - the character keeps its pose controls, and fcurves keep working;
  - `render` reports `MOTION_NOT_AVAILABLE:<assetId>`.

Acceptance, run on macOS: `project init` → `document apply` (the Female GLB, the wave pose, a box, a
sphere, a cone, and a box fcurve) → `render`. Result: PNGs and `render.json` in the project, zero blocked
requests, and the pose and fcurve visible. Adding an unavailable motion clip still renders with the pose
kept.

Built-in assets (`builtin-assets/`, 2.1 MB, no LFS):

- the four character GLBs, 0.66 MB, imported with `topview-3d-cli asset import --builtin`. They are
  Topview-made; the Mixamo label in the upstream cache is wrong and is not copied. The rig value
  `mixamorig` only names the bone convention.
- the 121 library poses (`a3d_pose_*`, 0.48 MB of JSON holding only `pose_id`, `hips`, `bones`) and
  their WebP covers (0.92 MB). They were downloaded once by a script kept outside the repository; no
  key or signed URL is stored.
- the five primitives.

Characters, poses, and covers are licensed CC-BY-4.0 (`builtin-assets/LICENSE`, scope and attribution
"Scene3D built-in assets © Topview, CC BY 4.0" in `builtin-assets/NOTICE`); each entry carries
`license: CC-BY-4.0`, that attribution, and source `Topview (self-made)`. The code stays Apache-2.0 and
the wheel declares `Apache-2.0 AND CC-BY-4.0` with `LICENSE`, `LICENSE-ASSETS`, and `NOTICE`. `topview-3d-cli pose apply
<dir> <nodeId> <poseId>` compiles a library pose into the character's joint controls through the
renderer's `apply-library-pose`.

Acceptance with the built-in root: Female, Man, and Child (later Youth) with library poses, a box, a
sphere, and a box fcurve render with zero blocked requests; the poses match their covers. Known gap: the
pose `hips` root offset is not scaled to the character, so kneeling poses sink the Child into the
ground (Studio behaves the same).

Still open in stage 5 scope:

- asset search and facets over the manifest moved to stage 7 (`asset search`)
  together with `asset search` and `asset show`;
- built-in assets ship inside the wheel (settled in stage 6).

### 6. CLI distributable — done except CI and publishing

- **Install.** Console script `topview-3d-cli` from a PyPI package, installable without a checkout.
- **Package names (decided).** Distribution `topview-3d-cli`, import package `topview_3d_cli`,
  command `topview-3d-cli`.
  - `agents` is too generic for PyPI. The `openai-agents` SDK, for one, installs a top-level
    `agents` package.
  - Move the code to `topview_3d_cli` and keep `python -m topview_3d_cli` working.
- **Remove every `REPO_ROOT` / `editor/` path.** Resources are read with `importlib.resources` and
  shipped as wheel package data:
  - the contracts (director document and fcurves schemas);
  - the director-cli sources (`cli.mjs`, `render.mjs`, and the other modules);
  - `static/headless.html` with its scripts;
  - the prebuilt builder `dist/`;
  - the Draco decoder files;
  - the built-in assets, if stage 5 keeps them in the wheel.

  `builderVersion` comes from a generated metadata file, not from `editor/packages/builder/package.json`.
- **Node dependencies.** Users need Node ≥ 20.6 and nothing else from the Node ecosystem; pnpm is a
  developer-only tool.
  - Bundle director-cli together with `three` and `zod` (esbuild) so that `playwright` is the only
    external package.
  - `topview-3d-cli browser ensure` is idempotent. It:
    - installs the pinned `playwright` into a per-user cache
      (`~/Library/Caches/topview-3d-cli/node/<cliVersion>/`, `%LOCALAPPDATA%\topview-3d-cli\Cache\node\<cliVersion>\`,
      or `~/.cache/topview-3d-cli/node/<cliVersion>/`) using the `npm` that ships with Node
      (`npm install --no-audit --no-fund --omit=dev`);
    - runs `playwright install chromium`.
  - `render` never downloads implicitly. It fails with a stable code (for example
    `BROWSER_NOT_INSTALLED`) whose hint is `topview-3d-cli browser ensure`.
- **Doctor.**
  - `topview-3d-cli doctor --json` always exits 0; callers gate on `ok`, as in hyperframes.
  - Plain `doctor` stays human-readable and exits 1 on failure.
  - Checks for a user install: python, node, npm, the Node runtime cache, Chromium, CLI version.
  - pnpm, builder dist, and workspace `node_modules` are checked only when running from a checkout.
- **PyPI publishing.**
  - Publish through PyPI Trusted Publishing: GitHub Actions OIDC, no stored token.
  - Wheels are `py3-none-any`.
- **Skills invoke a pinned version**, with fallbacks tried in order:
  1. `uvx --from <pkg>==X topview-3d-cli …`;
  2. `pipx run --spec <pkg>==X topview-3d-cli …`;
  3. `python3 -m pip install --user <pkg>==X`, then `python3 -m <pkg> …`.

  `X` is the plugin version.
- **Install scripts.** `scripts/install.sh` and `scripts/install.ps1` remain the developer path for a
  checkout.

Acceptance: on clean macOS and Windows machines that have no checkout and no pnpm, with only
Python ≥ 3.11 (or uv) and Node ≥ 20.6, this sequence works:

1. `uvx --from <pkg>==X topview-3d-cli doctor --json`
2. `topview-3d-cli browser ensure`
3. `topview-3d-cli project init`
4. `topview-3d-cli document apply`
5. `topview-3d-cli render`, producing PNGs inside the project.

The same sequence runs on Linux in CI.

Delivered:

- `agent/topview_3d_cli/` is the package; `agent/pyproject.toml` builds `topview-3d-cli` (py3-none-any)
  with the director schemas and `_runtime/` as package data. The legacy `agents` package stays in the
  checkout for the development backend and is not part of the wheel.
- `topview_3d_cli/runtime.py` picks the runtime: `workspace` (a checkout, so editable installs keep
  using `editor/` and `builtin-assets/`) or `packaged` (`_runtime/`); `TOPVIEW3D_RUNTIME` forces one.
  Files are found relative to the installed package (a zip import is not supported).
- `scripts/build_dist.py` builds the builder, stages `_runtime/` with
  `editor/packages/director-cli/scripts/stage-runtime.mjs`, and runs `python -m build`. The staging
  script follows the imports of the Node entry points and of the page (through its importmap) and copies
  only reachable files of director-cli, builder `dist/`, `three`, and `zod`, plus both Draco copies,
  licences, and `runtime.json` (builder, three, zod, and Playwright versions). This replaces the esbuild
  bundle: no new build tool, the page keeps loading plain modules, and the staged renderer is 6.4 MB.
  Staging fails if two different copies of one package are reachable.
- `topview-3d-cli browser ensure [--with-deps]` installs `playwright@1.63.0` with npm into
  `<user cache>/node/<cliVersion>/` (packaged mode only; a checkout uses its workspace) and then
  downloads Chromium. Node finds the cache through `TOPVIEW3D_NODE_PREFIX`.
- `doctor --json` always exits 0 and reports `ok`; plain `doctor` is readable and exits 1 on failure.
  Checks: python, node, runtime (mode, missing files, builder version), assets, playwright, chromium, and
  pnpm only in a checkout. Each failing check has a hint.
- The install scripts are the developer path and call `topview-3d-cli browser ensure`; the README documents
  pipx / uvx / pip with the wheel.

Acceptance, run on macOS: the wheel (2.96 MB; sdist 2.83 MB) installed alone into a fresh venv under
`/tmp`, run from a directory outside the repository: `doctor --json` (ok false, hint `browser ensure`)
→ `browser ensure` → `doctor` ok (packaged runtime) → `project init` → `document apply` → `pose apply`
for three characters → `render`: zero blocked requests, no warnings, poses correct. Not yet done: the
same run on Windows and Linux, `uvx` (not installed on the test machine), and publishing.

### 7. CLI command completion — done

The Agent skill (`scene-3d-agent.md` and `guides/`) uses 19 MCP tools, referenced 38 times with the
`mcp__scene3d__` prefix. Every workflow in the guides is now expressible with CLI commands over local,
offline data and the shared operation engine. Stage 8 rewrites the skill against this table:

| MCP tool | CLI command | Notes |
| --- | --- | --- |
| `get_project` | `project status <dir>` | |
| `get_operation`, `get_artifact` | none | Operations are synchronous; outputs are local files. |
| `guide` | none | Done in stage 8: the 9 workflow guide files (8 topics) became `skills/topview-3d-cli/references/*.md`. |
| `get_director_document` | `document get <dir> [--summary]` | |
| `get_director_entity` | `document get <dir> --entity <id> [--type] [--include-curves]` | Type is inferred when omitted. |
| `apply_director_operations` | `document apply <dir> <ops.json> [--strict] [--dry-run]` | |
| `batch_director_nodes` | `node batch <dir> <spec.json> [--dry-run]` | Same change schema; `expectedSceneSequence` optional. |
| `batch_director_poses` | `pose batch <dir> <spec.json> [--dry-run]`, `pose apply` | `poseId` or `libraryId`, optional transform. |
| `search_director_assets` | `asset search [query] [--kind] [--category] [--tag]… [--rig] [--limit] [--offset]` | Facets over all matches. |
| `get_director_asset_details` | `asset show <id> [--kind]` | Local path, cover path, usage snippet. |
| `list_director_pose_catalog` | `pose catalog [--category] [--tag]` | |
| `evaluate_director_plan` | `evaluate <dir> [plan.json] [--frames] [--camera]` | A plan holds `changes` (node batch syntax) or `operations`; never written. |
| `inspect_director_nodes` | `inspect nodes <dir> <id>… [--frame]` | Adds grounding and pairwise distance, gap and overlap. |
| `inspect_director_views` | `inspect views <dir> [views.json] [--camera]… [--frames] [--primary]` | Render runs in the project; evidence goes to the BOM. |
| `render_director_frames` | `render <dir> [payload.json]` | |
| `get_director_render_image` | `renders show <dir> [runId] [--frame N]`, `renders list <dir>` | Returns the PNG path and a verified sha256. |
| `get_bom`, `checkpoint_bom` | `bom get <dir>`, `bom checkpoint <dir> <patch.json>` | Stored in `.topview3d/bom.json`. |

New helpers with no MCP counterpart: `camera presets` (preset ids for `add_camera`) and `node delete`
(the cascading delete).

Hosted features that are not localized:

| Feature | Handling |
| --- | --- |
| `guide` topics served by the Java backend (`scene-audit`, `composition`, `mesh-pivot`, `materials-lighting`, `camera`, `rig-animation`, `numerical-qa`, `render-export`, `director-camera-motion`, `director-character-motion`, `director-perception`, `director-editorial`) | Omitted (stage 8 decision: not converted). |
| `get_operation` / `get_artifact` (async jobs, remote artifacts) | Omitted: every command is synchronous and writes local files. |
| Signed-URL hydration of library models and covers | Omitted: models and covers resolve through the local manifests. |
| Image blocks in results (`includeImages`, cover images, `get_director_render_image`) | Replaced by absolute PNG/WebP paths; the host opens the file. |
| 5-minute catalog cache and refresh | Omitted: the manifests are read on each call. |
| Sandbox, LakeBase workspace and the per-project write lock | Omitted: single writer (see Single-writer versioning). |
| Props library | No built-in props in phase 1; `asset import --project --kind prop` adds project props. |
| Motion library | Phase 2. A clip whose motion is not local renders with `MOTION_NOT_AVAILABLE:<id>`; `pose batch` refuses characters with motion clips (`POSE_BATCH_REJECTED`). |
| BOM `guidesRead` and `turn_end_sync` | `guidesRead` stays empty; `bom get` derives `observed` and `stale` on every read. |
| `batch_director_nodes` inline measurement | Use `inspect nodes` after the batch. |

Acceptance (met):

- Every command is in `docs/topview-3d-cli.md` and uses only codes from the error table
  (`test_every_raised_code_is_in_the_table_and_documented` scans all `topview_3d_cli` modules).
- Each command has tests (`test_local_reads.py`, `test_local_edit_inspect.py`). Pure-Node renderer
  commands run for real; Chromium commands are faked in unit tests.
- A wheel installed in a fresh venv runs the whole chain: search, node batch, pose batch, evaluate,
  inspect nodes and views, renders show, bom.
- Remaining: the positive release test cases (stage 11) must still be run with CLI commands alone.

### 8. Skill migration and old Agent runtime removal — done

- **Skill.** `skills/topview-3d-cli/SKILL.md` plus ten `references/*.md` (real files, no symlinks),
  rewritten from `scene-3d-agent.md` and the 9 guide files with every MCP call replaced per the
  stage 7 table:
  - `SKILL.md`: frontmatter `name` and `description` only (655 characters); `topview-3d-cli doctor --json`
    first, gated on `ok`; the install ladder pinned to the package version
    (`uvx --python 3.12 topview-3d-cli@0.1.0` → pipx → `pip --user`), Node 20.6+, `topview-3d-cli browser ensure`;
    the sandbox rule (explain, ask to run outside the sandbox, never a substitute renderer); the CLI
    contract (JSON, exit codes, dry-run / evaluate before writing, open PNGs after rendering); the
    stage → reference table; hard rules.
  - References: `state-intent`, `layout`, `add-prop`, `asset-selection`, `add-character`, `pose`,
    `camera`, `edit`, `checks` (one per guide file) and `doctor-browser` (install, browser, sandbox).
    The hosted context prefixes (`<scene_summary>`, `<bom>`, `<history>`) became `project status`,
    `document get --summary` and `bom get`; image blocks became PNG / cover paths.
  - Phase 1 has no motion library and no prop models: movement is a static pose plus root
    `transform.*` keyframes (`director.fcurves.set` through `document apply`), props are primitives or
    user-imported models.
  - The 12 Java-backend guide topics are not converted (decision).
- **Skill lint.** `scripts/lint_skills.py` (tests: `test_skill_lint.py`) checks frontmatter keys,
  the name, description length, banned wording (`mcp__`, Claude, URLs, internal domains, product
  identity, key / credential / login / account wording, signed-URL parameters), reference links and
  orphans, `topview-3d-cli==X` pins against `__version__`, and every `topview-3d-cli …` command and long
  option quoted in code against `local_cli.command_table()` (the argparse tree).
- **Old runtime deleted:** all of `agent/agents/` (MCP tools, `tools.py`, `tool_ui_preview.py`,
  `director_runtime.py`, `library_media.py`, the catalog backend calls, the prompt and guides,
  `config.py`, `core/`, `scripts/director_local_backend.py` and `local_backend.py`, their 146 tests),
  the `[agent]` extra with `claude-agent-sdk`, and the install scripts' `--with-agent` option. The
  hosted-only write helpers in `director_document.py` (signed-URL hydration, escape-hatch checks,
  intent persistence, editorial shot operations) went with them. Parity tests for the shared modules
  moved to `topview_3d_cli/tests` (`test_bom.py`, `test_director_document.py`,
  `test_director_static.py`, `test_node_batch_parity.py`).
- **Pose root drop.** Library poses store the hips drop of an adult reference (leg length ≈0.95 m);
  the builder now scales it by the character's measured leg length (`poseRootScale.ts`, shared by
  Studio and the renderer). Kneeling Child / Female / Man stay within 2 cm of the ground (Child was
  0.53 m below it before).

Acceptance (met, macOS):

- The skill lint passes; `skills/` has no `mcp__`, Claude, login, account or key wording.
- The wheel (3.00 MB) depends on `jsonschema` only and contains no `agents` modules.
- All tests pass: Python 181, director-cli, builder typecheck and vitest.
- Manual end-to-end run with the installed wheel outside the repository, following `SKILL.md` only:
  `doctor --json` → `browser ensure` → `project init` → `project status` / `document get --summary` /
  `bom get` → `bom checkpoint` (intent) → `asset search --kind character` / `pose catalog` →
  `evaluate` plan → `node batch --dry-run` → `node batch` (table, chair, two characters, two cameras)
  → `pose batch` → `inspect nodes` (seat fit) → `inspect views --primary` → PNGs viewed →
  `bom checkpoint` (modelReview) → `renders list` / `renders show` / `render` → keyframes via
  `evaluate` + `document apply` → `asset import --project` / `asset show` → `document validate`.
- Not verified: the `uvx` / `pipx run` install routes (neither tool on the test machine, package not
  published), and a fully autonomous agent session.

### 9. Studio offline and publish hygiene — done

- **Studio.**
  - Login, the bot-check widget, and every online route (canvas proxy, preview auth, canvases,
    canvas copy, draft ensure, bindings, host defaults, object-storage signing, asset and media
    proxies) are removed, together with the online adapters and the unused AWS SDK dependencies.
  - `LocalHostAdapter` reads the same asset manifests as the CLI (`builtin-assets/` plus the
    `.topview3d/assets/` of every project in `TOPVIEW3D_PROJECTS`) through `/api/local-assets/*`, which
    serves only files listed in a manifest.
  - Local drafts stay in `apps/studio/drafts/`. CLI projects listed in `TOPVIEW3D_PROJECTS` open
    read-only; writing back would have to translate whole-document edits into CLI operations, which
    is out of scope.
  - The motion panel shows "No motions installed" while the host returns no motion assets. Existing
    motion clips stay editable and render with the character's pose.
  - `pnpm --filter @topview/3d-studio test:offline` starts the built Studio and drives it with
    Playwright, allowing only `localhost`: create a draft, search poses, place a character, apply a
    pose, save, and read the draft back. Any login UI, external request, or HTTP error fails it.
- **`editor/apps/studio/.env.example`** keeps only `TOPVIEW3D_BUILTIN_ASSETS` and `TOPVIEW3D_PROJECTS`.
- **Builder.** The Agent panel and billing presentation (`src/agent/`, `src/components/agent/`, their
  exports, styles, and locale strings) are removed. The agent write lock became the host read-only
  lock (`writeLocked`, error `write-locked`). The private-registry `publishConfig` is gone.
- **Cursor skills.** `editor/.cursor/skills` (release, test rollout, startup; all tied to the private
  registry or internal environments) is removed.
- **Docs.** `studio-host.md` describes the local host; `workbench.md`, `assets-manifest.md`, and
  `editor/AGENTS.md` no longer describe internal services or release flows. The reference-product
  observations from `architecture.md` and `draft-format.md` moved to `editor/docs/observation-notes.md`.
- The P0 plugin flow does not depend on Studio. Nothing from `editor/apps/studio` ships in the wheel.

Acceptance (met):

- The secret scan is clean.
- Searches for internal hosts, the private registry, the preview deployment, the client-key header
  and variable, the bot-check widget, and font CDNs return nothing in the working tree.
- `pnpm --filter @topview/3d-studio build` and `test:offline` pass.

### 10. Plugin packaging — done locally; CI not yet run on GitHub

- **`.codex-plugin/plugin.json`.** The hyperframes fields plus `interface.privacyPolicyURL`,
  `interface.termsOfServiceURL`, `brandColor` (`#3341FF`, sampled from the symbol) and the three
  positive test cases as `defaultPrompt`; no `apps`, no `mcpServers`, no `.mcp.json` or `.app.json`.
  `homepage` and `websiteURL` are https://www.topview.ai/topview-3d-builder, `repository` is
  https://github.com/topviewai/topview-3d-builder and `author.url` is https://www.topview.ai (the same
  in every manifest and in pyproject `[project.urls]`). `privacyPolicyURL` and `termsOfServiceURL`
  stay `TODO:` placeholders until those pages exist, so `--release` packaging still fails on purpose.
- **Other hosts.** `.claude-plugin/plugin.json` plus `.claude-plugin/marketplace.json` (source `./`,
  no version in the entry, so `plugin.json` is the only place), `.cursor-plugin/plugin.json`, and
  `.agents/plugins/marketplace.json` (Codex CLI marketplace, local path `./`). All use
  `topview-3d-builder` and the one `skills/` tree. `claude plugin validate` passes for both Claude
  files; `codex plugin marketplace add <checkout>` plus `codex plugin add
  topview-3d-builder@topview-3d-builder` installs it (tried with a throwaway `CODEX_HOME`).
- **Icons.** `assets/logo.png` and `assets/icon.png` are the same 512×512 PNG; no smaller
  `composerIcon` size is required. Rules in `assets/README.md`.
- **Scripts.**
  - `scripts/package-codex-plugin.mjs` packs `HEAD` into `dist/topview-3d-builder-plugin.zip` (root
    `topview-3d-builder/`: `.codex-plugin/`, the two referenced images, `skills/`). It fails with a named
    reason on: a non-semver version, a wrong name or skills path, apps or MCP servers, a missing,
    non-PNG, non-square, out-of-range (48–4096 px) or over-5 MiB image, symlinks, files over 100 MiB,
    hidden or nested skill directories, `topview-3d-builder:<skill>` over 64 characters, descriptions
    over 1024 characters, and an archive over 100 MB. TODO fields warn; `--release` fails on them.
  - `scripts/lint_skills.py` also flags inline code with `!` or `>` before a word, and checks the five
    manifests.
  - `scripts/set_version.py X` rewrites `__version__` (which `pyproject.toml` reads), the version
    field of the three plugin manifests and every `topview-3d-cli==X` pin in `skills/` and
    `README.md`; `--check` fails on any disagreement. No `package.json` carries the plugin version.
  - `scripts/wheel_smoke.py <wheel>` runs the stage 6 sequence through `uvx --from <wheel>`.
  - Tests: `test_plugin_packaging.py`, `test_skill_lint.py`.
- **CI** (`.github/workflows/ci.yml`): skill lint, manifest JSON, semver and version consistency;
  pytest; builder typecheck, evaluate tests, ESLint, locales and director-cli tests; Studio build and
  offline smoke; the plugin archive (a hard failure, so a broken image never passes silently); the
  wheel built once and smoke-tested with `uvx --from <wheel>` on ubuntu, macos and windows; gitleaks
  (the CLI, not the action, which needs a licence for organisation repositories) over the working
  tree on pushes and over the pull request's commits on pull requests. `actionlint` passes.
- **Release** (`.github/workflows/release.yml`): one build job, two publish jobs, both through
  Trusted Publishing (`id-token: write`). A `v*` tag, only when the repository variable
  `PYPI_PUBLISH_ENABLED` is `true`, checks the tag against `__version__` and publishes to PyPI from the
  `pypi` environment. A manual run (`workflow_dispatch`) publishes the same build to TestPyPI
  (`https://test.pypi.org/legacy/`) from the `testpypi` environment; the PyPI job never runs for it.

Acceptance:

- Met locally: the zip holds only `.codex-plugin/`, `assets/`, and `skills/`; `set_version.py`
  was tried on a clone and reverted; the wheel smoke passes on macOS; gitleaks finds nothing in the
  tree or in the commits after the initial snapshot.
- Open: CI green on all three platforms (needs a GitHub repository); the positive test cases with
  the plugin installed in Codex. Full-history gitleaks flagged the old snapshot commit; the history
  has since been rebuilt (see "Pre-publication history checklist").

### 11. Release materials and submission

- **Accounts.**
  - OpenAI Platform organization with company verification.
  - The submitter has Apps Management write access.
- **Pages.** Public website, support, privacy policy, and terms URLs. The privacy policy states that
  everything runs locally and nothing is collected.
- **Listing.** Starter prompts (the three `defaultPrompt` entries), countries and regions, and
  release notes.
- **Test cases.** Five positive:
  1. "Build a scene with a character next to a box and render a front view."
  2. "Move the camera to a low angle and render frames 0 and 48 as a contact sheet."
  3. "Pose the character waving and show me the result."
  4. "Put a sphere on top of the box and check they do not intersect."
  5. "Delete the box and everything that animates it, then validate the project."

  Three negative:
  1. "Log into my Topview account and sync my canvas." Expected: explain that there is no account or
     online feature.
  2. "Pull props from the online asset library." Expected: only built-in and user-imported assets.
  3. "Render a 4K video with a soundtrack." Expected: frames and contact sheets only; say what is
     possible.
- **Local execution.** Contact OpenAI about the local-execution dependency before submitting,
  ideally before stage 10.
- **No telemetry**, now or later.
- **Publish.** The PyPI release (Trusted Publishing) and the tag come before the directory
  submission.

Acceptance: the plugin is accepted into the OpenAI plugin directory, and the listed version installs
and passes the test cases on a clean machine.

## Phase 2: motion library

Out of phase 1 scope:

- CC0 motion sets (for example Quaternius Universal Animation Library; the builder already maps UAL1
  to mixamorig in `evaluate/retarget/RetargetMap.ts`);
- a user-side path of downloading from Mixamo and running a local import script, with imported files
  kept in the user's asset root;
- a `motion` asset kind in the manifest, motion search, and the Studio motion panel content.

Phase 1 already tolerates missing motions (stage 5), so adding them later needs no format change.

### P1. Other hosts

Cursor, Claude Code, Codex CLI, and `npx skills add` install the same `skills/` directory and call the
same pinned CLI. Only the host manifests differ.

Acceptance: each host completes positive test case 1 on a clean machine.

## Pre-publication history checklist — done

The history was rebuilt once, before anything was pushed: the repository now starts from a single
root commit, "Initial open-source release of Scene3D by TopView", whose tree is identical to the
last commit of the old `codex/scene3d-local-cli` history. Nothing has been pushed and no remote is
configured.

Why it was needed: the old root commit (`55b69e4`, a full snapshot of the upstream editor and agent
trees, later deleted from the tree but still reachable) held signed CDN and object-storage URLs,
an AWS access key id pattern, `sk-` style LLM keys, hard-coded API-key, token and secret
assignments, credential and deployment code, and Mixamo-related sources. Values are not copied here.

What was done:

1. Checked that the working tree was clean, with no stash and no remote.
2. Backed up the whole repository outside it, as
   `~/scene3d-oss-backups/scene3d-open-source-pre-squash-20260924-133600.tgz` (including `.git`
   and every branch) plus a `git bundle --all` next to it, and verified both (`tar -tzf`,
   `git bundle verify`). The old history exists only there; never push from those backups.
3. Created the orphan branch `main` with the single initial commit (author: the existing local git
   configuration, which can be changed later with `git commit --amend --author`).
4. Deleted every other branch (`codex/scene3d-local-cli`, `backup/pre-orphan-55b69e4`,
   `backup/pre-orphan-wip`) and all tags, expired the reflog and ran `git gc --prune=now --aggressive`.
5. Verified one commit in `git log --all`, gitleaks over the full history, scans for `AKIA`,
   `Key-Pair-Id`, `X-Amz-`, internal domains and npm token fragments, and a tree identical to the
   backed-up old HEAD, then ran the tests again.

Still to do before publishing:

- Revoke or rotate anything in the old history that may be real (the AWS key id, the `sk-` keys,
  the signed-URL signing key pair), regardless of the rewrite.
- Decide whether the initial commit keeps the current author identity or uses a Topview one.
- Only then add the public remote (`https://github.com/topviewai/topview-3d-builder`) and push.

## Open items

- Where the support, privacy, and terms pages are hosted (the website is
  https://www.topview.ai/topview-3d-builder).
- Logo and icon artwork.
- OpenAI's position on a plugin that requires local execution.
- Scale the pose `hips` root offset to the character (stage 5).

## Verification checklist

- `git status` contains no secrets, downloads, or local projects.
- Invalid documents and operations fail without partial writes.
- Project commands and rendering work on macOS, Linux, and Windows, both from a checkout and from
  the published package.
- `topview-3d-cli doctor --json` reports every dependency and exits 0.
- Headless render produces PNGs under the project directory.
- The skills and manifests contain no MCP, login, key, or telemetry references.
- Python, builder (`test:evaluate`), and director-cli tests stay green.


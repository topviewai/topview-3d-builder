# Topview 3D Builder

Topview 3D Builder creates editable 3D scenes on your own machine, and those scenes
guide AI video generation. You place characters, poses, props and cameras, adjust
the blocking, and render reference frames. The 3D scene is the staging plan the
video model follows. It is not the finished video.

The scene stays in a local project directory (`.topview-3d/`) and can be edited
again after it is built. `topview-3d-cli` (Python) owns that project. A Node
renderer, built on the 3D Builder, writes the PNG frames. Open the same project
in the local Studio to look at it and keep editing.

The Codex plugin is **Topview 3D Builder** (`topview-3d-builder`). It is a skill
that runs this CLI: no MCP server, no login, and no uploads. The same skill works
in the Codex CLI, Cursor, and Claude Code. Install the CLI from PyPI as
`topview-3d-cli`.

## Repository layout

- `editor/` — `topview-3d-builder`, copied from the latest `main`.
- `agent/` — the Scene3D Python package (`topview_3d_cli`, with the director
  document contract under `topview_3d_cli/contracts`). `agent/pyproject.toml`
  defines the `topview-3d-cli` distribution and the `topview-3d-cli` console script.
- `skills/topview-3d-cli/` — the agent skill: `SKILL.md` (setup, CLI contract, workflow) and one
  `references/*.md` per workflow stage. Every command it quotes runs against the CLI.
- `builtin-assets/` — the built-in characters, poses, and primitives
  (Topview-made, CC-BY-4.0; see `builtin-assets/LICENSE` and `builtin-assets/NOTICE`).
- `scripts/` — `build_dist.py` (wheel and sdist), `install.sh` (macOS/Linux) and
  `install.ps1` (Windows) for developer installs, `lint_skills.py` (skill and manifest checks),
  `set_version.py`, `package-codex-plugin.mjs` and `wheel_smoke.py`.
- `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/`, `.agents/plugins/` — plugin manifests;
  `assets/` — the plugin logo and icon. `.github/workflows/` — CI and the PyPI / TestPyPI release.
- `docs/` — [the CLI contract](docs/topview-3d-cli.md) and the migration plan.

The current transition keeps Python 3.11 for document and operation logic. Node
and Playwright remain the rendering runtime. Docker is not part of the local
execution path.

## Install the plugin

The plugin is the `skills/topview-3d-cli` skill plus a manifest per agent; it has no MCP server and no
app. The skill's first step runs the CLI through `uvx --python 3.12 topview-3d-cli@0.1.2` (or a
local wheel, see [Install the CLI](#install-the-cli)), so every agent also needs Python 3.11+,
Node.js 20.6+ and uv or pipx on the machine. The public repository is
[topviewai/topview-3d-builder](https://github.com/topviewai/topview-3d-builder).

| Agent | Manifest | Install |
| --- | --- | --- |
| ChatGPT / Codex app | `.codex-plugin/plugin.json` | Upload `dist/topview-3d-builder-plugin.zip` (below) in the plugin directory submission flow, or install from the directory once listed. |
| Codex CLI | `.agents/plugins/marketplace.json` | `codex plugin marketplace add topviewai/topview-3d-builder` (or a local checkout path), then `codex plugin add topview-3d-builder@topview-3d-builder`. |
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | `claude plugin marketplace add topviewai/topview-3d-builder`, then `claude plugin install topview-3d-builder@topview-3d-builder` (or `/plugin` inside a session). |
| Cursor | `.cursor-plugin/plugin.json` | Install from the Cursor plugin marketplace once listed; for a local copy, put the checkout (or a symlink to it) at `~/.cursor/plugins/local/topview-3d-builder` and restart Cursor. |
| Any agent with skills support | `skills/topview-3d-cli/SKILL.md` | `npx skills add topviewai/topview-3d-builder` and pick `topview-3d-cli`. |

Start a new agent session after installing, then ask for a scene, for example "Build a scene with a
character next to a box and render a front view".

### Build the Codex upload archive

```bash
node scripts/package-codex-plugin.mjs            # warns about TODO fields in the manifest
node scripts/package-codex-plugin.mjs --release  # fails on them
```

This packs the committed `HEAD` (not the working tree) into `dist/topview-3d-builder-plugin.zip`
with a single `topview-3d-builder/` root folder holding `.codex-plugin/`, the two images in
`assets/` and `skills/`. It fails with a named reason when the manifest version is not semver,
the manifest declares apps or MCP servers, an image is missing or not a square 48–4096 px PNG
of at most 5 MiB (see [assets/README.md](assets/README.md)), a skill directory is nested, hidden
or has an over-long name or description, a file is a symlink or over 100 MiB, or the archive
exceeds 100 MB.

### Versions

One version is shared by the CLI (`agent/topview_3d_cli/__init__.py`), the three plugin
manifests and every `topview-3d-cli==` pin in the skill and this README:

```bash
python3 scripts/set_version.py 0.2.0     # rewrite all of them
python3 scripts/set_version.py --check   # CI: exit 1 when any of them disagrees
```

The editor packages under `editor/` version independently and are not touched.

## Install the CLI

Requirements: Python 3.11 or newer and Node.js 20.6 or newer (with npm). The wheel bundles the
renderer, the builder files it needs, Draco, and the built-in assets. Playwright and Chromium are
downloaded once into the user cache (`~/Library/Caches/topview-3d-cli`, `%LOCALAPPDATA%\topview-3d-cli\Cache`,
or `~/.cache/topview-3d-cli`) by `topview-3d-cli browser ensure`.

### Without a checkout (pipx / uvx / pip)

```bash
pipx install topview-3d-cli
# or, without a permanent install:
uvx --python 3.12 topview-3d-cli@0.1.2 doctor
topview-3d-cli browser ensure          # installs Playwright into the user cache and downloads Chromium
topview-3d-cli doctor
```

A plain `uvx topview-3d-cli` fails when the default Python is older than 3.11, so pass
`--python 3.12`. If pip is pointed at a mirror that does not have this version yet, retry
with the official index: `python3 -m pip install --user --index-url https://pypi.org/simple/ topview-3d-cli==0.1.2`.

### Developer install from a checkout

This path also needs pnpm 8 or newer (`corepack enable pnpm` is enough).

```bash
# macOS / Linux
scripts/install.sh
```

```powershell
# Windows (PowerShell 5.1 or 7)
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The script:

1. Creates `agent/.venv` and installs the CLI into it in editable mode. It uses `uv` when present,
   otherwise `python -m venv` plus pip. An editable install uses the checkout as its runtime.
2. Installs the renderer and Studio (Next.js) with `pnpm install --frozen-lockfile`. `--dev` also installs the rest of the editor workspace.
3. Builds `@topview/3d-builder`.
4. Runs `topview-3d-cli browser ensure` to download Playwright Chromium.
5. Runs `topview-3d-cli doctor`.

Re-running the script is safe and only repeats what is missing or outdated. Options:

- `--dev` / `-Dev` installs the whole editor workspace and pytest.
- `--install-uv` / `-InstallUv` installs uv when no Python 3.11+ exists.
- `--skip-node` / `-SkipNode` and `--skip-browser` / `-SkipBrowser` skip those steps.

Build the wheel and sdist into `dist/` (needs `pip install build`; nothing is published):

```bash
agent/.venv/bin/python scripts/build_dist.py
```

### Publishing

`.github/workflows/release.yml` builds the wheel and sdist with `scripts/build_dist.py` and publishes
them with PyPI Trusted Publishing (OIDC; no upload credential is stored in GitHub):

- **TestPyPI:** run the workflow by hand (Actions → Release to PyPI → Run workflow). It uses the
  `testpypi` environment and `https://test.pypi.org/legacy/`. TestPyPI refuses a version it already
  has, so bump the version with `scripts/set_version.py` between test uploads.
- **PyPI:** push a `v<version>` tag that matches `agent/topview_3d_cli/__init__.py`. It runs only
  after the repository variable `PYPI_PUBLISH_ENABLED` is set to `true`, and uses the `pypi`
  environment.

Both environments need a Trusted Publisher for `topview-3d-cli` registered on pypi.org and
test.pypi.org (owner `topviewai`, repository `topview-3d-builder`, workflow `release.yml`).

### First scene

```bash
export PATH="$PWD/agent/.venv/bin:$PATH"     # developer install; Windows: $env:Path = "$PWD\agent\.venv\Scripts;$env:Path"
topview-3d-cli doctor
topview-3d-cli project init my-scene
topview-3d-cli document apply my-scene agent/topview_3d_cli/tests/fixtures/local-project/operations.json
topview-3d-cli asset search sit --kind pose         # built-in poses, with facets
topview-3d-cli node batch my-scene changes.json     # add/update/delete nodes in one atomic batch
topview-3d-cli evaluate my-scene                    # numerical checks, no browser
topview-3d-cli inspect views my-scene               # numbers + renders for every camera
topview-3d-cli renders show my-scene                # path of the latest contact sheet PNG
```

Every command prints one JSON object (plain `topview-3d-cli doctor` prints a readable report; use
`topview-3d-cli doctor --json` for JSON, which always exits 0 and reports readiness in `ok`). Exit code 0 means success, 2 means invalid input, and 1 means
execution failed. See [docs/topview-3d-cli.md](docs/topview-3d-cli.md) for commands, the project format, and
error codes.

Tests:

```bash
agent/.venv/bin/python -m pytest agent                                # requires --dev
agent/.venv/bin/python scripts/lint_skills.py                         # skill frontmatter, wording, links, commands
pnpm -C editor --filter @topview/3d-builder typecheck
pnpm -C editor --filter @topview/3d-builder test:evaluate
pnpm -C editor --filter @topview/3d-director-cli test
```

## For contributors

The CLI contract and the `.topview-3d/` project format are documented in
[docs/topview-3d-cli.md](docs/topview-3d-cli.md). Read that before changing either one.

## License

- Code, schemas, and documentation: Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)).
- Built-in assets in `builtin-assets/` (character models, poses, pose covers, asset manifest):
  [CC BY 4.0](builtin-assets/LICENSE). Attribution: "Scene3D built-in assets © Topview, CC BY 4.0"
  (scope in [builtin-assets/NOTICE](builtin-assets/NOTICE)).

The wheel declares `Apache-2.0 AND CC-BY-4.0` and ships both licence texts.

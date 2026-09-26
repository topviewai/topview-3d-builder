# Topview 3D Builder

Topview 3D Builder creates editable 3D scenes on your own machine, and those scenes
guide AI video generation. You place characters, poses, props and cameras, adjust
the blocking, and render reference frames. The 3D scene is the staging plan the
video model follows. It is not the finished video.

The scene stays in a local project directory (`.topview-3d/`) and can be edited
again after it is built. `topview-3d-cli` (Python) owns that project. A Node
renderer, built on the 3D Builder, writes the PNG frames. Open the same project
in the local Studio to look at it and keep editing.

The plugin is **Topview 3D Builder** (`topview-3d-builder`). It is a skill that
runs this CLI, and it works in ChatGPT (the Codex app), the Codex CLI, Cursor and
Claude Code. Building and rendering need no account and upload nothing. Sending a
finished render from the local Studio to a Topview Canvas is the one step that asks
you to sign in to Topview. Install the CLI from PyPI as `topview-3d-cli`.

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

The plugin is the `skills/topview-3d-cli` skill plus a manifest per agent. The skill's first step
runs the CLI through `uvx --python 3.12 topview-3d-cli@0.1.4` (or a local wheel, see
[Install the CLI](#install-the-cli)), so every agent also needs Python 3.11+, Node.js 20.6+ and uv
or pipx on the machine. The wheel also carries a prebuilt local Studio (open and edit a scene, send
renders to a Topview Canvas), so `studio open` works from the package with Node alone; a checkout
set up with `scripts/install.sh` runs Studio from source instead.

The repository [topviewai/topview-3d-builder](https://github.com/topviewai/topview-3d-builder) is
private for now. The commands below clone it over SSH
(`git@github.com:topviewai/topview-3d-builder.git`), so your GitHub account needs read access and an
SSH key. The short `topviewai/topview-3d-builder` form clones over HTTPS and fails on a private repo.

| Agent | Manifest the agent reads |
| --- | --- |
| ChatGPT (Codex app) and Codex CLI | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `.mcp.json` |
| Cursor | `.cursor-plugin/plugin.json` |
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` |

Only the Codex manifest declares an MCP server (`topview-browser`, in `.mcp.json`); Codex asks you to
sign in to Topview the first time the plugin uses it. Cursor and Claude Code load the skill only.
In every agent, the local Studio signs in to Topview on its own when you send a render to a Canvas.

After installing in any agent, start a new session and ask for a scene, for example "Build a scene
with a character next to a box and render a front view".

### ChatGPT (Codex app)

The ChatGPT desktop app runs plugins through Codex and shares its configuration (`~/.codex`) with the
Codex CLI. Install once with the Codex CLI commands in the next section, then restart the app; the
plugin shows up as **Topview 3D Builder**.

For a workspace-wide install, an admin uploads the plugin archive in the plugin directory submission
flow. Build it with `node scripts/package-codex-plugin.mjs --release` (see
[Build the Codex upload archive](#build-the-codex-upload-archive)) and upload
`dist/topview-3d-builder-plugin.zip`.

### Codex CLI

```bash
codex plugin marketplace add git@github.com:topviewai/topview-3d-builder.git --ref main
codex plugin add topview-3d-builder@topview-3d-builder
```

Replace `--ref main` with a tag such as `--ref v0.1.4` to pin a release, or pass a local checkout
path instead of the Git URL. Restart Codex afterwards.

To update, remove the old version first, then add it again. Codex caches an installed plugin by its
version number (`~/.codex/plugins/cache/topview-3d-builder/topview-3d-builder/<version>`), and
changes on `main` can ship under the same number, so reinstalling on top may keep the old files:

```bash
codex plugin remove topview-3d-builder@topview-3d-builder
codex plugin marketplace remove topview-3d-builder
codex plugin marketplace add git@github.com:topviewai/topview-3d-builder.git --ref main
codex plugin add topview-3d-builder@topview-3d-builder
```

This also moves a marketplace that was pinned to a tag. Restart Codex (and the ChatGPT app) afterwards.

### Cursor

Cursor loads local plugins from `~/.cursor/plugins/local/`. Clone the repository there and restart
Cursor:

```bash
git clone git@github.com:topviewai/topview-3d-builder.git ~/.cursor/plugins/local/topview-3d-builder
```

A symlink to an existing checkout works as well. To update, pull and restart Cursor:

```bash
git -C ~/.cursor/plugins/local/topview-3d-builder fetch origin main
git -C ~/.cursor/plugins/local/topview-3d-builder checkout -B main origin/main
```

For a release, use `fetch origin tag v0.1.4` and `checkout v0.1.4` instead. If the pull fails
because of local edits in that folder, delete the old copy and clone again:

```bash
rm -rf ~/.cursor/plugins/local/topview-3d-builder
git clone git@github.com:topviewai/topview-3d-builder.git ~/.cursor/plugins/local/topview-3d-builder
```

The clone also holds the Studio's `node_modules`; after cloning again, the skill runs
`scripts/install.sh` the next time it needs the Studio. The CLI itself lives in the shared
environment described under "Developer install from a checkout" and survives the re-clone.

### Claude Code

```bash
claude plugin marketplace add git@github.com:topviewai/topview-3d-builder.git
claude plugin install topview-3d-builder@topview-3d-builder
```

Inside a session, `/plugin` opens the same install flow. Restart Claude Code afterwards.

To update, remove the old version and install again:

```bash
claude plugin uninstall topview-3d-builder@topview-3d-builder
claude plugin marketplace remove topview-3d-builder
claude plugin marketplace add git@github.com:topviewai/topview-3d-builder.git
claude plugin install topview-3d-builder@topview-3d-builder
```

`claude plugin marketplace update topview-3d-builder` followed by
`claude plugin update topview-3d-builder@topview-3d-builder` also works when the version number
changed.

### Any agent with skills support

`npx skills add git@github.com:topviewai/topview-3d-builder.git` and pick `topview-3d-cli`. This
installs the skill only, without a plugin manifest or MCP server.

### Remove an old version

Remove the plugin from each agent you installed it in:

```bash
# ChatGPT (Codex app) and Codex CLI
codex plugin remove topview-3d-builder@topview-3d-builder
codex plugin marketplace remove topview-3d-builder

# Cursor
rm -rf ~/.cursor/plugins/local/topview-3d-builder

# Claude Code
claude plugin uninstall topview-3d-builder@topview-3d-builder
claude plugin marketplace remove topview-3d-builder
```

If `codex plugin list` still shows an old version after removing it, delete its cache folder
`~/.codex/plugins/cache/topview-3d-builder` and restart Codex.

Remove a CLI installed outside a checkout with the tool that installed it:

```bash
rm -rf ~/.local/share/topview-3d-cli/venv   # shared environment (Windows: %LOCALAPPDATA%\topview-3d-cli\venv)
pipx uninstall topview-3d-cli               # pipx
uv cache clean topview-3d-cli               # uvx keeps only a cache
```

Older skill versions could also leave a `work/.venv` inside a project folder or a
`pip install --user` copy; delete that folder or run `pip uninstall topview-3d-cli`.

The user cache (`~/Library/Caches/topview-3d-cli`, `%LOCALAPPDATA%\topview-3d-cli\Cache`, or
`~/.cache/topview-3d-cli`) holds Playwright and Chromium, the Studio's list of project folders, and
the Topview sign-in used to send renders to a Canvas. Delete it only when you want all of that gone;
the next render downloads the browser again and the next send asks you to sign in again.

Project folders are yours and are never removed by any of the above; each keeps its scene in
`.topview-3d/`.

### Build the Codex upload archive

```bash
node scripts/package-codex-plugin.mjs            # warns about TODO fields in the manifest
node scripts/package-codex-plugin.mjs --release  # fails on them
```

This packs the committed `HEAD` (not the working tree) into `dist/topview-3d-builder-plugin.zip`
with a single `topview-3d-builder/` root folder holding `.codex-plugin/`, `.mcp.json`, the two images
in `assets/` and `skills/`. It fails with a named reason when the manifest version is not semver,
the manifest declares apps or does not point `mcpServers` at `./.mcp.json`, `.mcp.json` is missing,
an image is missing or not a square 48–4096 px PNG
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

### Without a checkout (pipx / uvx / shared environment)

```bash
pipx install topview-3d-cli
# or, without a permanent install:
uvx --python 3.12 topview-3d-cli@0.1.4 doctor
# or, with neither pipx nor uv: one environment shared by every project
python3 -m venv ~/.local/share/topview-3d-cli/venv
~/.local/share/topview-3d-cli/venv/bin/python -m pip install topview-3d-cli==0.1.4
topview-3d-cli browser ensure          # installs Playwright into the user cache and downloads Chromium
topview-3d-cli doctor
```

On Windows the shared environment is `%LOCALAPPDATA%\topview-3d-cli\venv` and its command is
`Scripts\topview-3d-cli.exe`. `pip install --user` is not used: many Python installs refuse it
(PEP 668). A plain `uvx topview-3d-cli` fails when the default Python is older than 3.11, so pass
`--python 3.12`. If pip is pointed at a mirror that does not have this version yet, retry
with the official index: `pip install --index-url https://pypi.org/simple/ topview-3d-cli==0.1.4`.

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

1. Installs the CLI in editable mode into one environment shared by every project:
   `~/.local/share/topview-3d-cli/venv` (`$XDG_DATA_HOME/topview-3d-cli/venv` when set) on macOS and
   Linux, `%LOCALAPPDATA%\topview-3d-cli\venv` on Windows. With `--dev` it uses the checkout's
   `agent/.venv` instead. It uses `uv` when present, otherwise `python -m venv` plus pip. An
   editable install uses the checkout as its runtime.
2. Installs the renderer and Studio (Next.js) with `pnpm install --frozen-lockfile`. `--dev` also installs the rest of the editor workspace.
3. Builds `@topview/3d-builder`.
4. Runs `topview-3d-cli browser ensure` to download Playwright Chromium.
5. Runs `topview-3d-cli doctor`.

Re-running the script is safe and only repeats what is missing or outdated. Options:

- `--dev` / `-Dev` installs the whole editor workspace and pytest.
- `--install-uv` / `-InstallUv` installs uv when no Python 3.11+ exists.
- `--skip-node` / `-SkipNode` and `--skip-browser` / `-SkipBrowser` skip those steps.

Build the wheel and sdist into `dist/` (needs `pip install build`; nothing is published). The wheel
includes a standalone Studio build, so this also builds Studio:

```bash
agent/.venv/bin/python scripts/build_dist.py   # after install.sh --dev
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
export PATH="$HOME/.local/share/topview-3d-cli/venv/bin:$PATH"   # Windows: $env:Path = "$env:LOCALAPPDATA\topview-3d-cli\venv\Scripts;$env:Path"; after --dev use agent/.venv
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

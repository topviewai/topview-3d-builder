# Environment: doctor, install and the browser

## Doctor

```bash
topview-3d-cli doctor --json
```

`doctor --json` always exits 0 and prints `{"ok", "cliVersion", "runtime", "checks"}`. Gate on the
top-level `ok`; each failing check has a `hint`.

| Check | Meaning | Fix |
| --- | --- | --- |
| `python` | Python 3.11 or newer runs topview-3d-cli | Install a newer Python, or run through `uvx` (below) |
| `node` | Node.js 20.6 or newer on PATH | Ask the user to install Node.js 20.6+ (nodejs.org or a package manager); it includes npm |
| `runtime` | The renderer bundle is present (`packaged` or `workspace`) | Reinstall the package; in a checkout build the editor first |
| `assets` | The built-in manifest loads (characters, poses, primitives) | Reinstall the package |
| `playwright` | The pinned Playwright version is installed | `topview-3d-cli browser ensure` |
| `chromium` | Playwright's Chromium launches | `topview-3d-cli browser ensure` (Linux: `topview-3d-cli browser ensure --with-deps`, uses sudo) |

`pnpm` appears only in a source checkout. Document edits, `evaluate`, `bom` and `asset` commands
need Python and Node only; `render`, `inspect nodes`, `inspect views` and `pose batch` also need
Playwright and Chromium.

## Installing topview-3d-cli

Use this skill's pinned version, 0.1.0, and stop at the first route that works:

1. `uvx --python 3.12 topview-3d-cli@0.1.0 doctor --json`: runs without a permanent install;
   `--python 3.12` makes uv use (or download) a Python it can run the package with.
   Prefix every later command the same way (`uvx --python 3.12 topview-3d-cli@0.1.0 ...`).
2. `pipx run --spec topview-3d-cli==0.1.0 topview-3d-cli doctor --json`, or
   `pipx install topview-3d-cli==0.1.0` for a permanent `topview-3d-cli` on PATH.
3. `python3 -m pip install --user topview-3d-cli==0.1.0`, then make sure the user scripts
   directory is on PATH.

When the package index is not an option (no network to PyPI, or a build that is not published):

- **A wheel file** the user provides (`topview_3d_cli-<version>-py3-none-any.whl`):
  `uvx --python 3.12 --from <path-to-wheel> topview-3d-cli doctor --json`, and the same prefix for
  every later command; or `pipx install <path-to-wheel>` for a permanent command.
- **A source checkout** of the repository: the renderer bundle has to be built first, so follow
  the checkout's README (`install.sh`, or `install.ps1` on Windows, builds the editor and installs
  the command into `agent/.venv`), or build a wheel there with `scripts/build_dist.py` and use it
  as above. Installing straight from the `agent/` directory without that build step gives
  `RUNTIME_MISSING`.

Then run `topview-3d-cli browser ensure` once. It is idempotent: it installs the pinned Playwright into
the user cache (`~/Library/Caches/topview-3d-cli` on macOS, `~/.cache/topview-3d-cli` on Linux,
`%LOCALAPPDATA%\topview-3d-cli\Cache` on Windows; `TOPVIEW3D_CACHE_DIR` overrides it) and Chromium into
Playwright's browser cache. It needs network access once; after that everything runs offline.
`render` never downloads anything and fails with `BROWSER_NOT_INSTALLED` instead.

Installing software changes the user's machine: say what you are about to install and ask first
when the user has not already asked you to set topview-3d-cli up.

## When the browser is blocked

Some agent sandboxes forbid what Chromium needs (on macOS the Mach-port lookups of the GPU and
network helper processes; elsewhere shared memory or network access for the one-time download).
The signs are `doctor` reporting `chromium` as failing only inside the sandbox, or `render` /
`inspect views` failing with `RENDER_FAILED` or `BROWSER_INSTALL_FAILED` and a launch or crash
message, while the same command works in the user's own terminal.

- Stop retrying once this is identified. Explain that the sandbox blocks the headless browser,
  not topview-3d-cli, and ask the user to approve running the command outside the sandbox (or to run it
  themselves and share the result).
- Keep going with everything that needs no browser: `document`, `node batch`, `evaluate`, `bom`,
  `asset` and `pose catalog`.
- Never build a substitute renderer (image libraries, SVG drawings, hand-made frames) and never
  describe an image you have not rendered and opened.

## Other failures

- `RUNTIME_MISSING`: the installation is incomplete; reinstall the pinned version.
- `ASSET_NOT_AVAILABLE`: the document references a character or prop model that is not in the
  local manifests (for example a project from elsewhere). Import the model with
  `topview-3d-cli asset import --project <dir> ...` or replace the node.
- `RENDER_FAILED` with `details`: read the message; a scene that renders blank or with warnings is
  still a result to look at, not a reason to reinstall.

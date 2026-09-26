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

Install once per machine and reuse that install in every project. Use this skill's pinned
version, 0.1.4. The shared environment is:

| System | Environment | Command |
| --- | --- | --- |
| macOS, Linux | `~/.local/share/topview-3d-cli/venv` (`$XDG_DATA_HOME/topview-3d-cli/venv` when that is set) | `<venv>/bin/topview-3d-cli` |
| Windows | `$env:LOCALAPPDATA\topview-3d-cli\venv` | `<venv>\Scripts\topview-3d-cli.exe` |

Never create a virtual environment inside the user's project or the agent's workspace; the next
project would install everything again. Do not use `pip install --user` either: many Python
installs refuse it (PEP 668, `externally-managed-environment`).

1. **Reuse.** When `topview-3d-cli` is on PATH or the shared command exists, run its
   `doctor --json`. If `cliVersion` matches the pin `topview-3d-cli==0.1.4`, use it and stop here. If the version differs,
   reinstall into the same environment with step 2 or 3; do not create another one.
2. **Checkout.** When the folder that holds this skill also has `agent/` and `editor/` (agent
   plugin installs are checkouts), run `scripts/install.sh` from that
   folder, or `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` on Windows. It installs
   the CLI into the shared environment together with the renderer and Studio's Next.js. Do not
   install only the renderer package; that can render PNGs and then fail `studio open` because
   Next.js is missing. Installing straight from the `agent/` directory without that build step
   gives `RUNTIME_MISSING`.
3. **No checkout.** The package carries a prebuilt Studio, so `studio open` works from each of
   these routes. Stop at the first route that works:
   - `uvx --python 3.12 topview-3d-cli@0.1.4 doctor --json` runs from uv's cache without an install;
     `--python 3.12` makes uv use (or download) a Python it can run the package with. Prefix every
     later command the same way.
   - `pipx install topview-3d-cli==0.1.4` gives a permanent `topview-3d-cli` on PATH.
   - Otherwise create the shared environment with a Python 3.11 or newer and install into it:
     - macOS, Linux: `python3 -m venv ~/.local/share/topview-3d-cli/venv`, then
       `~/.local/share/topview-3d-cli/venv/bin/python -m pip install topview-3d-cli==0.1.4`
     - Windows: `py -3.12 -m venv "$env:LOCALAPPDATA\topview-3d-cli\venv"` (or `python -m venv ...`
       when the `py` launcher is missing), then
       `& "$env:LOCALAPPDATA\topview-3d-cli\venv\Scripts\python.exe" -m pip install topview-3d-cli==0.1.4`

In an agent sandbox, creating the shared environment writes outside the workspace and downloads
packages, so it may need the user's approval. Ask once; every later project reuses the install
without asking again.

If a pip or pipx install fails because the configured index has no such version (a mirror that
has not synced yet reports `Could not find a version` and `from versions: none`), retry that same
command against the official PyPI simple index and do not change the user's pip configuration.
Build the index as scheme https, host `pypi.org`, path `/simple/`, and pass it like this:

- pip: `<venv-python> -m pip install --index-url <index> topview-3d-cli==0.1.4`
- pipx: `pipx install --pip-args '--index-url <index>' topview-3d-cli==0.1.4`

Other pip failures (no network, permissions, a broken environment) are not an index problem;
do not switch the index for those.

When the package index is not an option (no network to PyPI, or a build that is not published)
and the user provides a wheel file (`topview_3d_cli-<version>-py3-none-any.whl`), install it into
the shared environment with `<venv-python> -m pip install <path-to-wheel>`, or run it with
`uvx --python 3.12 --from <path-to-wheel> topview-3d-cli doctor --json` and the same prefix for
every later command.

Then run `topview-3d-cli browser ensure` once. It is idempotent: it installs the pinned Playwright into
the user cache (`~/Library/Caches/topview-3d-cli` on macOS, `~/.cache/topview-3d-cli` on Linux,
`%LOCALAPPDATA%\topview-3d-cli\Cache` on Windows; `TOPVIEW3D_CACHE_DIR` overrides it) and Chromium into
Playwright's browser cache. It needs network access once; after that everything runs offline.
`render` never downloads anything and fails with `BROWSER_NOT_INSTALLED` instead.

Installing software changes the user's machine: say what you are about to install and ask first
when the user has not already asked you to set topview-3d-cli up.

## Open the finished scene in Studio

After the scene is checked and the renders have been looked at, open the local Studio in the
In-App Browser so the user can view it. Do not open it in the system browser. Do not edit the
scene in that page: moving a stool, checking bounds, or any other change goes through
topview-3d-cli. Browser automation must not click or drag the Studio UI to change the scene.

```bash
topview-3d-cli studio open <dir>
```

The command only starts Studio with Node on port 3002 when that port is free. It returns a `url`
and does not open a browser. Open that `url` in the In-App Browser. The project directory is
`.topview-3d`. Studio saves edits back into
that project. When the user says they changed the scene in Studio, re-read it with
`topview-3d-cli document get <dir> --summary` and continue from that result. Do not replay the
scene you built before the Studio edit.
Do this once at the end of a scene, not after every edit.

- `STUDIO_UNAVAILABLE` and the error says Next.js is not installed: the checkout is there, but
  `editor/` dependencies were not installed (a render-only setup does not include Studio). The
  error names that `editor` folder; run `pnpm install` there once (pnpm 8 or newer;
  `corepack enable pnpm` is enough when pnpm is missing). Then run `studio open` one more time
  and open the returned `url` in the In-App Browser. Do not treat this as a missing Studio.
- `STUDIO_UNAVAILABLE` and the error says the package has no Studio build: this install predates
  the bundled Studio. Reinstall the pinned version into the same environment (install step 1 or 3
  above) and run `studio open` once more. If it still fails, say so and stop; do not build another
  viewer.
- `STUDIO_UNAVAILABLE` and the error says Node.js is not on PATH: install Node.js 20.6 or newer,
  as for rendering, then run `studio open` once more.
- `STUDIO_PROJECT_MISSING`: a Studio is already running and does not see this project yet
  (often one started from another directory before this registry existed). Ask the user to stop
  it, then run the command again. Do not start a second Studio on the same port.
- `STUDIO_START_FAILED`: Node did not bring Studio up. Report the error and do not retry in a loop.

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

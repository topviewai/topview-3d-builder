"""Where the Node renderer, the builder build and the built-in assets live.

- ``packaged``: files staged into ``topview_3d_cli/_runtime/`` when the wheel is built
  (``scripts/build_dist.py``). Playwright is installed by ``topview-3d-cli browser ensure`` into a
  per-user cache, never into site-packages.
- ``workspace``: a repository checkout (editable install) using ``editor/`` and
  ``builtin-assets/`` directly.

A checkout is preferred when present; ``TOPVIEW3D_RUNTIME=packaged|workspace`` forces a mode.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from topview_3d_cli import __version__
from topview_3d_cli.local_errors import LocalProjectError

PACKAGE_DIR = Path(__file__).resolve().parent
STAGED_ROOT = PACKAGE_DIR / "_runtime"
REPO_ROOT = PACKAGE_DIR.parents[1]
PLAYWRIGHT_VERSION = "1.63.0"
RUNTIME_MODES = ("workspace", "packaged")


@dataclass(frozen=True)
class Runtime:
    mode: str
    director_cli: Path
    builtin_assets: Path
    builder_dist: Path
    node_prefix: Path

    @property
    def playwright_package(self) -> Path:
        return self.node_prefix / "node_modules" / "playwright" / "package.json"


def user_cache_dir() -> Path:
    override = os.environ.get("TOPVIEW3D_CACHE_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "topview-3d-cli"
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "topview-3d-cli" / "Cache"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "topview-3d-cli"


def _workspace() -> Runtime | None:
    director_cli = REPO_ROOT / "editor" / "packages" / "director-cli"
    assets = REPO_ROOT / "builtin-assets"
    if not (director_cli / "cli.mjs").is_file() or not assets.is_dir():
        return None
    return Runtime("workspace", director_cli, assets, REPO_ROOT / "editor" / "packages" / "builder" / "dist",
                   director_cli)


def _packaged() -> Runtime | None:
    director_cli = STAGED_ROOT / "director-cli"
    if not (director_cli / "cli.mjs").is_file():
        return None
    return Runtime("packaged", director_cli, STAGED_ROOT / "builtin-assets",
                   director_cli / "node_modules" / "@topview" / "3d-builder" / "dist",
                   user_cache_dir() / "node" / __version__)


def runtime() -> Runtime:
    forced = os.environ.get("TOPVIEW3D_RUNTIME")
    if forced and forced not in RUNTIME_MODES:
        raise LocalProjectError("RUNTIME_MISSING", f"TOPVIEW3D_RUNTIME must be one of {', '.join(RUNTIME_MODES)}")
    found = {"workspace": _workspace, "packaged": _packaged}
    for mode in [forced] if forced else RUNTIME_MODES:
        resolved = found[mode]()
        if resolved is not None:
            return resolved
    raise LocalProjectError(
        "RUNTIME_MISSING",
        "no renderer runtime: reinstall topview-3d-cli, or build editor/ in a checkout",
    )


def builder_version() -> str:
    current = runtime()
    source = (current.director_cli.parent / "builder" / "package.json" if current.mode == "workspace"
              else STAGED_ROOT / "runtime.json")
    try:
        version = json.loads(source.read_text(encoding="utf-8")).get(
            "version" if current.mode == "workspace" else "builderVersion")
    except (OSError, json.JSONDecodeError) as exc:
        raise LocalProjectError("BUILDER_PACKAGE_UNREADABLE", f"{source}: {exc}") from exc
    if not isinstance(version, str) or not version:
        raise LocalProjectError("BUILDER_PACKAGE_UNREADABLE", f"{source}: missing version")
    return version


def node_env(current: Runtime) -> dict[str, str]:
    env = dict(os.environ)
    if current.mode == "packaged":
        env["TOPVIEW3D_NODE_PREFIX"] = str(current.node_prefix)
    else:
        env.pop("TOPVIEW3D_NODE_PREFIX", None)
    return env

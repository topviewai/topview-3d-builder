"""Pick the Node.js that runs the renderer, npm and Studio.

The first ``node`` on PATH is used when it is new enough. Agent shells often put an old system
Node first (``/usr/local/bin/node`` from an old installer) while a newer one sits in nvm, fnm,
Volta, asdf or Homebrew, so an old first match falls back to the newest Node that meets
``MIN_NODE`` in those places. ``TOPVIEW3D_NODE`` names one explicitly. Child processes get the
chosen Node's directory first on PATH, so ``npm`` (a ``#!/usr/bin/env node`` script) runs on it too.
"""
from __future__ import annotations

import functools
import glob
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from topview_3d_cli.local_errors import LocalProjectError

MIN_NODE = (20, 6)
MIN_NODE_TEXT = ".".join(str(part) for part in MIN_NODE)
NODE_EXE = "node.exe" if sys.platform == "win32" else "node"


@dataclass(frozen=True)
class NodeChoice:
    path: str
    version: str
    path_node: str | None
    path_version: str | None


def version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", text)[:3])


def node_version(node: str) -> str | None:
    try:
        with subprocess.Popen([node, "--version"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True) as process:
            try:
                output, _ = process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                return None
    except OSError:
        return None
    text = output.strip()
    return text if process.returncode == 0 and text.startswith("v") else None


def _installed_nodes() -> list[str]:
    home = Path.home()
    patterns: list[str] = []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry:
            patterns.append(str(Path(entry) / NODE_EXE))
    nvm = os.environ.get("NVM_DIR") or str(home / ".nvm")
    fnm = [os.environ.get("FNM_DIR"), str(home / ".local" / "share" / "fnm"), str(home / ".fnm"),
           str(home / "Library" / "Application Support" / "fnm")]
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if base:
                patterns.append(str(Path(base) / "nodejs" / NODE_EXE))
        for base in (os.environ.get("NVM_HOME"), os.environ.get("APPDATA") and str(Path(os.environ["APPDATA"]) / "nvm")):
            if base:
                patterns.append(str(Path(base) / "v*" / NODE_EXE))
        fnm.append(os.environ.get("APPDATA") and str(Path(os.environ["APPDATA"]) / "fnm"))
        patterns += [str(Path(base) / "node-versions" / "*" / "installation" / NODE_EXE) for base in fnm if base]
        local = os.environ.get("LOCALAPPDATA")
        if local:
            patterns.append(str(Path(local) / "Volta" / "bin" / NODE_EXE))
    else:
        patterns += [
            str(Path(nvm) / "versions" / "node" / "*" / "bin" / "node"),
            *(str(Path(base) / "node-versions" / "*" / "installation" / "bin" / "node") for base in fnm if base),
            str(home / ".volta" / "bin" / "node"),
            str(home / ".asdf" / "installs" / "nodejs" / "*" / "bin" / "node"),
            str(home / ".local" / "share" / "mise" / "installs" / "node" / "*" / "bin" / "node"),
            "/opt/homebrew/bin/node",
            "/opt/homebrew/opt/node@*/bin/node",
            "/usr/local/opt/node@*/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
    found: list[str] = []
    for pattern in patterns:
        for candidate in sorted(glob.glob(pattern)):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK) and candidate not in found:
                found.append(candidate)
    return found


@functools.cache
def choose_node() -> NodeChoice:
    override = os.environ.get("TOPVIEW3D_NODE", "").strip()
    if override:
        version = node_version(override)
        if not version:
            raise LocalProjectError("NODE_UNAVAILABLE", f"TOPVIEW3D_NODE={override} does not run")
        if version_tuple(version) < MIN_NODE:
            raise LocalProjectError("NODE_TOO_OLD", f"TOPVIEW3D_NODE={override} is Node {version}; "
                                                    f"Node.js {MIN_NODE_TEXT} or newer is required")
        return NodeChoice(override, version, override, version)
    first = shutil.which("node")
    first_version = node_version(first) if first else None
    if first and first_version and version_tuple(first_version) >= MIN_NODE:
        return NodeChoice(first, first_version, first, first_version)
    best: tuple[tuple[int, ...], str, str] | None = None
    for candidate in _installed_nodes():
        version = node_version(candidate)
        if version and version_tuple(version) >= MIN_NODE and (best is None or version_tuple(version) > best[0]):
            best = (version_tuple(version), candidate, version)
    if best:
        return NodeChoice(best[1], best[2], first, first_version)
    if first:
        raise LocalProjectError(
            "NODE_TOO_OLD",
            f"node on PATH ({first}) is {first_version or 'unreadable'} and no Node.js {MIN_NODE_TEXT} or newer "
            "was found; install a newer Node.js, or set TOPVIEW3D_NODE to one",
        )
    raise LocalProjectError("NODE_UNAVAILABLE", f"node is not on PATH; install Node.js {MIN_NODE_TEXT} or newer")


def node_path() -> str:
    return choose_node().path


def with_node_on_path(env: dict[str, str]) -> dict[str, str]:
    """``env`` with the chosen Node's directory first on PATH."""
    directory = str(Path(choose_node().path).parent)
    rest = [entry for entry in env.get("PATH", "").split(os.pathsep) if entry and entry != directory]
    return {**env, "PATH": os.pathsep.join([directory, *rest])}


def npm_path() -> str | None:
    """npm next to the chosen Node (or on PATH); run it with ``with_node_on_path``."""
    directory = Path(choose_node().path).parent
    for name in (("npm.cmd", "npm.exe") if sys.platform == "win32" else ("npm",)):
        if (directory / name).is_file():
            return str(directory / name)
    return shutil.which("npm")

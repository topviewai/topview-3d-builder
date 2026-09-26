"""Open a local project in Studio.

Studio is the Next.js app at ``editor/apps/studio``. A repository checkout runs it with
``next dev``; the published wheel carries a standalone build in ``_runtime/studio`` and runs its
``server.js`` with Node. Studio starts only when port 3002 is free. This returns the project URL
and does not open a browser; the caller opens that URL in the In-App Browser.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import sys
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import open_project
from topview_3d_cli.runtime import Runtime, runtime, user_cache_dir

STUDIO_PORT = 3002
STUDIO_HOST = "127.0.0.1"


def studio_project_id(root: Path) -> str:
    """Stable id from the absolute path, so two folders with the same name stay distinct."""
    digest = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:16]
    return f"cli-{digest}"


def project_registry_path() -> Path:
    return user_cache_dir() / "studio" / "projects.txt"


def register_studio_project(root: Path) -> None:
    """Remember this absolute project path for every Studio process on this machine."""
    registry = project_registry_path()
    registry.parent.mkdir(parents=True, exist_ok=True)
    current = registry.read_text(encoding="utf-8").splitlines() if registry.is_file() else []
    paths = [line.strip() for line in current if line.strip()]
    resolved = str(root)
    if resolved not in paths:
        paths.append(resolved)
        registry.write_text("\n".join(paths) + "\n", encoding="utf-8")


def _next_bin(studio: Path) -> Path:
    candidates = [
        studio / "node_modules" / "next" / "dist" / "bin" / "next",
        studio.parents[1] / "node_modules" / "next" / "dist" / "bin" / "next",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise LocalProjectError(
        "STUDIO_UNAVAILABLE",
        f"Next.js is not installed; run pnpm install in {studio.parents[1]}",
    )


def _studio_command(rt: Runtime) -> tuple[list[str], Path, dict[str, str]]:
    """Command, working directory and extra environment that start Studio for this runtime."""
    if rt.mode == "packaged":
        server = rt.studio / "server.js"
        if not server.is_file():
            raise LocalProjectError(
                "STUDIO_UNAVAILABLE",
                f"this topview-3d-cli package has no Studio build ({server} is missing); reinstall it",
            )
        env = {
            "PORT": str(STUDIO_PORT),
            "HOSTNAME": STUDIO_HOST,
            "TOPVIEW3D_DRAFTS_DIR": str(user_cache_dir() / "studio" / "drafts"),
        }
        return ["node", str(server)], rt.studio, env
    if not (rt.studio / "package.json").is_file():
        raise LocalProjectError("STUDIO_UNAVAILABLE", f"Studio is missing from the checkout ({rt.studio})")
    command = ["node", str(_next_bin(rt.studio)), "dev", "--port", str(STUDIO_PORT), "--hostname", STUDIO_HOST]
    return command, rt.studio, {}


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((STUDIO_HOST, port)) == 0


def _projects(port: int) -> list[dict]:
    url = f"http://{STUDIO_HOST}:{port}/api/projects"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        raise LocalProjectError("STUDIO_START_FAILED", f"Studio on port {port} did not list projects: {exc}") from exc
    projects = body.get("projects") if isinstance(body, dict) else None
    if not isinstance(projects, list):
        raise LocalProjectError("STUDIO_START_FAILED", "Studio /api/projects did not return a project list")
    return projects


def _wait_until_listed(port: int, project_id: str, timeout: float = 180) -> None:
    # The first request compiles the route in next dev, which takes minutes on slow machines.
    deadline = time.monotonic() + timeout
    last_error = "timed out"
    while time.monotonic() < deadline:
        if _port_open(port):
            try:
                if any(item.get("id") == project_id for item in _projects(port) if isinstance(item, dict)):
                    return
                last_error = f"project {project_id} is not in the list"
            except LocalProjectError as exc:
                last_error = str(exc)
        time.sleep(0.4)
    raise LocalProjectError("STUDIO_START_FAILED", f"Studio did not become ready: {last_error}")


def _detached() -> dict:
    """Keep Studio running after the agent's command and its console exit."""
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        return {"creationflags": flags, "close_fds": True}
    return {"start_new_session": True}


def _start(project_root: Path) -> int:
    rt = runtime()
    command, cwd, extra_env = _studio_command(rt)
    log_dir = user_cache_dir() / "studio"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "studio.log"
    env = dict(os.environ)
    env.update(extra_env)
    env["TOPVIEW3D_CACHE_DIR"] = str(user_cache_dir())
    env["TOPVIEW3D_PROJECTS"] = str(project_root)
    env["TOPVIEW3D_PYTHON"] = sys.executable
    env["TOPVIEW3D_BUILTIN_ASSETS"] = str(rt.builtin_assets)
    log = log_path.open("ab")
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            **_detached(),
        )
    except FileNotFoundError as exc:
        raise LocalProjectError("STUDIO_UNAVAILABLE", "Node.js is not on PATH; Studio needs Node.js 20.6 or newer") from exc
    finally:
        log.close()
    return process.pid


def open_studio(directory: str) -> dict:
    project = open_project(directory)
    root = project.paths.root
    register_studio_project(root)
    project_id = studio_project_id(root)
    url = f"http://{STUDIO_HOST}:{STUDIO_PORT}/?project={project_id}"
    started = False
    pid = None
    if _port_open(STUDIO_PORT):
        listed = _projects(STUDIO_PORT)
        if not any(item.get("id") == project_id for item in listed if isinstance(item, dict)):
            raise LocalProjectError(
                "STUDIO_PROJECT_MISSING",
                f"Studio on port {STUDIO_PORT} does not see this project yet; stop it and run studio open again",
            )
    else:
        pid = _start(root)
        started = True
        _wait_until_listed(STUDIO_PORT, project_id)
    return {
        "ok": True,
        "url": url,
        "projectId": project_id,
        "project": str(root),
        "started": started,
        "pid": pid,
    }

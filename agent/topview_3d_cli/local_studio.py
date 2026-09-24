"""Open a local project in the checkout's Studio app.

Studio is the Next.js app at ``editor/apps/studio``. It is not inside the published
wheel, so this command only works from a repository checkout. It starts Studio with
Node when port 3002 is free. It returns the project URL and does not open a browser; the
caller opens that URL in the In-App Browser.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import sys
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import open_project
from topview_3d_cli.runtime import REPO_ROOT, runtime, user_cache_dir

STUDIO_PORT = 3002
STUDIO_HOST = "127.0.0.1"


def studio_project_id(directory_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", directory_name.lower()).strip("-") or "project"
    return f"cli-{slug[:48]}"


def _studio_dir() -> Path:
    studio = REPO_ROOT / "editor" / "apps" / "studio"
    if not (studio / "package.json").is_file():
        raise LocalProjectError(
            "STUDIO_UNAVAILABLE",
            "Studio is part of a repository checkout (editor/apps/studio), not the published package",
        )
    return studio


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
        "Next.js is not installed; run pnpm install in editor/ of the checkout",
    )


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


def _wait_until_listed(port: int, project_id: str, timeout: float = 60) -> None:
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


def _start(studio: Path, next_bin: Path, project_root: Path) -> int:
    log_dir = user_cache_dir() / "studio"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "studio.log"
    env = dict(os.environ)
    env["TOPVIEW3D_PROJECTS"] = str(project_root)
    env["TOPVIEW3D_CLI"] = shutil.which("topview-3d-cli") or sys.argv[0]
    try:
        env["TOPVIEW3D_BUILTIN_ASSETS"] = str(runtime().builtin_assets)
    except LocalProjectError:
        pass
    log = log_path.open("ab")
    try:
        process = subprocess.Popen(
            ["node", str(next_bin), "dev", "--port", str(STUDIO_PORT), "--hostname", STUDIO_HOST],
            cwd=studio,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log.close()
    return process.pid


def open_studio(directory: str) -> dict:
    project = open_project(directory)
    root = project.paths.root
    project_id = studio_project_id(root.name)
    url = f"http://{STUDIO_HOST}:{STUDIO_PORT}/?project={project_id}"
    started = False
    pid = None
    if _port_open(STUDIO_PORT):
        listed = _projects(STUDIO_PORT)
        if not any(item.get("id") == project_id for item in listed if isinstance(item, dict)):
            raise LocalProjectError(
                "STUDIO_PROJECT_MISSING",
                f"Studio is already running on port {STUDIO_PORT} without this project; stop it and run studio open again",
            )
    else:
        studio = _studio_dir()
        pid = _start(studio, _next_bin(studio), root)
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

#!/usr/bin/env python3
"""Start Studio through ``studio open`` and check it from separate processes.

    python scripts/studio_smoke.py start DIR [--wheel WHEEL]  # project init + studio open, remembers the pid
    python scripts/studio_smoke.py check DIR                  # Studio still up, serves the page, saves the project
    python scripts/studio_smoke.py stop DIR                   # stops the Studio process tree

Without ``--wheel`` the CLI is this Python's ``topview_3d_cli`` (a checkout runs ``next dev``); with
``--wheel`` it is ``uvx --from WHEEL topview-3d-cli``, which runs the Studio build inside the wheel.

Run each step as its own command: ``check`` proves Studio outlived the command that started
it (on Windows ``start_new_session`` does nothing, so this is where detaching breaks). The
save goes through ``project adopt``, so it also proves Studio can call the CLI back.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:3002"


def cli(prefix: list[str], *args: str) -> dict:
    print("+ topview-3d-cli", " ".join(args), flush=True)
    result = subprocess.run([*prefix, *args], capture_output=True, text=True, check=False)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {}
    if result.returncode != 0 or not payload.get("ok"):
        sys.stderr.write(result.stdout[-4000:] + result.stderr[-4000:])
        raise SystemExit(f"topview-3d-cli {' '.join(args)}: exit {result.returncode}")
    return payload


def fetch(method: str, path: str, body: object | None = None) -> bytes:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def request(method: str, path: str, body: object | None = None) -> object:
    return json.loads(fetch(method, path, body).decode("utf-8"))


def state_file(directory: Path) -> Path:
    return directory.parent / f"{directory.name}.studio-smoke.json"


def cli_prefix(wheel: Path | None) -> list[str]:
    if wheel is None:
        return [sys.executable, "-m", "topview_3d_cli"]
    uvx = shutil.which("uvx")
    if not uvx:
        raise SystemExit("error: `uvx` is not on PATH (install uv)")
    return [uvx, "--from", str(wheel), "topview-3d-cli"]


def start(directory: Path, wheel: Path | None) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    prefix = cli_prefix(wheel)
    cli(prefix, "project", "init", str(directory))
    opened = cli(prefix, "studio", "open", str(directory))
    if not opened.get("started"):
        raise SystemExit("port 3002 was already in use; stop that Studio first")
    state_file(directory).write_text(json.dumps(opened), encoding="utf-8")
    print(json.dumps(opened, indent=2))


def check(directory: Path) -> None:
    opened = json.loads(state_file(directory).read_text(encoding="utf-8"))
    project_id = opened["projectId"]
    time.sleep(2)
    listed = request("GET", "/api/projects")
    ids = [item.get("id") for item in listed.get("projects", []) if isinstance(item, dict)]  # type: ignore[union-attr]
    if project_id not in ids:
        raise SystemExit(f"Studio does not list {project_id}; it lists {ids}")
    page = fetch("GET", opened["url"].removeprefix(BASE)).decode("utf-8")
    script = re.search(r'src="(/[^"]+\.js)"', page)
    if not script:
        raise SystemExit("the Studio page references no script")
    fetch("GET", script.group(1))
    document = request("GET", f"/api/projects/{project_id}")
    saved = request("PUT", f"/api/projects/{project_id}", document)
    if not isinstance(saved, dict) or saved.get("id") != project_id:
        raise SystemExit(f"saving through project adopt failed: {saved}")
    print(f"Studio serves {script.group(1)}, lists and saves {project_id}")


def stop(directory: Path) -> None:
    if not state_file(directory).is_file():
        print("no Studio was started")
        return
    opened = json.loads(state_file(directory).read_text(encoding="utf-8"))
    pid = int(opened["pid"])
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False)
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    state_file(directory).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("step", choices=["start", "check", "stop"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--wheel", type=Path, help="start: run the CLI from this wheel through uvx")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.step == "start":
        wheel = args.wheel.resolve() if args.wheel else None
        if wheel and not wheel.is_file():
            raise SystemExit(f"error: {wheel} does not exist")
        start(directory, wheel)
    else:
        {"check": check, "stop": stop}[args.step](directory)
    return 0


if __name__ == "__main__":
    sys.exit(main())

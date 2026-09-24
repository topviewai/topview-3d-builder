"""Calls into the Node renderer (``director-cli``): one process per command, JSON in and out."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.runtime import node_env, runtime

BROWSER_COMMANDS = frozenset({"render-frames", "inspect-nodes", "apply-library-pose", "apply-library-poses"})


def node_path() -> str:
    node = shutil.which("node")
    if not node:
        raise LocalProjectError("NODE_UNAVAILABLE", "node is not on PATH; install Node.js 20.6 or newer")
    return node


def director_cli(command: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run one director-cli command with a JSON payload file; return its last JSON line.

    Failures raise ``RENDERER_FAILED`` (``RENDER_FAILED`` for ``render-frames``) with the thrown
    error message as the message and the full stderr (stack included) in ``details.stderr``, or
    ``BROWSER_NOT_INSTALLED`` when Chromium is missing.
    """
    current = runtime()
    node = node_path()
    args = [node, "cli.mjs", command]
    payload_file = None
    if body is not None:
        descriptor, payload_file = tempfile.mkstemp(prefix="topview3d-", suffix=".json")
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(body, stream, ensure_ascii=False)
        args.append(payload_file)
    try:
        process = subprocess.run(args, cwd=current.director_cli, env=node_env(current), check=False,
                                 capture_output=True, text=True, encoding="utf-8")
    finally:
        if payload_file:
            Path(payload_file).unlink(missing_ok=True)
    if process.returncode:
        message = (process.stderr or process.stdout).strip()[-2000:]
        if "PLAYWRIGHT_NOT_INSTALLED" in message or "Executable doesn't exist" in message:
            raise LocalProjectError("BROWSER_NOT_INSTALLED", "run `topview-3d-cli browser ensure` first")
        failure = "RENDER_FAILED" if command == "render-frames" else "RENDERER_FAILED"
        reason = renderer_reason(message)
        raise LocalProjectError(failure, reason or f"director-cli {command} exited with {process.returncode}",
                                details={"command": command, "reason": reason, "stderr": message[-4000:]})
    lines = [line for line in process.stdout.splitlines() if line.strip()]
    if not lines:
        raise LocalProjectError("RENDER_RESULT_MISSING")
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise LocalProjectError("RENDER_RESULT_INVALID", str(exc)) from exc


def renderer_reason(message: str) -> str:
    """The thrown error message: an ``...Error:`` line, else the first line that is not a Node warning."""
    for line in message.splitlines():
        match = re.match(r"\s*(?:Uncaught )?[A-Za-z]*Error: (.+)", line)
        if match:
            return match.group(1).strip()
    for line in message.splitlines():
        text = line.strip()
        if text and not text.startswith(("(node:", "(Use `node --trace")):
            return text.removeprefix("Error: ")
    return ""

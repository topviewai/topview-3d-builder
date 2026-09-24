#!/usr/bin/env python3
"""Run the installed-wheel smoke sequence through ``uvx --from <wheel>`` (macOS, Linux, Windows).

    python scripts/wheel_smoke.py dist/topview_3d_cli-0.1.0-py3-none-any.whl [--workdir DIR] [--skip-browser]

Sequence: ``doctor --json`` → ``browser ensure`` → ``project init`` → ``asset search`` (built-in
poses ship in the wheel) → ``document apply`` → ``evaluate`` → ``render`` → ``renders show``. Each
command must exit 0 and print JSON with ``ok: true``; the render must leave a PNG inside the
project. ``--skip-browser`` stops after ``evaluate`` (no Chromium download).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

OPERATIONS = {
    "schemaVersion": 2,
    "batchId": "wheel_smoke",
    "operations": [
        {
            "operationId": "smoke_box",
            "entityId": "box-1",
            "kind": "director.node.upsert",
            "payload": {
                "node": {
                    "id": "box-1",
                    "type": "primitive",
                    "name": "Box",
                    "transform": {
                        "position": {"x": 0, "y": 0.5, "z": 0},
                        "rotation": {"x": 0, "y": 0, "z": 0},
                        "scale": {"x": 1, "y": 1, "z": 1},
                    },
                    "primitive": {"kind": "BoxGeometry", "parameters": {"width": 1, "height": 1, "depth": 1}},
                }
            },
        }
    ],
}


def cli(uvx: str, wheel: Path, *args: str, allow_not_ok: bool = False) -> dict:
    command = [uvx, "--from", str(wheel), "topview-3d-cli", *args]
    print("+ topview-3d-cli", " ".join(args), flush=True)
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit(f"topview-3d-cli {' '.join(args)}: output is not JSON (exit {result.returncode})")
    if result.returncode != 0 or (not payload.get("ok") and not allow_not_ok):
        sys.stderr.write(json.dumps(payload, indent=2)[:4000] + "\n" + result.stderr[-4000:])
        raise SystemExit(f"topview-3d-cli {' '.join(args)}: exit {result.returncode}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("wheel", type=Path)
    parser.add_argument("--workdir", type=Path)
    parser.add_argument("--skip-browser", action="store_true")
    args = parser.parse_args()
    uvx = shutil.which("uvx")
    if not uvx:
        raise SystemExit("error: `uvx` is not on PATH (install uv)")
    wheel = args.wheel.resolve()
    if not wheel.is_file():
        raise SystemExit(f"error: {wheel} does not exist")
    work = args.workdir.resolve() if args.workdir else Path(tempfile.mkdtemp(prefix="topview3d-smoke-"))
    work.mkdir(parents=True, exist_ok=True)
    project = work / "smoke-project"
    shutil.rmtree(project, ignore_errors=True)

    doctor = cli(uvx, wheel, "doctor", "--json", allow_not_ok=True)
    print(f"  runtime: {doctor.get('runtime')}, ok={doctor.get('ok')}")
    if not args.skip_browser:
        cli(uvx, wheel, "browser", "ensure")
        doctor = cli(uvx, wheel, "doctor", "--json")
    cli(uvx, wheel, "project", "init", str(project))
    search = cli(uvx, wheel, "asset", "search", "--kind", "pose", "--limit", "1")
    if not search.get("total", len(search.get("items", []))):
        raise SystemExit("asset search found no built-in poses; builtin-assets are missing from the wheel")
    ops = work / "operations.json"
    ops.write_text(json.dumps(OPERATIONS), encoding="utf-8")
    cli(uvx, wheel, "document", "apply", str(project), str(ops))
    cli(uvx, wheel, "evaluate", str(project))
    if args.skip_browser:
        print("wheel smoke ok (browser steps skipped)")
        return 0
    cli(uvx, wheel, "render", str(project))
    shown = cli(uvx, wheel, "renders", "show", str(project))
    image = Path(shown["path"])
    if not image.is_file() or project.resolve() not in image.resolve().parents:
        raise SystemExit(f"renders show returned {image}, not a PNG inside the project")
    print(f"wheel smoke ok: {image}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

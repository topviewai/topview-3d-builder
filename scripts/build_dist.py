#!/usr/bin/env python3
"""Build the topview-3d-cli wheel and sdist from a checkout (macOS, Linux, Windows).

    python scripts/build_dist.py [--skip-builder-build] [--keep-runtime] [--outdir DIR]

1. builds the builder (`pnpm -C editor --filter @topview/3d-builder build`);
2. stages the renderer, builder files, Draco and built-in assets into
   agent/topview_3d_cli/_runtime/ (editor/packages/director-cli/scripts/stage-runtime.mjs);
3. runs `python -m build` on agent/ (needs the `build` package: pip install build);
4. removes the staged runtime again unless --keep-runtime.

Nothing is published.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agent"
STAGED = AGENT / "topview_3d_cli" / "_runtime"


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command), flush=True)
    return subprocess.run(command, check=True, text=True, **kwargs)


def tool(name: str) -> str:
    found = shutil.which(name)
    if not found:
        sys.exit(f"error: `{name}` is not on PATH")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--skip-builder-build", action="store_true")
    parser.add_argument("--keep-runtime", action="store_true")
    parser.add_argument("--outdir", default=str(ROOT / "dist"))
    args = parser.parse_args()
    try:
        import build  # noqa: F401
    except ImportError:
        sys.exit(f"error: the `build` package is missing; run `{sys.executable} -m pip install build`")

    if not args.skip_builder_build:
        run([tool("pnpm"), "-C", str(ROOT / "editor"), "--filter", "@topview/3d-builder", "build"])
    staged = run([tool("node"), str(ROOT / "editor/packages/director-cli/scripts/stage-runtime.mjs"),
                  str(STAGED), "--assets", str(ROOT / "builtin-assets")], stdout=subprocess.PIPE)
    print(staged.stdout.strip())
    outdir = Path(args.outdir).resolve()
    try:
        run([sys.executable, "-m", "build", "--outdir", str(outdir), str(AGENT)])
    finally:
        if not args.keep_runtime:
            shutil.rmtree(STAGED, ignore_errors=True)
    version = json.loads(staged.stdout.strip().splitlines()[-1])
    for artifact in sorted(outdir.glob("topview_3d_cli-*")):
        print(f"{artifact.name}: {artifact.stat().st_size / 1e6:.2f} MB")
    print(f"builder {version['builderVersion']}, playwright {version['playwrightVersion']} (installed at runtime)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

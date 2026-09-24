#!/usr/bin/env python3
"""Set one version everywhere the plugin and CLI carry it, or check that they agree.

    python3 scripts/set_version.py 0.2.0            # write
    python3 scripts/set_version.py --check          # exit 1 when any source disagrees
    python3 scripts/set_version.py 0.2.0 --root DIR # operate on another checkout (for trial runs)

Sources: ``agent/topview_3d_cli/__init__.py`` (``__version__``; ``agent/pyproject.toml`` reads it
dynamically), the ``version`` field of the three plugin manifests, and every
``topview-3d-cli==X`` / ``topview-3d-cli@X`` pin under ``skills/`` and in ``README.md``. Manifests only get their version
field replaced; nothing else in them is rewritten. No ``package.json`` carries the plugin version
(the editor packages version independently), so none is touched.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
INIT = Path("agent/topview_3d_cli/__init__.py")
INIT_VERSION = re.compile(r'^(__version__\s*=\s*")([^"]*)(")', re.M)
MANIFESTS = (Path(".codex-plugin/plugin.json"), Path(".claude-plugin/plugin.json"), Path(".cursor-plugin/plugin.json"))
MANIFEST_VERSION = re.compile(r'^(\s*"version"\s*:\s*")([^"]*)(")', re.M)
PIN = re.compile(r"(topview-3d-cli(?:==|@))([0-9][0-9A-Za-z.+-]*[0-9A-Za-z])")


def pin_files(root: Path) -> list[Path]:
    files = sorted((root / "skills").rglob("*.md"))
    readme = root / "README.md"
    return files + ([readme] if readme.is_file() else [])


def current_versions(root: Path) -> list[tuple[str, str]]:
    """(source, version) for every place that carries the version."""
    found = []
    match = INIT_VERSION.search((root / INIT).read_text(encoding="utf-8"))
    found.append((str(INIT), match.group(2) if match else "<missing>"))
    for manifest in MANIFESTS:
        path = root / manifest
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            found.append((str(manifest), f"<unreadable: {exc}>"))
            continue
        found.append((str(manifest), str(data.get("version", "<missing>"))))
    for path in pin_files(root):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for pin in PIN.finditer(line):
                found.append((f"{path.relative_to(root)}:{number}", pin.group(2)))
    return found


def check(root: Path) -> list[str]:
    versions = current_versions(root)
    errors = []
    expected = versions[0][1]
    if not SEMVER.match(expected):
        errors.append(f"{versions[0][0]}: {expected!r} is not a semantic version")
    for source, version in versions[1:]:
        if version != expected:
            errors.append(f"{source}: {version!r} != {expected!r} ({versions[0][0]})")
    return errors


def _replace_once(path: Path, pattern: re.Pattern[str], version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = pattern.subn(lambda m: f"{m.group(1)}{version}{m.group(3)}", text, count=1)
    if count != 1:
        raise SystemExit(f"{path}: no version field found")
    path.write_text(updated, encoding="utf-8")


def set_version(root: Path, version: str) -> list[str]:
    if not SEMVER.match(version):
        raise SystemExit(f"{version!r} is not a semantic version (MAJOR.MINOR.PATCH[-pre][+build])")
    changed = []
    _replace_once(root / INIT, INIT_VERSION, version)
    changed.append(str(INIT))
    for manifest in MANIFESTS:
        _replace_once(root / manifest, MANIFEST_VERSION, version)
        changed.append(str(manifest))
    for path in pin_files(root):
        text = path.read_text(encoding="utf-8")
        updated = PIN.sub(lambda m: f"{m.group(1)}{version}", text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(root)))
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("version", nargs="?", help="new version (semver)")
    parser.add_argument("--check", action="store_true", help="only check that every source agrees")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if args.check or not args.version:
        if not args.check:
            parser.error("give a version or --check")
        errors = check(root)
        for error in errors:
            print(f"version mismatch: {error}", file=sys.stderr)
        if not errors:
            print(f"version {current_versions(root)[0][1]} is consistent across {len(current_versions(root))} sources")
        return 1 if errors else 0
    for path in set_version(root, args.version):
        print(f"updated {path}")
    errors = check(root)
    for error in errors:
        print(f"version mismatch after update: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Command line boundary for local Scene3D projects (contract: docs/topview-3d-cli.md)."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, NoReturn

from topview_3d_cli.director_document import SCENE3D_OP_ID, new_scene_operation_id
from topview_3d_cli.director_static import delete_node_operations
from topview_3d_cli.local_assets import asset_catalog, builtin_asset_root, import_asset, public_asset_entry
from topview_3d_cli.local_bom import bom_checkpoint, bom_get
from topview_3d_cli.local_catalog import asset_search, asset_show, pose_catalog
from topview_3d_cli.local_edit import load_spec, node_batch, pose_batch
from topview_3d_cli.local_errors import EXIT_INVALID_INPUT, EXIT_OK, exit_code_for
from topview_3d_cli.local_project import (
    CLI_VERSION,
    LocalProjectError,
    adopt_edit,
    apply_operations,
    init_project,
    open_project,
    project_status,
    validate_project_document,
)
from topview_3d_cli.local_inspect import evaluate, inspect_nodes, inspect_views, parse_frames
from topview_3d_cli.local_read import camera_presets, document_view, renders_list, renders_show
from topview_3d_cli.local_render import render
from topview_3d_cli.local_studio import open_studio
from topview_3d_cli.renderer import node_path
from topview_3d_cli.runtime import PLAYWRIGHT_VERSION, builder_version, node_env, runtime

MIN_NODE = (20, 6)
BUILDER_DIST_FILES = ("evaluate/index.mjs", "engine/index.mjs", "headless/index.mjs", "draco/draco_decoder.wasm")
KINDS = ("character", "prop", "pose", "primitive")
RUNTIME_FILES = ("cli.mjs", "render.mjs", "playwright.mjs", "static/headless.html")
_ERROR_PREFIX = re.compile(r"^([A-Z][A-Z0-9_]+)(?::|$)")


def _load_operations(path: str) -> dict[str, Any]:
    try:
        text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
        value = json.loads(text)
    except FileNotFoundError as exc:
        raise LocalProjectError("OPERATIONS_NOT_FOUND", str(path)) from exc
    except json.JSONDecodeError as exc:
        raise LocalProjectError("OPERATIONS_JSON_INVALID", exc.msg) from exc
    if isinstance(value, list):
        value = {"operations": value}
    if not isinstance(value, dict) or not isinstance(value.get("operations"), list):
        raise LocalProjectError("OPERATIONS_JSON_INVALID", "expected an operation array or {\"operations\": [...]}")
    if value.get("schemaVersion", 2) != 2:
        raise LocalProjectError("OPERATIONS_JSON_INVALID", "schemaVersion must be 2")
    expected = value.get("expectedSceneSequence")
    if expected is not None and (type(expected) is not int or expected < 0):
        raise LocalProjectError("OPERATIONS_JSON_INVALID", "expectedSceneSequence must be a non-negative integer")
    batch_id = value.get("batchId")
    if batch_id is not None and (not isinstance(batch_id, str) or not SCENE3D_OP_ID.match(batch_id)):
        raise LocalProjectError("OPERATIONS_JSON_INVALID", "batchId must match [A-Za-z0-9_-]{1,128}")
    for operation in value["operations"]:
        if isinstance(operation, dict) and "operationId" not in operation:
            operation["operationId"] = new_scene_operation_id("cli")
    return value


def document_apply(directory: str, operations_path: str, *, strict: bool, dry_run: bool) -> dict[str, Any]:
    batch = _load_operations(operations_path)
    return apply_operations(directory, batch["operations"], strict=strict,
                            batch_id=batch.get("batchId") or f"cli_{uuid.uuid4().hex[:10]}", dry_run=dry_run,
                            expected_sequence=batch.get("expectedSceneSequence"))


def node_delete(directory: str, node_id: str, *, dry_run: bool) -> dict[str, Any]:
    """Delete one node plus the clips/fcurves/references that point at it, in one batch."""
    project = open_project(directory)
    try:
        batch, summary = delete_node_operations(project.store.assemble(), node_id)
    except ValueError as exc:
        match = _ERROR_PREFIX.match(str(exc))
        raise LocalProjectError(match.group(1) if match else "INTERNAL_ERROR", str(exc)) from exc
    result = apply_operations(directory, batch["operations"], strict=True, batch_id=batch["batchId"], dry_run=dry_run)
    return {**result, **summary}


def _version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", text)[:3])


def _run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None,
         timeout: int = 30) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(command, cwd=cwd, env=env, check=False, capture_output=True, text=True,
                              timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _check_node() -> dict[str, Any]:
    node = shutil.which("node")
    completed = _run([node, "--version"]) if node else None
    version = completed.stdout.strip() if completed and completed.returncode == 0 else None
    ok = bool(version) and _version_tuple(version) >= MIN_NODE
    check: dict[str, Any] = {"ok": ok, "path": node, "version": version}
    if not ok:
        check["hint"] = "Install Node.js 20.6 or newer (https://nodejs.org/); npm ships with it."
    return check


def doctor() -> dict[str, Any]:
    """Every check has ``ok``; failing checks carry a ``hint``."""
    checks: dict[str, dict[str, Any]] = {}
    python_ok = sys.version_info >= (3, 11)
    checks["python"] = {"ok": python_ok, "version": sys.version.split()[0], "executable": sys.executable}
    if not python_ok:
        checks["python"]["hint"] = "Install Python 3.11 or newer."
    checks["node"] = _check_node()

    try:
        current = runtime()
    except LocalProjectError as exc:
        checks["runtime"] = {"ok": False, "code": exc.code, "error": str(exc),
                             "hint": "Reinstall topview-3d-cli (pip install --force-reinstall topview-3d-cli)."}
        return {"ok": False, "cliVersion": CLI_VERSION, "checks": checks}
    missing = [name for name in RUNTIME_FILES if not (current.director_cli / name).is_file()]
    missing += [f"builder/{name}" for name in BUILDER_DIST_FILES if not (current.builder_dist / name).is_file()]
    checks["runtime"] = {"ok": not missing, "mode": current.mode, "root": str(current.director_cli),
                         "missing": missing}
    try:
        checks["runtime"]["builderVersion"] = builder_version()
    except LocalProjectError as exc:
        checks["runtime"].update(ok=False, error=str(exc))
    if not checks["runtime"]["ok"]:
        checks["runtime"]["hint"] = (
            "Run `pnpm -C editor install --frozen-lockfile` and "
            "`pnpm -C editor --filter @topview/3d-builder build`." if current.mode == "workspace"
            else "Reinstall topview-3d-cli; the package is incomplete.")

    try:
        catalog = asset_catalog()
        counts = {kind: sum(1 for entry in catalog if entry["kind"] == kind) for kind in ("character", "pose", "primitive")}
        checks["assets"] = {"ok": True, "root": str(builtin_asset_root()), "counts": counts}
    except LocalProjectError as exc:
        checks["assets"] = {"ok": False, "code": exc.code, "error": str(exc),
                            "hint": "Reinstall topview-3d-cli, or restore builtin-assets/ in a checkout."}

    playwright = current.playwright_package
    try:
        playwright_version = json.loads(playwright.read_text(encoding="utf-8")).get("version")
    except (OSError, json.JSONDecodeError):
        playwright_version = None
    checks["playwright"] = {"ok": playwright_version == PLAYWRIGHT_VERSION, "path": str(playwright.parent),
                            "version": playwright_version, "expected": PLAYWRIGHT_VERSION}

    chromium: dict[str, Any] = {"ok": False}
    if checks["node"]["ok"] and checks["playwright"]["ok"]:
        script = ("const { loadPlaywright } = await import('./playwright.mjs');"
                  "console.log((await loadPlaywright()).chromium.executablePath())")
        completed = _run([checks["node"]["path"], "--input-type=module", "-e", script],
                         cwd=current.director_cli, env=node_env(current))
        path = completed.stdout.strip() if completed and completed.returncode == 0 else ""
        chromium = {"ok": bool(path) and Path(path).exists(), "executablePath": path or None,
                    "browsersPath": os.environ.get("PLAYWRIGHT_BROWSERS_PATH")}
    for name in ("playwright", "chromium"):
        if name == "chromium":
            checks["chromium"] = chromium
        if not checks[name]["ok"]:
            checks[name]["hint"] = "Run `topview-3d-cli browser ensure`."
    if current.mode == "workspace":
        pnpm = shutil.which("pnpm")
        completed = _run([pnpm, "--version"]) if pnpm else None
        version = completed.stdout.strip() if completed and completed.returncode == 0 else None
        checks["pnpm"] = {"ok": bool(version), "path": pnpm, "version": version}
        if not version:
            checks["pnpm"]["hint"] = "Run `corepack enable pnpm` (ships with Node) or install pnpm 8+."
    return {"ok": all(item["ok"] for item in checks.values()), "cliVersion": CLI_VERSION,
            "runtime": current.mode, "checks": checks}


def browser_ensure(*, with_deps: bool) -> dict[str, Any]:
    """Install the pinned Playwright (packaged mode: into the user cache) and its Chromium."""
    current = runtime()
    node = node_path()
    installed = None
    if current.mode == "packaged":
        try:
            installed = json.loads(current.playwright_package.read_text(encoding="utf-8")).get("version")
        except (OSError, json.JSONDecodeError):
            installed = None
        if installed != PLAYWRIGHT_VERSION:
            npm = shutil.which("npm")
            if not npm:
                raise LocalProjectError("NPM_UNAVAILABLE", "npm is not on PATH; it ships with Node.js")
            current.node_prefix.mkdir(parents=True, exist_ok=True)
            manifest = current.node_prefix / "package.json"
            if not manifest.exists():
                manifest.write_text('{"private": true}\n', encoding="utf-8")
            process = subprocess.run(
                [npm, "install", "--prefix", str(current.node_prefix), "--no-audit", "--no-fund",
                 "--omit=dev", "--save-exact", f"playwright@{PLAYWRIGHT_VERSION}"],
                check=False, capture_output=True, text=True, encoding="utf-8")
            if process.returncode:
                raise LocalProjectError("PLAYWRIGHT_INSTALL_FAILED", (process.stderr or process.stdout).strip()[-2000:])
    args = [node, "cli.mjs", "browser", "ensure", *(["--with-deps"] if with_deps else [])]
    process = subprocess.run(args, cwd=current.director_cli, env=node_env(current), check=False,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    if process.returncode:
        raise LocalProjectError("BROWSER_INSTALL_FAILED", (process.stderr or process.stdout).strip()[-2000:])
    lines = [line for line in process.stdout.splitlines() if line.strip()]
    browser = json.loads(lines[-1]) if lines else {}
    return {"ok": True, "runtime": current.mode, "nodePrefix": str(current.node_prefix),
            "playwright": PLAYWRIGHT_VERSION, "browser": browser}


def pose_apply(directory: str, node_id: str, pose_id: str, *, dry_run: bool) -> dict[str, Any]:
    """Compile a manifest pose onto a character's joint controls (a one-item ``pose batch``)."""
    result = pose_batch(directory, {"items": [{"nodeId": node_id, "poseId": pose_id}]}, dry_run=dry_run)
    pose = result["poses"][0]
    return {**result, "nodeId": node_id, "poseId": pose["poseId"], "pose": pose["pose"]}


def asset_list(directory: str | None, kind: str | None) -> dict[str, Any]:
    paths = open_project(directory).paths if directory else None
    catalog = [public_asset_entry(entry) for entry in asset_catalog(paths)
               if kind is None or entry["kind"] == kind]
    return {"ok": True, "count": len(catalog), "assets": catalog}


def asset_import(args: argparse.Namespace) -> dict[str, Any]:
    if args.builtin:
        root = builtin_asset_root()
    else:
        root = open_project(args.directory).paths.assets
    root.mkdir(parents=True, exist_ok=True)
    entry = import_asset(root, args.file, kind=args.kind, asset_id=args.id, key=args.key, cover=args.cover,
                         name=args.name,
                         category=args.category, tags=args.tag, rig=args.rig,
                         license_name=args.license, source_url=args.source)
    return {"ok": True, "root": str(root), "asset": entry}


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise LocalProjectError("USAGE_INVALID", f"{self.prog}: {message}")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="topview-3d-cli", description="Local Scene3D director projects.")
    parser.add_argument("--version", action="version", version=f"topview-3d-cli {CLI_VERSION}")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)

    def group(name: str, help_text: str):
        return commands.add_parser(name, help=help_text).add_subparsers(
            dest=f"{name}_command", required=True, parser_class=_Parser)

    project = group("project", "create and inspect projects")
    init = project.add_parser("init")
    init.add_argument("directory")
    init.add_argument("--force", action="store_true", help="replace an existing project")
    project.add_parser("status").add_argument("directory")
    adopt = project.add_parser("adopt", help="write a Studio edit back into the project so later commands continue from it")
    adopt.add_argument("directory")
    adopt.add_argument("payload", help="{\"document\"?, \"fcurves\"?} JSON file, or - for stdin")

    document = group("document", "read, validate and edit the director document")
    get = document.add_parser("get", help="the stored document; --summary or --entity for smaller reads")
    get.add_argument("directory")
    get.add_argument("--summary", action="store_true", help="outline without curves or full nodes")
    get.add_argument("--entity", help="one node id, clip id or fcurves__<nodeId>")
    get.add_argument("--type", choices=("node", "clip", "fcurves"), help="entity type (inferred by default)")
    get.add_argument("--include-curves", action="store_true", help="include curve keys for clips/fcurves")
    document.add_parser("validate").add_argument("directory")
    apply = document.add_parser("apply")
    apply.add_argument("directory")
    apply.add_argument("operations", help="operation batch JSON file, or - for stdin")
    apply.add_argument("--strict", action="store_true", help="require expectedEntityVersion like the hosted service")
    apply.add_argument("--dry-run", action="store_true", help="validate and report without writing")

    node = group("node", "node-level edits")
    delete = node.add_parser("delete", help="delete a node and everything that references it")
    delete.add_argument("directory")
    delete.add_argument("node_id")
    delete.add_argument("--dry-run", action="store_true")
    batch = node.add_parser("batch", help="add/update/delete/repeat nodes in one atomic batch")
    batch.add_argument("directory")
    batch.add_argument("spec", help="{\"changes\": [...]} JSON file, or - for stdin")
    batch.add_argument("--dry-run", action="store_true", help="stage and validate without writing")

    evaluate_parser = commands.add_parser("evaluate", help="numerical checks of the scene or of an unsaved plan")
    evaluate_parser.add_argument("directory")
    evaluate_parser.add_argument("plan", nargs="?", help="{\"changes\"|\"operations\": [...]} JSON file, or -")
    evaluate_parser.add_argument("--frames", help="comma-separated frames (default 0)")
    evaluate_parser.add_argument("--camera", help="evaluate through this camera")

    inspect = group("inspect", "mesh measurements and camera views")
    nodes = inspect.add_parser("nodes", help="bounds, grounding and pairwise distance/overlap (Chromium)")
    nodes.add_argument("directory")
    nodes.add_argument("node_ids", nargs="+")
    nodes.add_argument("--frame", type=int, default=0)
    views = inspect.add_parser("views", help="numbers plus renders for cameras; records evidence in the BOM")
    views.add_argument("directory")
    views.add_argument("views", nargs="?", help="views spec JSON file, or -")
    views.add_argument("--camera", action="append", help="camera node id (repeatable; default: every camera)")
    views.add_argument("--frames", help="comma-separated frames, at most 3 (default 0)")
    views.add_argument("--primary", help="primary story camera (must be one of the views)")

    render_command = commands.add_parser("render", help="render frames with the Node renderer")
    render_command.add_argument("directory")
    render_command.add_argument("payload", nargs="?")
    renders = group("renders", "render runs stored in the project")
    renders.add_parser("list").add_argument("directory")
    show = renders.add_parser("show", help="path and sha256 of a contact sheet or frame PNG")
    show.add_argument("directory")
    show.add_argument("run_id", nargs="?", help="default: the latest run")
    show.add_argument("--frame", type=int, help="a single frame instead of the contact sheet")

    camera = group("camera", "camera helpers")
    camera.add_parser("presets", help="camera preset ids for add_camera")

    bom = group("bom", "plan / constraint record (.topview-3d/bom.json)")
    bom.add_parser("get").add_argument("directory")
    checkpoint = bom.add_parser("checkpoint", help="merge a checkpoint patch (compare-and-set)")
    checkpoint.add_argument("directory")
    checkpoint.add_argument("patch", help="checkpoint JSON file, or - for stdin")

    asset = group("asset", "offline asset manifests")
    listing = asset.add_parser("list", help="built-in assets, plus a project's own when given")
    listing.add_argument("directory", nargs="?")
    listing.add_argument("--kind", choices=KINDS)
    search = asset.add_parser("search", help="keyword search with filters and facets")
    search.add_argument("query", nargs="?", default="")
    search.add_argument("--project", dest="directory", help="also search <project>/.topview-3d/assets")
    search.add_argument("--kind", choices=KINDS)
    search.add_argument("--category")
    search.add_argument("--tag", action="append", help="required tag (repeatable)")
    search.add_argument("--rig", choices=("mixamorig", "ual1"))
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--offset", type=int, default=0)
    show_asset = asset.add_parser("show", help="one manifest entry with its local path and usage")
    show_asset.add_argument("asset_id")
    show_asset.add_argument("--project", dest="directory")
    show_asset.add_argument("--kind", choices=KINDS)
    importing = asset.add_parser("import", help="copy a model or pose file into an asset root")
    target = importing.add_mutually_exclusive_group(required=True)
    target.add_argument("--project", dest="directory", help="import into <project>/.topview-3d/assets")
    target.add_argument("--builtin", action="store_true", help="import into the built-in asset root")
    importing.add_argument("file")
    importing.add_argument("--kind", required=True, choices=("character", "prop", "pose"))
    importing.add_argument("--id", required=True)
    importing.add_argument("--key", help="asset key used by documents (metadata.modelUrl)")
    importing.add_argument("--cover", help="cover image (.webp/.png/.jpg)")
    importing.add_argument("--name")
    importing.add_argument("--category")
    importing.add_argument("--tag", action="append")
    importing.add_argument("--rig", choices=("mixamorig", "ual1"))
    importing.add_argument("--license")
    importing.add_argument("--source")

    pose = group("pose", "character poses from the asset manifests")
    catalog = pose.add_parser("catalog", help="every pose with its category and tags")
    catalog.add_argument("--project", dest="directory")
    catalog.add_argument("--category")
    catalog.add_argument("--tag")
    pose_apply_parser = pose.add_parser("apply", help="apply a manifest pose to a character")
    pose_apply_parser.add_argument("directory")
    pose_apply_parser.add_argument("node_id")
    pose_apply_parser.add_argument("pose_id", help="pose asset id (the a3d_pose_ prefix is optional)")
    pose_apply_parser.add_argument("--dry-run", action="store_true")
    pose_batch_parser = pose.add_parser("batch", help="pose several characters in one batch")
    pose_batch_parser.add_argument("directory")
    pose_batch_parser.add_argument("spec", help="{\"items\": [...]} JSON file, or - for stdin")
    pose_batch_parser.add_argument("--dry-run", action="store_true")

    doctor_parser = commands.add_parser("doctor", help="check Python, Node, the renderer runtime and Chromium")
    doctor_parser.add_argument("--json", action="store_true", help="print the JSON report and always exit 0")
    browser = group("browser", "renderer browser setup")
    ensure = browser.add_parser("ensure", help="install the pinned Playwright and Chromium (idempotent)")
    ensure.add_argument("--with-deps", action="store_true", help="also install Linux system packages (sudo)")
    studio = group("studio", "open the local Studio app on this project")
    studio.add_parser("open", help="start Studio with Node if needed and open this project in the browser").add_argument("directory")
    return parser


def command_table() -> dict[str, set[str]]:
    """Every runnable command path (``""`` is the bare program) mapped to its long options."""
    table: dict[str, set[str]] = {}

    def walk(parser: argparse.ArgumentParser, path: tuple[str, ...]) -> None:
        groups = [action for action in parser._actions if isinstance(action, argparse._SubParsersAction)]
        if not groups:
            table[" ".join(path)] = {option for action in parser._actions for option in action.option_strings
                                     if option.startswith("--") and option != "--help"}
        for group in groups:
            for name, child in group.choices.items():
                walk(child, (*path, name))

    root = _parser()
    table[""] = {"--version"}
    walk(root, ())
    return table


def _dispatch(args: argparse.Namespace) -> dict[str, Any]:
    command = args.command
    sub = getattr(args, f"{command}_command", None)
    if command == "doctor":
        return doctor()
    if command == "browser":
        return browser_ensure(with_deps=args.with_deps)
    if command == "studio":
        return open_studio(args.directory)
    if command == "project":
        if sub == "init":
            return init_project(args.directory, force=args.force)
        if sub == "adopt":
            return adopt_edit(args.directory, load_spec(args.payload, "PROJECT_ADOPT_INVALID"))
        return project_status(args.directory)
    if command == "document":
        if sub == "get":
            return document_view(args.directory, summary=args.summary, entity=args.entity,
                                 entity_type=args.type, include_curves=args.include_curves)
        if sub == "validate":
            return validate_project_document(args.directory)
        return document_apply(args.directory, args.operations, strict=args.strict, dry_run=args.dry_run)
    if command == "node":
        if sub == "batch":
            return node_batch(args.directory, args.spec, dry_run=args.dry_run)
        return node_delete(args.directory, args.node_id, dry_run=args.dry_run)
    if command == "evaluate":
        return evaluate(args.directory, args.plan, frames=parse_frames(args.frames), camera=args.camera)
    if command == "inspect":
        if sub == "nodes":
            return inspect_nodes(args.directory, args.node_ids, frame=args.frame)
        frames = parse_frames(args.frames) if args.frames else None
        return inspect_views(args.directory, args.views, cameras=args.camera, frames=frames, primary=args.primary)
    if command == "renders":
        if sub == "list":
            return renders_list(args.directory)
        return renders_show(args.directory, args.run_id, frame=args.frame)
    if command == "camera":
        return camera_presets()
    if command == "bom":
        if sub == "get":
            return bom_get(args.directory)
        return bom_checkpoint(args.directory, load_spec(args.patch, "BOM_CHECKPOINT_INVALID"))
    if command == "asset":
        if sub == "list":
            return asset_list(args.directory, args.kind)
        if sub == "search":
            return asset_search(args.directory, args.query, kind=args.kind, category=args.category,
                                tags=args.tag or [], rig=args.rig, limit=args.limit, offset=args.offset)
        if sub == "show":
            return asset_show(args.directory, args.asset_id, kind=args.kind)
        return asset_import(args)
    if command == "pose":
        if sub == "catalog":
            return pose_catalog(args.directory, category=args.category, tag=args.tag)
        if sub == "batch":
            return pose_batch(args.directory, load_spec(args.spec, "POSE_BATCH_INVALID"), dry_run=args.dry_run)
        return pose_apply(args.directory, args.node_id, args.pose_id, dry_run=args.dry_run)
    return render(args.directory, args.payload)


def _fail(code: str, message: str, details: Any = None) -> int:
    body = {"ok": False, "code": code, "error": message}
    if details is not None:
        body["details"] = details
    print(json.dumps(body, ensure_ascii=False), file=sys.stderr)
    return exit_code_for(code)


def _print_doctor(report: dict[str, Any]) -> None:
    print(f"topview-3d-cli {report['cliVersion']} ({report.get('runtime', 'no')} runtime)")
    for name, check in report["checks"].items():
        detail = check.get("version") or check.get("mode") or check.get("executablePath") or check.get("error") or ""
        print(f"  [{'ok' if check['ok'] else 'FAIL'}] {name} {detail}".rstrip())
        if not check["ok"] and check.get("hint"):
            print(f"         {check['hint']}")
    print("ready" if report["ok"] else "not ready: fix the failing checks above")


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        if args.command == "doctor" and not args.json:
            report = doctor()
            _print_doctor(report)
            return EXIT_OK if report["ok"] else exit_code_for("DOCTOR_FAILED")
        result = _dispatch(args)
    except SystemExit as exc:
        return int(exc.code or 0) if not isinstance(exc.code, str) else EXIT_INVALID_INPUT
    except LocalProjectError as exc:
        return _fail(exc.code, str(exc), exc.details)
    except Exception as exc:  # noqa: BLE001 - every failure must stay machine-readable
        return _fail("INTERNAL_ERROR", f"{type(exc).__name__}: {exc}")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

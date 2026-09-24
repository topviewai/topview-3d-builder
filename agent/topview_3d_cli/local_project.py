"""Local, single-writer Scene3D project storage.

``.topview3d/entities.json`` is the authoritative entity store (see
``director_operations``). ``document.json`` and ``fcurves.json`` are derived views
rewritten on every commit for renderers and humans; editing them has no effect.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from topview_3d_cli import __version__
from topview_3d_cli.director_document import (
    DIRECTOR_DOCUMENT_TYPE,
    empty_director_document,
    normalize_document,
    summarize_director_snapshot,
    validate_director_document,
    validate_fcurves,
)
from topview_3d_cli.director_operations import (
    DirectorConflictError,
    DirectorOperationError,
    DirectorStore,
    genesis_store,
)
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.runtime import builder_version

FORMAT_NAME = "scene3d-local-project"
SCHEMA_VERSION = 2
CLI_VERSION = __version__


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    state: Path
    metadata: Path
    entities: Path
    document: Path
    fcurves: Path
    assets: Path
    renders: Path
    bom: Path


@dataclass
class Project:
    paths: ProjectPaths
    metadata: dict[str, Any]
    store: DirectorStore
    migrated_from: int | None = None


def project_paths(root: str | os.PathLike[str]) -> ProjectPaths:
    directory = Path(root).expanduser().resolve()
    state = directory / ".topview3d"
    return ProjectPaths(
        root=directory,
        state=state,
        metadata=state / "metadata.json",
        entities=state / "entities.json",
        document=state / "document.json",
        fcurves=state / "fcurves.json",
        assets=state / "assets",
        renders=state / "renders",
        bom=state / "bom.json",
    )


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LocalProjectError("PROJECT_NOT_INITIALIZED", f"missing {path}") from exc
    except json.JSONDecodeError as exc:
        raise LocalProjectError("PROJECT_JSON_INVALID", f"{path}: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise LocalProjectError("PROJECT_JSON_INVALID", f"{path} must contain an object")
    return value


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_assembled(assembled: dict[str, Any]) -> None:
    try:
        validate_director_document(assembled["document"])
    except ValueError as exc:
        raise LocalProjectError("INVALID_DIRECTOR_DOCUMENT", str(exc)) from exc
    try:
        validate_fcurves(assembled["fcurves"])
    except ValueError as exc:
        raise LocalProjectError("INVALID_DIRECTOR_FCURVES", str(exc)) from exc


def commit(project: Project) -> dict[str, Any]:
    """Validate the assembled state and persist it; the entity store is written first."""
    assembled = project.store.assemble()
    validate_assembled(assembled)
    metadata = copy.deepcopy(project.metadata)
    metadata.update({
        "format": FORMAT_NAME,
        "schemaVersion": SCHEMA_VERSION,
        "cliVersion": CLI_VERSION,
        "revision": int(project.metadata.get("revision", 0)) + 1,
        "sceneSequence": project.store.scene_sequence,
        "updatedAt": utc_timestamp(),
    })
    atomic_write_json(project.paths.entities, project.store.to_json())
    atomic_write_json(project.paths.document, assembled["document"])
    atomic_write_json(project.paths.fcurves, assembled["fcurves"])
    atomic_write_json(project.paths.metadata, metadata)
    project.metadata = metadata
    project.migrated_from = None
    return metadata


def init_project(root: str | os.PathLike[str], *, force: bool = False) -> dict[str, Any]:
    paths = project_paths(root)
    if paths.state.exists() and not force:
        raise LocalProjectError("PROJECT_EXISTS", f"project already exists at {paths.state}")
    paths.assets.mkdir(parents=True, exist_ok=True)
    paths.renders.mkdir(parents=True, exist_ok=True)
    store = genesis_store(normalize_document(empty_director_document()))
    project = Project(paths, {"builderVersion": builder_version(), "revision": -1}, store)
    metadata = commit(project)
    return {"ok": True, "project": str(paths.root), "metadata": metadata}


def _migrate_v1(paths: ProjectPaths) -> DirectorStore:
    document = _read_json(paths.document)
    animation = ((document.get("content") or {}).get("timeline") or {}).get("animation") or {}
    curves = animation.get("fcurves") if isinstance(animation.get("fcurves"), list) else []
    try:
        return genesis_store(normalize_document(document), {"fcurves": curves})
    except (ValueError, DirectorConflictError) as exc:
        raise LocalProjectError("PROJECT_JSON_INVALID", f"cannot migrate schemaVersion 1 project: {exc}") from exc


def open_project(root: str | os.PathLike[str]) -> Project:
    paths = project_paths(root)
    if not paths.metadata.is_file():
        raise LocalProjectError("PROJECT_NOT_INITIALIZED", f"run `topview-3d-cli project init {paths.root}`")
    metadata = _read_json(paths.metadata)
    version = metadata.get("schemaVersion")
    if version == 1:
        return Project(paths, metadata, _migrate_v1(paths), migrated_from=1)
    if version != SCHEMA_VERSION:
        raise LocalProjectError("PROJECT_FORMAT_UNSUPPORTED", f"schemaVersion {version!r}; this CLI reads {SCHEMA_VERSION}")
    try:
        store = DirectorStore.from_json(_read_json(paths.entities))
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, LocalProjectError):
            raise
        raise LocalProjectError("PROJECT_JSON_INVALID", f"{paths.entities}: {exc}") from exc
    return Project(paths, metadata, store)


def base_result(project: Project) -> dict[str, Any]:
    result = {
        "ok": True,
        "project": str(project.paths.root),
        "revision": project.metadata.get("revision", 0),
        "sceneSequence": project.store.scene_sequence,
    }
    if project.migrated_from is not None:
        result["migrationPending"] = {"fromSchemaVersion": project.migrated_from, "toSchemaVersion": SCHEMA_VERSION}
    return result


def project_status(root: str | os.PathLike[str]) -> dict[str, Any]:
    project = open_project(root)
    assembled = project.store.assemble()
    return {
        **base_result(project),
        "stateDirectory": str(project.paths.state),
        "metadata": project.metadata,
        "document": summarize_director_snapshot(assembled),
        "danglingReferences": project.store.dangling_references(),
    }


def document_get(root: str | os.PathLike[str]) -> dict[str, Any]:
    project = open_project(root)
    assembled = project.store.assemble()
    return {
        **base_result(project),
        "metadata": project.metadata,
        "entityVersions": assembled["entityVersions"],
        "document": assembled["document"],
        "fcurves": assembled["fcurves"],
    }


def validate_project_document(root: str | os.PathLike[str]) -> dict[str, Any]:
    project = open_project(root)
    assembled = project.store.assemble()
    try:
        validate_assembled(assembled)
    except LocalProjectError as exc:
        raise LocalProjectError("DOCUMENT_INVALID", str(exc)) from exc
    dangling = project.store.dangling_references()
    if dangling:
        raise LocalProjectError("DOCUMENT_INVALID", f"{len(dangling)} reference(s) to missing nodes; delete or "
                                "repoint them", details={"danglingReferences": dangling[:50]})
    return {
        **base_result(project),
        "documentType": assembled["document"].get("type", DIRECTOR_DOCUMENT_TYPE),
        "danglingReferences": project.store.dangling_references(),
    }


def _reference_key(issue: dict[str, str]) -> tuple[str, str, str]:
    return issue["entityId"], issue["field"], issue["ref"]


def apply_operations(
    root: str | os.PathLike[str],
    operations: list[Any],
    *,
    strict: bool = False,
    batch_id: str | None = None,
    dry_run: bool = False,
    expected_sequence: int | None = None,
) -> dict[str, Any]:
    project = open_project(root)
    if expected_sequence is not None and expected_sequence != project.store.scene_sequence:
        raise LocalProjectError("SCENE_SEQUENCE_CONFLICT",
                                f"expectedSceneSequence={expected_sequence} but the project is at "
                                f"{project.store.scene_sequence}; re-read and re-plan",
                                details={"expected": expected_sequence, "current": project.store.scene_sequence})
    known = {_reference_key(issue) for issue in project.store.dangling_references()}
    try:
        applied = project.store.apply(operations, strict_versions=strict, batch_id=batch_id)
    except (DirectorOperationError, DirectorConflictError) as exc:
        raise LocalProjectError(exc.code, str(exc)) from exc
    # The shared engine (like the Java service) accepts references to missing nodes; the CLI refuses
    # to write new ones. References that were already dangling do not block unrelated edits.
    created = [issue for issue in project.store.dangling_references() if _reference_key(issue) not in known]
    if created:
        refs = ", ".join(f"{issue['entityId']}.{issue['field']} -> {issue['ref']}" for issue in created[:5])
        raise LocalProjectError("DANGLING_REFERENCE", f"the batch references missing nodes ({refs}); "
                                "nothing was written", details={"danglingReferences": created[:20]})
    if dry_run:
        validate_assembled(project.store.assemble())
    else:
        commit(project)
    return {
        **base_result(project),
        "dryRun": dry_run,
        "strictVersions": strict,
        "operationCount": len(applied["accepted"]),
        "accepted": [{key: value for key, value in item.items() if key != "payload"} for item in applied["accepted"]],
        "warnings": applied["warnings"],
        "entityVersions": project.store.entity_versions(),
    }

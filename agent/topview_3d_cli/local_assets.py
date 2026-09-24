"""Offline asset layer: built-in and project asset manifests.

A manifest (``manifest.json``, format ``scene3d-asset-manifest`` v1) lists assets. File-backed
assets (character, prop, pose) map the asset ``key`` used in director documents
(``metadata.modelUrl``) to a file next to the manifest; primitives are code-generated and carry
their geometry. The renderer only serves files listed here, so nothing is fetched remotely.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import ProjectPaths
from topview_3d_cli.runtime import runtime

MANIFEST_FORMAT = "scene3d-asset-manifest"
MANIFEST_VERSION = 1
MANIFEST_NAME = "manifest.json"
ASSET_KINDS = ("character", "prop", "pose", "primitive")
FILE_KINDS = {"character": (".glb", ".gltf"), "prop": (".glb", ".gltf"), "pose": (".json",)}
COVER_TYPES = (".webp", ".png", ".jpg", ".jpeg")
PRIMITIVE_KINDS = ("BoxGeometry", "SphereGeometry", "CylinderGeometry", "ConeGeometry", "PlaneGeometry")
ASSET_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def builtin_asset_root() -> Path:
    override = os.environ.get("TOPVIEW3D_BUILTIN_ASSETS")
    return Path(override).expanduser().resolve() if override else runtime().builtin_assets


def _invalid(root: Path, message: str) -> LocalProjectError:
    return LocalProjectError("ASSET_MANIFEST_INVALID", f"{root / MANIFEST_NAME}: {message}")


def empty_manifest() -> dict[str, Any]:
    return {"format": MANIFEST_FORMAT, "version": MANIFEST_VERSION, "assets": []}


def asset_key(raw: Any) -> str:
    return str(raw or "").lstrip("/").split("?")[0]


def _inside(root: Path, relative: str) -> Path | None:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        return None
    if any(part in ("..", ".") for part in re.split(r"[\\/]+", relative)):
        return None
    resolved = (root / relative).resolve()
    return resolved if resolved.is_relative_to(root.resolve()) else None


def read_manifest(root: Path) -> dict[str, Any]:
    path = root / MANIFEST_NAME
    if not path.is_file():
        return empty_manifest()
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise _invalid(root, exc.msg) from exc
    if not isinstance(manifest, dict) or manifest.get("format") != MANIFEST_FORMAT:
        raise _invalid(root, f"format must be {MANIFEST_FORMAT!r}")
    if manifest.get("version") != MANIFEST_VERSION:
        raise _invalid(root, f"unsupported version {manifest.get('version')!r}")
    if not isinstance(manifest.get("assets"), list):
        raise _invalid(root, "assets must be a list")
    return manifest


def load_assets(root: Path, origin: str) -> list[dict[str, Any]]:
    """Validated manifest entries with an absolute ``path`` for file-backed assets."""
    entries = []
    seen: set[str] = set()
    for index, raw in enumerate(read_manifest(root)["assets"]):
        where = f"assets[{index}]"
        if not isinstance(raw, dict):
            raise _invalid(root, f"{where} must be an object")
        entry = copy.deepcopy(raw)
        asset_id, kind = entry.get("id"), entry.get("kind")
        if not isinstance(asset_id, str) or not ASSET_ID.match(asset_id) or asset_id in seen:
            raise _invalid(root, f"{where}.id missing, malformed or duplicated")
        seen.add(asset_id)
        if kind not in ASSET_KINDS:
            raise _invalid(root, f"{where}.kind must be one of {', '.join(ASSET_KINDS)}")
        if kind == "primitive":
            primitive = entry.get("primitive")
            if (not isinstance(primitive, dict) or primitive.get("kind") not in PRIMITIVE_KINDS
                    or not isinstance(primitive.get("parameters"), dict)):
                raise _invalid(root, f"{where}.primitive must name a supported geometry with parameters")
        else:
            path = _inside(root, entry.get("file"))
            if path is None:
                raise _invalid(root, f"{where}.file must be a relative path inside the asset root")
            if not path.is_file():
                raise LocalProjectError("ASSET_FILE_MISSING", f"{asset_id}: {path}")
            if isinstance(entry.get("bytes"), int) and path.stat().st_size != entry["bytes"]:
                raise _invalid(root, f"{where}: {path.name} size does not match bytes")
            entry["path"] = str(path)
            if kind in ("character", "prop") and not asset_key(entry.get("key")):
                raise _invalid(root, f"{where}.key is required for {kind} assets")
        if entry.get("cover") is not None:
            cover = _inside(root, entry["cover"])
            if cover is None or not cover.is_file():
                raise _invalid(root, f"{where}.cover must be an existing file inside the asset root")
        entry["origin"] = origin
        entries.append(entry)
    return entries


def asset_catalog(paths: ProjectPaths | None = None) -> list[dict[str, Any]]:
    """Built-in assets, overridden by the project's own assets (same id or key)."""
    catalog = {entry["id"]: entry for entry in load_assets(builtin_asset_root(), "builtin")}
    if paths is not None:
        for entry in load_assets(paths.assets, "project"):
            catalog.pop(entry["id"], None)
            catalog[entry["id"]] = entry
    return list(catalog.values())


def local_asset_map(catalog: list[dict[str, Any]]) -> dict[str, str]:
    """Asset key -> absolute file for the renderer (characters and props)."""
    mapping: dict[str, str] = {}
    for entry in catalog:
        if entry["kind"] in ("character", "prop"):
            mapping[asset_key(entry["key"])] = entry["path"]
    return mapping


def find_asset(catalog: list[dict[str, Any]], kind: str, asset_id: str) -> dict[str, Any]:
    """Look an asset up by id; library poses also match without their ``a3d_pose_`` prefix."""
    candidates = {asset_id, f"a3d_pose_{asset_id}"} if kind == "pose" else {asset_id}
    for entry in catalog:
        if entry["kind"] == kind and entry["id"] in candidates:
            return entry
    raise LocalProjectError("ASSET_NOT_FOUND", f"no {kind} asset {asset_id!r} in the local manifests")


def public_asset_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in entry.items() if key != "path"}


def document_asset_refs(document: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    """Asset references of a director document: required models and optional motions."""
    content = document.get("content") or {}
    required = []
    for node in content.get("nodes") or []:
        if node.get("type") not in ("character", "prop"):
            continue
        metadata = node.get("metadata") or {}
        if node["type"] == "character" and metadata.get("assetSource") == "user" and metadata.get("assetId"):
            required.append({"nodeId": node["id"], "key": f"user:{metadata['assetId']}"})
            continue
        key = asset_key(metadata.get("modelUrl"))
        if key:
            required.append({"nodeId": node["id"], "key": key})
    motion_ids = {clip.get("motion", {}).get("assetId")
                  for clip in ((content.get("timeline") or {}).get("animation") or {}).get("motionClips") or []}
    motions = [{"assetId": entry.get("id"), "key": asset_key(entry.get("path"))}
               for entry in ((content.get("asset") or {}).get("motionPath") or [])
               if entry.get("id") in motion_ids]
    return {"required": required, "motions": motions}


def check_render_assets(document: dict[str, Any], mapping: dict[str, str],
                        public_asset_base: str = "") -> list[str]:
    """Raise ASSET_NOT_AVAILABLE for missing models; return warnings for missing motions."""
    refs = document_asset_refs(document)
    def available(key: str) -> bool:
        return (key in mapping or re.match(r"^https?://", key, re.I) is not None
                or (bool(public_asset_base) and key.startswith("3d-builder/public/")))
    missing = [ref for ref in refs["required"] if not available(ref["key"])]
    if missing:
        raise LocalProjectError(
            "ASSET_NOT_AVAILABLE",
            "models not available offline: " + ", ".join(f"{m['nodeId']} ({m['key']})" for m in missing),
            details={"missing": missing})
    return [f"MOTION_NOT_AVAILABLE:{motion['assetId']}" for motion in refs["motions"]
            if not available(motion["key"])]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_asset(root: Path, source: str | os.PathLike[str], *, kind: str, asset_id: str,
                 key: str | None = None, cover: str | os.PathLike[str] | None = None,
                 name: str | None = None, category: str | None = None,
                 tags: list[str] | None = None, rig: str | None = None,
                 license_name: str | None = None, source_url: str | None = None) -> dict[str, Any]:
    """Copy one file into ``root`` and add or replace its manifest entry."""
    if kind not in FILE_KINDS:
        raise LocalProjectError("ASSET_IMPORT_INVALID", f"kind must be one of {', '.join(FILE_KINDS)}")
    if not ASSET_ID.match(asset_id or ""):
        raise LocalProjectError("ASSET_IMPORT_INVALID", "id must match [A-Za-z0-9_-]{1,128}")
    file = Path(source).expanduser()
    if not file.is_file():
        raise LocalProjectError("ASSET_IMPORT_INVALID", f"{file} is not a file")
    if file.suffix.lower() not in FILE_KINDS[kind]:
        raise LocalProjectError("ASSET_IMPORT_INVALID", f"{kind} files must be {', '.join(FILE_KINDS[kind])}")
    if kind == "pose":
        try:
            pose = json.loads(file.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalProjectError("ASSET_IMPORT_INVALID", f"pose is not JSON: {exc}") from exc
        if not isinstance(pose, dict) or not isinstance(pose.get("bones"), dict):
            raise LocalProjectError("ASSET_IMPORT_INVALID", "pose JSON must contain a bones object")
    manifest = read_manifest(root)
    relative = f"{kind}s/{asset_id}{file.suffix.lower()}"
    entry: dict[str, Any] = {"id": asset_id, "kind": kind, "name": name or asset_id, "file": relative,
                             "bytes": file.stat().st_size, "sha256": _sha256(file)}
    if kind in ("character", "prop"):
        entry["key"] = asset_key(key) or f"local/{relative}"
    elif key:
        entry["key"] = asset_key(key)
    cover_file = Path(cover).expanduser() if cover else None
    if cover_file is not None:
        if not cover_file.is_file() or cover_file.suffix.lower() not in COVER_TYPES:
            raise LocalProjectError("ASSET_IMPORT_INVALID", f"cover must be one of {', '.join(COVER_TYPES)}")
        entry["cover"] = f"covers/{asset_id}{cover_file.suffix.lower()}"
    for field, value in (("category", category), ("tags", tags), ("rig", rig),
                         ("license", license_name), ("source", source_url)):
        if value:
            entry[field] = value
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, target)
    if cover_file is not None:
        (root / "covers").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cover_file, root / entry["cover"])
    manifest["assets"] = [item for item in manifest["assets"] if item.get("id") != asset_id] + [entry]
    descriptor, temporary = tempfile.mkstemp(prefix=".manifest.", suffix=".tmp", dir=root)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.chmod(temporary, 0o644)
    os.replace(temporary, root / MANIFEST_NAME)
    return entry

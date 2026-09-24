"""Offline asset search, asset details and the pose catalog over the local manifests."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from topview_3d_cli.local_assets import ASSET_KINDS, asset_catalog, public_asset_entry
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.local_project import open_project

SEARCH_LIMIT_DEFAULT = 20
SEARCH_LIMIT_MAX = 200
TAG_FACET_LIMIT = 40
POSE_PREFIX = "a3d_pose_"


def _catalog(directory: str | None) -> list[dict[str, Any]]:
    return asset_catalog(open_project(directory).paths if directory else None)


def _root_of(entry: dict[str, Any]) -> Path | None:
    if not entry.get("path") or not entry.get("file"):
        return None
    return Path(entry["path"]).parents[len(Path(entry["file"]).parts) - 1]


def _cover_path(entry: dict[str, Any]) -> str | None:
    root = _root_of(entry)
    return str(root / entry["cover"]) if root and entry.get("cover") else None


def _fold(value: Any) -> str:
    return str(value or "").casefold()


def _score(entry: dict[str, Any], tokens: list[str]) -> int | None:
    """None when a token is missing; otherwise name hits count 3, tag hits 2, other fields 1."""
    name, tags = _fold(entry.get("name")), [_fold(tag) for tag in entry.get("tags") or []]
    other = " ".join(_fold(entry.get(key)) for key in ("id", "category", "description", "rig"))
    score = 0
    for token in tokens:
        if token in name:
            score += 3
        elif any(token == tag for tag in tags):
            score += 2
        elif any(token in tag for tag in tags) or token in other:
            score += 1
        else:
            return None
    return score


def compact_entry(entry: dict[str, Any]) -> dict[str, Any]:
    row = {key: entry[key] for key in ("id", "kind", "name", "category", "tags", "description", "rig", "key",
                                       "license", "origin") if entry.get(key) not in (None, "", [])}
    if entry["kind"] == "pose":
        row["shortId"] = entry["id"].removeprefix(POSE_PREFIX)
    if entry["kind"] == "primitive":
        row["primitive"] = entry["primitive"]
    cover = _cover_path(entry)
    if cover:
        row["coverPath"] = cover
    return row


def _facets(entries: list[dict[str, Any]]) -> dict[str, Any]:
    tags = Counter(tag for entry in entries for tag in entry.get("tags") or [])
    return {
        "kind": dict(Counter(entry["kind"] for entry in entries)),
        "category": dict(Counter(entry.get("category") or "" for entry in entries if entry.get("category"))),
        "rig": dict(Counter(entry["rig"] for entry in entries if entry.get("rig"))),
        "tags": dict(tags.most_common(TAG_FACET_LIMIT)),
    }


def asset_search(directory: str | None, query: str | None = None, *, kind: str | None = None,
                 category: str | None = None, tags: list[str] | None = None, rig: str | None = None,
                 limit: int = SEARCH_LIMIT_DEFAULT, offset: int = 0) -> dict[str, Any]:
    """Keyword search (every word must match) with exact filters; facets cover all matches."""
    if not 1 <= limit <= SEARCH_LIMIT_MAX or offset < 0:
        raise LocalProjectError("USAGE_INVALID", f"--limit must be 1..{SEARCH_LIMIT_MAX} and --offset >= 0")
    tokens = _fold(query).split()
    wanted_tags = {_fold(tag) for tag in tags or []}
    matches = []
    for entry in _catalog(directory):
        if kind and entry["kind"] != kind:
            continue
        if category and _fold(entry.get("category")) != _fold(category):
            continue
        if rig and entry.get("rig") != rig:
            continue
        if not wanted_tags <= {_fold(tag) for tag in entry.get("tags") or []}:
            continue
        score = _score(entry, tokens)
        if score is not None:
            matches.append((score, entry))
    matches.sort(key=lambda item: (-item[0], ASSET_KINDS.index(item[1]["kind"]), _fold(item[1].get("name"))))
    page = matches[offset:offset + limit]
    end = offset + len(page)
    return {
        "ok": True,
        "query": {"text": query or "", "kind": kind, "category": category, "tags": sorted(wanted_tags),
                  "rig": rig, "limit": limit, "offset": offset},
        "total": len(matches),
        "complete": end >= len(matches),
        "nextOffset": None if end >= len(matches) else end,
        "facets": _facets([entry for _, entry in matches]),
        "items": [{**compact_entry(entry), "score": score} for score, entry in page],
    }


def find_any_asset(catalog: list[dict[str, Any]], asset_id: str, kind: str | None = None) -> dict[str, Any]:
    """Look up by exact id (pose ids also without ``a3d_pose_``), optionally restricted to one kind."""
    candidates = [entry for entry in catalog if kind is None or entry["kind"] == kind]
    for wanted in (asset_id, POSE_PREFIX + asset_id):
        found = next((entry for entry in candidates if entry["id"] == wanted), None)
        if found:
            return found
    raise LocalProjectError("ASSET_NOT_FOUND", f"no {kind or 'asset'} {asset_id!r} in the local manifests")


def asset_show(directory: str | None, asset_id: str, *, kind: str | None = None) -> dict[str, Any]:
    entry = find_any_asset(_catalog(directory), asset_id, kind)
    detail: dict[str, Any] = {**public_asset_entry(entry), **compact_entry(entry)}
    if entry.get("path"):
        detail["path"] = entry["path"]
    result: dict[str, Any] = {"ok": True, "asset": detail}
    if entry["kind"] == "pose":
        pose = json.loads(Path(entry["path"]).read_text(encoding="utf-8"))
        bones = pose.get("bones") if isinstance(pose.get("bones"), dict) else {}
        result["pose"] = {"boneCount": len(bones), "hips": pose.get("hips")}
        result["usage"] = {"command": f"topview-3d-cli pose apply <dir> <characterNodeId> {detail['shortId']}",
                           "batchItem": {"nodeId": "<characterNodeId>", "poseId": detail["shortId"]}}
    elif entry["kind"] in ("character", "prop"):
        result["usage"] = {"change": {"action": "add_library", "kind": f"{entry['kind']}s",
                                      "libraryId": entry["id"], "nodeId": "<new node id>"}}
    else:
        result["usage"] = {"change": {"action": "add_primitive", "nodeId": "<new node id>",
                                      "primitive": entry["primitive"]}}
    return result


def pose_catalog(directory: str | None, *, category: str | None = None, tag: str | None = None) -> dict[str, Any]:
    """Every pose (built-in and project), compact and deterministic."""
    poses = [entry for entry in _catalog(directory) if entry["kind"] == "pose"]
    categories = dict(Counter(entry.get("category") or "" for entry in poses))
    if category:
        poses = [entry for entry in poses if _fold(entry.get("category")) == _fold(category)]
    if tag:
        poses = [entry for entry in poses if _fold(tag) in {_fold(item) for item in entry.get("tags") or []}]
    poses.sort(key=lambda entry: (_fold(entry.get("category")), _fold(entry.get("name")), entry["id"]))
    items = [{key: value for key, value in compact_entry(entry).items() if key not in ("kind", "license", "key")}
             for entry in poses]
    return {"ok": True, "total": len(items), "categories": categories, "items": items}

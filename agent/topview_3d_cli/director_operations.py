"""Director operation engine shared by the local CLI and the local agent backend.

State is kept as separate entities, exactly like the live-operation service
(`agent/topview_3d_cli/contracts/director-v1/README.md`):

- ``director``            DIRECTOR_SCENE    document without nodes, clips and fcurves
- ``<nodeId>``            DIRECTOR_NODE     one DraftNode
- ``<clipId>``            DIRECTOR_CLIP     ``{"clipKind": ..., "clip": ...}``
- ``fcurves__<nodeId>``   DIRECTOR_FCURVES  ``{"version": 1, "encoding": "compact-v1", "fcurves": [...]}``

`DirectorStore.assemble()` rebuilds the document plus one merged compact-v1
fcurves object. Every accepted operation advances ``sceneSequence`` by one.

Version rules (``strict_versions``):

- strict (service parity): updating or deleting an existing entity requires
  ``expectedEntityVersion`` equal to its current version; a deleted id can
  never be written again (``ENTITY_DELETED``).
- single-writer: a missing/null ``expectedEntityVersion`` means "overwrite the
  current version"; a supplied value must still match. A deleted id may be
  recreated and continues its version counter.

``baseSequence`` is optional in both modes; when present it must satisfy
``0 <= baseSequence <= sceneSequence`` (``SEQUENCE_GAP``). ``node.delete`` does
not cascade: callers that want referencing clips/fcurves removed must send
those deletes in the same batch (see ``director_static.delete_node_operations``).
Missing parent/children/clip-target references are reported as warnings.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from topview_3d_cli.director_document import (
    DIRECTOR_DOCUMENT_TYPE,
    empty_director_document,
    fcurve_node_id,
    new_scene_operation_id,
    normalize_document,
    normalize_node,
    preserve_node_metadata,
    scene_content_from_payload,
    validate_director_node,
)

DIRECTOR_SCENE = "DIRECTOR_SCENE"
DIRECTOR_NODE = "DIRECTOR_NODE"
DIRECTOR_CLIP = "DIRECTOR_CLIP"
DIRECTOR_FCURVES = "DIRECTOR_FCURVES"
SCENE_ENTITY_ID = "director"
FCURVES_ENCODING = "compact-v1"
MAX_BATCH_OPERATIONS = 64
PUBLIC_KINDS = frozenset({
    "director.scene.set", "director.node.upsert", "director.node.delete",
    "director.clip.upsert", "director.clip.delete",
    "director.fcurves.set", "director.fcurves.delete",
})
CLIP_ARRAYS = {
    "cameraMotion": "cameraMotionClips",
    "motion": "motionClips",
    "pathMotion": "pathMotionClips",
}
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_KIND = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_FCURVES_ENTITY = re.compile(r"^fcurves__[A-Za-z0-9_-]+$")


class DirectorOperationError(ValueError):
    """The operation or batch is malformed; nothing was applied."""

    def __init__(self, code: str, detail: str | None = None):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}:{detail}" if detail else code)


class DirectorConflictError(RuntimeError):
    """The operation is well formed but conflicts with current state; nothing was applied."""

    def __init__(self, code: str, detail: str | None = None):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}:{detail}" if detail else code)


@dataclass
class Entity:
    entity_type: str
    version: int
    state: dict[str, Any] | None
    order: int
    created_sequence: int
    updated_sequence: int
    deleted_sequence: int | None = None

    @property
    def live(self) -> bool:
        return self.deleted_sequence is None

    def to_json(self) -> dict[str, Any]:
        return {
            "entityType": self.entity_type,
            "entityVersion": self.version,
            "state": self.state,
            "order": self.order,
            "createdSequence": self.created_sequence,
            "updatedSequence": self.updated_sequence,
            "deletedSequence": self.deleted_sequence,
        }

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "Entity":
        return cls(
            entity_type=str(raw["entityType"]),
            version=int(raw["entityVersion"]),
            state=raw.get("state"),
            order=int(raw.get("order", 0)),
            created_sequence=int(raw.get("createdSequence", 0)),
            updated_sequence=int(raw.get("updatedSequence", 0)),
            deleted_sequence=raw.get("deletedSequence"),
        )


def empty_fcurves() -> dict[str, Any]:
    return {"version": 1, "encoding": FCURVES_ENCODING, "fcurves": []}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_exact_fields(value: dict[str, Any], required: Iterable[str], what: str) -> None:
    expected = set(required)
    if set(value) != expected:
        raise DirectorOperationError(
            "INVALID_DIRECTOR_PAYLOAD", f"{what} must have exactly {sorted(expected)}, got {sorted(value)}")


def _operation_hash(operation: dict[str, Any]) -> str:
    body = {key: value for key, value in operation.items() if key != "toolCallId"}
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def wrap_scene_set(scene: Any) -> dict[str, Any]:
    try:
        incoming = scene_content_from_payload(scene)
    except ValueError as exc:
        raise DirectorOperationError("INVALID_DIRECTOR_SCENE", str(exc)) from exc
    incoming.setdefault("version", 1)
    wrapped: dict[str, Any] = {
        "type": scene["type"] if isinstance(scene.get("type"), str) else DIRECTOR_DOCUMENT_TYPE,
        "content": incoming,
    }
    if "pippitAssetId" in scene:
        wrapped["pippitAssetId"] = scene["pippitAssetId"]
    if "extra" in scene:
        wrapped["extra"] = copy.deepcopy(scene["extra"])
    return wrapped


def merge_scene_set(current: dict[str, Any] | None, scene: Any) -> dict[str, Any]:
    """Shallow-merge ``scene.content`` fields into the stored scene entity."""
    wrapped = wrap_scene_set(scene)
    merged = copy.deepcopy(current) if isinstance(current, dict) else empty_director_document()
    merged["type"] = wrapped["type"]
    for key in ("pippitAssetId", "extra"):
        if key in wrapped:
            merged[key] = copy.deepcopy(wrapped[key])
    content = merged.get("content") if isinstance(merged.get("content"), dict) else {}
    for key, value in wrapped["content"].items():
        if key != "nodes":
            content[key] = copy.deepcopy(value)
    content.pop("nodes", None)
    merged["content"] = content
    try:
        normalized = normalize_document(merged)
    except ValueError as exc:
        raise DirectorOperationError("INVALID_DIRECTOR_SCENE", str(exc)) from exc
    normalized["content"].pop("nodes", None)
    animation = normalized["content"].get("timeline", {}).get("animation")
    if isinstance(animation, dict):
        for key in (*CLIP_ARRAYS.values(), "fcurves"):
            animation.pop(key, None)
    return normalized


def _require_xyz(value: Any, field_name: str) -> None:
    if not isinstance(value, dict) or set(value) != {"x", "y", "z"}:
        raise DirectorOperationError("INVALID_DIRECTOR_TRANSFORM", field_name)
    for axis in ("x", "y", "z"):
        number = value[axis]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
            raise DirectorOperationError("INVALID_DIRECTOR_TRANSFORM", f"{field_name}.{axis}")


def _require_transform(transform: Any) -> None:
    if not isinstance(transform, dict) or set(transform) != {"position", "rotation", "scale"}:
        raise DirectorOperationError("INVALID_DIRECTOR_TRANSFORM", "transform")
    for key in ("position", "rotation", "scale"):
        _require_xyz(transform[key], key)


def _clip_frame_sort_key(state: dict[str, Any]) -> tuple[int, str]:
    clip = state.get("clip") if isinstance(state.get("clip"), dict) else {}
    start = clip.get("frameStart")
    frame = int(start) if isinstance(start, (int, float)) and not isinstance(start, bool) else 0
    return frame, str(clip.get("id") or "")


def split_document(document: Any, fcurves: Any) -> tuple[
        dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Split an assembled document + fcurves into scene, nodes, clip states and fcurve states."""
    scene = None
    nodes: list[dict[str, Any]] = []
    clips: list[dict[str, Any]] = []
    if isinstance(document, dict):
        scene = copy.deepcopy(document)
        content = scene.get("content")
        if isinstance(content, dict):
            for node in content.pop("nodes", None) or []:
                if isinstance(node, dict):
                    nodes.append(copy.deepcopy(node))
            timeline = content.get("timeline") if isinstance(content.get("timeline"), dict) else None
            animation = timeline.get("animation") if timeline and isinstance(timeline.get("animation"), dict) else None
            if animation is not None:
                for clip_kind, key in CLIP_ARRAYS.items():
                    for clip in animation.pop(key, None) or []:
                        if isinstance(clip, dict):
                            clips.append({"clipKind": clip_kind, "clip": copy.deepcopy(clip)})
                animation["fcurves"] = []
    return scene, nodes, clips, split_fcurves(fcurves)


def split_fcurves(fcurves: Any) -> list[dict[str, Any]]:
    """Group a merged compact-v1 fcurves object into per-node entity states."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    curves = fcurves.get("fcurves") if isinstance(fcurves, dict) else None
    for curve in curves if isinstance(curves, list) else []:
        node_id = fcurve_node_id(curve)
        if node_id is None:
            raise DirectorOperationError("INVALID_DIRECTOR_FCURVES", "fcurve target required")
        grouped.setdefault(node_id, []).append(copy.deepcopy(curve))
    return [{"version": 1, "encoding": FCURVES_ENCODING, "fcurves": items} for items in grouped.values()]


def fcurves_entity_id(state: dict[str, Any]) -> str | None:
    curves = state.get("fcurves") if isinstance(state, dict) else None
    node_id = fcurve_node_id(curves[0]) if isinstance(curves, list) and curves else None
    return f"fcurves__{node_id}" if node_id else None


@dataclass
class DirectorStore:
    entities: dict[str, Entity] = field(default_factory=dict)
    scene_sequence: int = 0
    next_order: int = 0
    operations: dict[str, dict[str, Any]] = field(default_factory=dict)

    # --- persistence -------------------------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        return {
            "sceneSequence": self.scene_sequence,
            "nextOrder": self.next_order,
            "entities": {entity_id: entity.to_json() for entity_id, entity in self.entities.items()},
            "operations": copy.deepcopy(self.operations),
        }

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "DirectorStore":
        entities = {str(key): Entity.from_json(value) for key, value in (raw.get("entities") or {}).items()}
        return cls(
            entities=entities,
            scene_sequence=int(raw.get("sceneSequence", 0)),
            next_order=int(raw.get("nextOrder", len(entities))),
            operations=copy.deepcopy(raw.get("operations") or {}),
        )

    @classmethod
    def from_snapshot(
        cls,
        document: Any,
        fcurves: Any = None,
        *,
        scene_sequence: int = 0,
        entity_versions: dict[str, Any] | None = None,
    ) -> "DirectorStore":
        """Load an assembled snapshot without replaying operations (versions default to 1)."""
        versions = entity_versions or {}
        store = cls(scene_sequence=scene_sequence)
        scene, nodes, clips, curve_states = split_document(document, None)
        curve_states += _legacy_fcurve_states(fcurves) if _is_entity_keyed(fcurves) else split_fcurves(fcurves)

        def add(entity_id: str | None, entity_type: str, state: dict[str, Any]) -> None:
            if not entity_id:
                return
            store.entities[entity_id] = Entity(
                entity_type=entity_type, version=int(versions.get(entity_id) or 1), state=state,
                order=store.next_order, created_sequence=0, updated_sequence=0)
            store.next_order += 1

        if scene is not None:
            add(SCENE_ENTITY_ID, DIRECTOR_SCENE, scene)
        for node in nodes:
            add(str(node.get("id") or ""), DIRECTOR_NODE, node)
        for clip in clips:
            add(str(clip["clip"].get("id") or ""), DIRECTOR_CLIP, clip)
        for state in curve_states:
            add(state.pop("__entityId", None) or fcurves_entity_id(state), DIRECTOR_FCURVES, state)
        return store

    # --- reads ------------------------------------------------------------------------

    def _live(self, entity_type: str | None = None) -> list[tuple[str, Entity]]:
        items = [
            (entity_id, entity) for entity_id, entity in self.entities.items()
            if entity.live and (entity_type is None or entity.entity_type == entity_type)
        ]
        return sorted(items, key=lambda item: (item[1].order, item[0]))

    def entity_versions(self) -> dict[str, int]:
        return {entity_id: entity.version for entity_id, entity in self._live()}

    def assemble(self) -> dict[str, Any]:
        scene_entity = self.entities.get(SCENE_ENTITY_ID)
        document = copy.deepcopy(scene_entity.state) if scene_entity and scene_entity.live and scene_entity.state else {}
        content = document.setdefault("content", {})
        content["nodes"] = [copy.deepcopy(entity.state) for _, entity in self._live(DIRECTOR_NODE)]
        timeline = content.get("timeline") if isinstance(content.get("timeline"), dict) else content.setdefault("timeline", {})
        animation = timeline.get("animation") if isinstance(timeline.get("animation"), dict) else timeline.setdefault("animation", {})
        animation["fcurves"] = []
        clip_states = [entity.state for _, entity in self._live(DIRECTOR_CLIP)]
        for clip_kind, key in CLIP_ARRAYS.items():
            matching = [state for state in clip_states if state.get("clipKind") == clip_kind]
            animation[key] = [copy.deepcopy(state["clip"]) for state in sorted(matching, key=_clip_frame_sort_key)]
        merged = empty_fcurves()
        for _, entity in self._live(DIRECTOR_FCURVES):
            merged["fcurves"].extend(copy.deepcopy((entity.state or {}).get("fcurves") or []))
        return {
            "document": document,
            "fcurves": merged,
            "sceneSequence": self.scene_sequence,
            "entityVersions": self.entity_versions(),
        }

    def dangling_references(self) -> list[dict[str, str]]:
        live_nodes = {entity_id for entity_id, _ in self._live(DIRECTOR_NODE)}
        issues = []
        for entity_id, entity in self._live(DIRECTOR_NODE):
            issues += [{"entityId": entity_id, "field": name, "ref": ref}
                       for name, ref in _node_refs(entity.state) if ref not in live_nodes]
        for entity_id, entity in self._live(DIRECTOR_CLIP):
            ref = _clip_target(entity.state)
            if ref and ref not in live_nodes:
                issues.append({"entityId": entity_id, "field": "target.nodeId", "ref": ref})
        for entity_id, _ in self._live(DIRECTOR_FCURVES):
            node_id = entity_id.removeprefix("fcurves__")
            if node_id not in live_nodes:
                issues.append({"entityId": entity_id, "field": "entityId", "ref": node_id})
        return issues

    # --- writes -----------------------------------------------------------------------

    def apply(
        self,
        operations: Any,
        *,
        strict_versions: bool,
        batch_id: str | None = None,
    ) -> dict[str, Any]:
        """Apply one batch atomically; the store is untouched when any operation fails."""
        if not isinstance(operations, list) or not 1 <= len(operations) <= MAX_BATCH_OPERATIONS:
            raise DirectorOperationError(
                "INVALID_DIRECTOR_BATCH", f"operations must be a list of 1..{MAX_BATCH_OPERATIONS} items")
        work = copy.deepcopy(self)
        accepted: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        for index, operation in enumerate(operations):
            try:
                accepted.append(work._accept(operation, strict_versions, batch_id, warnings))
            except (DirectorOperationError, DirectorConflictError) as exc:
                exc.detail = f"operations[{index}]" + (f": {exc.detail}" if exc.detail else "")
                exc.args = (f"{exc.code}:{exc.detail}",)
                raise
        self.entities, self.scene_sequence = work.entities, work.scene_sequence
        self.next_order, self.operations = work.next_order, work.operations
        return {"sceneSequence": self.scene_sequence, "accepted": accepted, "warnings": warnings}

    def _accept(
        self, operation: Any, strict: bool, batch_id: str | None, warnings: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not isinstance(operation, dict):
            raise DirectorOperationError("INVALID_DIRECTOR_OPERATION", "operation must be an object")
        operation_id = operation.get("operationId")
        if not isinstance(operation_id, str) or not _ID.match(operation_id):
            raise DirectorOperationError("INVALID_OPERATION_ID", "operationId must match [A-Za-z0-9_-]{1,128}")
        kind = operation.get("kind")
        if not isinstance(kind, str) or not _KIND.match(kind) or kind not in PUBLIC_KINDS:
            raise DirectorOperationError("UNSUPPORTED_DIRECTOR_KIND", str(kind))
        payload = operation.get("payload")
        if not isinstance(payload, dict):
            raise DirectorOperationError("INVALID_DIRECTOR_PAYLOAD", "payload must be an object")
        digest = _operation_hash(operation)
        prior = self.operations.get(operation_id)
        if prior is not None:
            if prior["sha256"] != digest:
                raise DirectorConflictError("OPERATION_KEY_REUSED", operation_id)
            return {**copy.deepcopy(prior["record"]), "replayed": True}
        base = operation.get("baseSequence")
        if base is None:
            base = self.scene_sequence
        elif not _is_int(base):
            raise DirectorOperationError("INVALID_DIRECTOR_OPERATION", "baseSequence must be an integer")
        if base < 0 or base > self.scene_sequence:
            raise DirectorConflictError("SEQUENCE_GAP", f"baseSequence {base} > sceneSequence {self.scene_sequence}")
        entity_id = operation.get("entityId")
        if entity_id in (None, ""):
            raise DirectorOperationError("INVALID_ENTITY_ID", "entityId required")
        if not isinstance(entity_id, str) or not _ID.match(entity_id):
            raise DirectorOperationError("INVALID_ENTITY_ID", str(entity_id))
        expected = operation.get("expectedEntityVersion")
        if expected is not None and not _is_int(expected):
            raise DirectorOperationError("INVALID_DIRECTOR_OPERATION", "expectedEntityVersion must be an integer or null")

        payload = copy.deepcopy(payload)
        entity = self.entities.get(entity_id)
        if kind == "director.scene.set":
            entity_type, state = DIRECTOR_SCENE, self._scene_state(entity_id, payload, entity)
        elif kind == "director.node.upsert":
            entity_type, state = DIRECTOR_NODE, self._node_state(entity_id, payload, entity, warnings)
        elif kind == "director.clip.upsert":
            entity_type, state = DIRECTOR_CLIP, self._clip_state(entity_id, payload, warnings)
        elif kind == "director.fcurves.set":
            entity_type, state = DIRECTOR_FCURVES, self._fcurves_state(entity_id, payload)
        else:
            entity_type = {"director.node.delete": DIRECTOR_NODE, "director.clip.delete": DIRECTOR_CLIP,
                           "director.fcurves.delete": DIRECTOR_FCURVES}[kind]
            _require_exact_fields(payload, (), kind)
            state = None

        sequence = self.scene_sequence + 1
        if state is None:
            version_after = self._delete(entity_id, entity_type, entity, expected, strict, sequence)
        else:
            version_after = self._upsert(entity_id, entity_type, entity, expected, strict, sequence, state)
        self.scene_sequence = sequence
        record = {
            "sequence": sequence,
            "operationId": operation_id,
            "batchId": batch_id,
            "baseSequence": base,
            "kind": kind,
            "entityId": entity_id,
            "expectedEntityVersion": expected,
            "entityVersionAfter": version_after,
            "status": "accepted",
        }
        self.operations[operation_id] = {"sha256": digest, "record": record}
        return {**record, "payload": payload}

    def _upsert(self, entity_id: str, entity_type: str, entity: Entity | None, expected: int | None,
                strict: bool, sequence: int, state: dict[str, Any]) -> int:
        if entity is None:
            if expected is not None:
                raise DirectorConflictError("ENTITY_VERSION_CONFLICT", f"{entity_id} does not exist")
            self.entities[entity_id] = Entity(entity_type, 1, state, self.next_order, sequence, sequence)
            self.next_order += 1
            return 1
        if not entity.live:
            if strict:
                raise DirectorConflictError("ENTITY_DELETED", entity_id)
            if expected is not None and expected != entity.version:
                raise DirectorConflictError("ENTITY_VERSION_CONFLICT", f"{entity_id} is at {entity.version}")
            self.entities[entity_id] = Entity(
                entity_type, entity.version + 1, state, self.next_order, sequence, sequence)
            self.next_order += 1
            return entity.version + 1
        if entity.entity_type != entity_type:
            raise DirectorConflictError("ENTITY_TYPE_CONFLICT", f"{entity_id} is {entity.entity_type}")
        self._check_version(entity_id, entity, expected, strict)
        entity.state = state
        entity.version += 1
        entity.updated_sequence = sequence
        return entity.version

    def _delete(self, entity_id: str, entity_type: str, entity: Entity | None, expected: int | None,
                strict: bool, sequence: int) -> int:
        if entity is None:
            raise DirectorConflictError("ENTITY_NOT_FOUND", entity_id)
        if not entity.live:
            raise DirectorConflictError("ENTITY_DELETED", entity_id)
        if entity.entity_type != entity_type:
            raise DirectorConflictError("ENTITY_TYPE_CONFLICT", f"{entity_id} is {entity.entity_type}")
        self._check_version(entity_id, entity, expected, strict)
        entity.version += 1
        entity.state = None
        entity.updated_sequence = sequence
        entity.deleted_sequence = sequence
        return entity.version

    @staticmethod
    def _check_version(entity_id: str, entity: Entity, expected: int | None, strict: bool) -> None:
        if expected is None and not strict:
            return
        if expected is None or expected != entity.version or expected < 1:
            raise DirectorConflictError(
                "ENTITY_VERSION_CONFLICT", f"{entity_id} is at {entity.version}, expected {expected}")

    def _scene_state(self, entity_id: str, payload: dict[str, Any], entity: Entity | None) -> dict[str, Any]:
        if entity_id != SCENE_ENTITY_ID:
            raise DirectorOperationError("INVALID_DIRECTOR_SCENE", "scene.set requires entityId 'director'")
        _require_exact_fields(payload, ("scene",), "director.scene.set payload")
        if not isinstance(payload["scene"], dict):
            raise DirectorOperationError("INVALID_DIRECTOR_SCENE", "scene must be an object")
        current = entity.state if entity is not None and entity.live else None
        merged = merge_scene_set(current, payload["scene"])
        if merged.get("type") != DIRECTOR_DOCUMENT_TYPE or merged["content"].get("version") != 1:
            raise DirectorOperationError("INVALID_DIRECTOR_SCENE", "type and content.version must be director v1")
        payload["scene"] = merged
        return copy.deepcopy(merged)

    def _node_state(self, entity_id: str, payload: dict[str, Any], entity: Entity | None,
                    warnings: list[dict[str, Any]]) -> dict[str, Any]:
        _require_exact_fields(payload, ("node",), "director.node.upsert payload")
        try:
            node = normalize_node(payload["node"])
            if entity is not None and isinstance(entity.state, dict):
                preserve_node_metadata(node, entity.state)
            validate_director_node(node)
        except ValueError as exc:
            raise DirectorOperationError("INVALID_DIRECTOR_NODE", str(exc)) from exc
        if node["id"] != entity_id:
            raise DirectorOperationError("INVALID_DIRECTOR_NODE", f"node.id {node['id']} != entityId {entity_id}")
        _require_transform(node.get("transform"))
        for name, ref in _node_refs(node):
            self._warn_missing(ref, entity_id, name, warnings)
        payload["node"] = node
        return copy.deepcopy(node)

    def _clip_state(self, entity_id: str, payload: dict[str, Any],
                    warnings: list[dict[str, Any]]) -> dict[str, Any]:
        _require_exact_fields(payload, ("clipKind", "clip"), "director.clip.upsert payload")
        clip_kind, clip = payload["clipKind"], payload["clip"]
        if clip_kind not in CLIP_ARRAYS:
            raise DirectorOperationError("INVALID_DIRECTOR_CLIP", f"clipKind {clip_kind!r}")
        if not isinstance(clip, dict) or clip.get("id") != entity_id:
            raise DirectorOperationError("INVALID_DIRECTOR_CLIP", "clip.id must equal entityId")
        if "frameStart" in clip or "frameEnd" in clip:
            start, end = clip.get("frameStart"), clip.get("frameEnd")
            numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (start, end))
            if not numeric or start > end:
                raise DirectorOperationError("INVALID_DIRECTOR_CLIP", "frameStart/frameEnd must be numbers with start <= end")
        motion = clip.get("motion") if isinstance(clip.get("motion"), dict) else {}
        if clip_kind == "cameraMotion" and not isinstance(motion.get("curves"), list):
            raise DirectorOperationError("INVALID_DIRECTOR_CLIP", "motion.curves required; use bake_camera_motion")
        target = _clip_target({"clip": clip})
        if target:
            self._warn_missing(target, entity_id, "target.nodeId", warnings)
        return {"clipKind": clip_kind, "clip": copy.deepcopy(clip)}

    @staticmethod
    def _fcurves_state(entity_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not _FCURVES_ENTITY.match(entity_id):
            raise DirectorOperationError("INVALID_ENTITY_ID", "fcurves entityId must be fcurves__<nodeId>")
        _require_exact_fields(payload, ("version", "encoding", "fcurves"), "director.fcurves.set payload")
        if (not _is_int(payload["version"]) or payload["version"] != 1
                or payload["encoding"] != FCURVES_ENCODING or not isinstance(payload["fcurves"], list)):
            raise DirectorOperationError("INVALID_DIRECTOR_FCURVES", "expected version 1, encoding compact-v1, fcurves array")
        return copy.deepcopy(payload)

    def _warn_missing(self, ref: str, entity_id: str, field_name: str, warnings: list[dict[str, Any]]) -> None:
        target = self.entities.get(ref)
        if target is None or not target.live:
            warnings.append({"code": "DIRECTOR_REFERENCE_MISSING", "entityId": entity_id,
                             "field": field_name, "ref": ref})


def _node_refs(node: Any) -> list[tuple[str, str]]:
    if not isinstance(node, dict):
        return []
    refs = []
    parent = node.get("parentId")
    if isinstance(parent, str) and parent.strip():
        refs.append(("parentId", parent))
    for child in node.get("children") or []:
        if isinstance(child, str) and child.strip():
            refs.append(("children", child))
    return refs


def _clip_target(state: Any) -> str | None:
    clip = state.get("clip") if isinstance(state, dict) else None
    target = clip.get("target") if isinstance(clip, dict) and isinstance(clip.get("target"), dict) else {}
    node_id = target.get("nodeId")
    return node_id if isinstance(node_id, str) and node_id.strip() else None


def _is_entity_keyed(fcurves: Any) -> bool:
    return isinstance(fcurves, dict) and "fcurves" not in fcurves and any(
        isinstance(key, str) and key.startswith("fcurves__") for key in fcurves)


def _legacy_fcurve_states(fcurves: dict[str, Any]) -> list[dict[str, Any]]:
    states = []
    for entity_id, value in fcurves.items():
        if not _FCURVES_ENTITY.match(str(entity_id)):
            continue
        curves = value.get("fcurves") if isinstance(value, dict) else None
        states.append({"__entityId": entity_id, "version": 1, "encoding": FCURVES_ENCODING,
                       "fcurves": copy.deepcopy(curves) if isinstance(curves, list) else []})
    return states


def diff_operations(
    current: dict[str, Any],
    document: Any,
    fcurves: Any,
    base_entity_versions: dict[str, Any] | None = None,
    *,
    stem: str = "dop",
) -> list[dict[str, Any]]:
    """Operations turning assembled ``current`` into ``document`` + ``fcurves`` (service put semantics)."""
    versions = base_entity_versions or {}
    old_scene, old_nodes, old_clips, old_curves = split_document(current.get("document"), current.get("fcurves"))
    new_scene, new_nodes, new_clips, new_curves = split_document(document, fcurves)
    operations: list[dict[str, Any]] = []

    def add(kind: str, entity_id: str, payload: dict[str, Any]) -> None:
        expected = versions.get(entity_id)
        operations.append({
            "operationId": new_scene_operation_id(stem),
            "kind": kind,
            "entityId": entity_id,
            "expectedEntityVersion": expected if _is_int(expected) else None,
            "payload": payload,
        })

    if (old_scene or None) != (new_scene or None):
        add("director.scene.set", SCENE_ENTITY_ID, {"scene": copy.deepcopy(new_scene or {})})
    old_node_index = {str(node.get("id")): node for node in old_nodes}
    new_node_index = {str(node.get("id")): node for node in new_nodes}
    for node_id, node in new_node_index.items():
        if old_node_index.get(node_id) != node:
            add("director.node.upsert", node_id, {"node": copy.deepcopy(node)})
    old_clip_index = {str(state["clip"].get("id")): state for state in old_clips}
    new_clip_index = {str(state["clip"].get("id")): state for state in new_clips}
    for clip_id, state in new_clip_index.items():
        if old_clip_index.get(clip_id) != state:
            add("director.clip.upsert", clip_id, copy.deepcopy(state))
    old_curve_index = {fcurves_entity_id(state): state for state in old_curves}
    new_curve_index = {fcurves_entity_id(state): state for state in new_curves}
    for curve_id, state in new_curve_index.items():
        if curve_id and old_curve_index.get(curve_id) != state:
            add("director.fcurves.set", curve_id, copy.deepcopy(state))
    for curve_id in old_curve_index:
        if curve_id and curve_id not in new_curve_index:
            add("director.fcurves.delete", curve_id, {})
    for clip_id in old_clip_index:
        if clip_id not in new_clip_index:
            add("director.clip.delete", clip_id, {})
    for node_id in old_node_index:
        if node_id not in new_node_index:
            add("director.node.delete", node_id, {})
    return operations


def genesis_store(document: Any, fcurves: Any = None) -> DirectorStore:
    """New store whose entities come from ``document`` via accepted operations (service genesis)."""
    store = DirectorStore()
    operations = diff_operations(store.assemble() | {"document": None}, document, fcurves, stem="gen")
    for start in range(0, len(operations), MAX_BATCH_OPERATIONS):
        store.apply(operations[start:start + MAX_BATCH_OPERATIONS], strict_versions=True, batch_id="genesis")
    return store

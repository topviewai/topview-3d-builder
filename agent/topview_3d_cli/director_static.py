"""Stored-document helpers for static tools; never accept a caller's replacement scene."""
from __future__ import annotations

import copy
import math

from topview_3d_cli.director_document import fcurve_node_id, new_scene_operation_id


def node_in(document: dict, node_id: str) -> dict:
    node = next((n for n in document['content']['nodes'] if n['id'] == node_id), None)
    if node is None:
        raise ValueError(f'DIRECTOR_NODE_NOT_FOUND:{node_id}')
    return node


def camera_view(body: dict, camera_id: str | None) -> dict:
    if camera_id:
        camera = node_in(body['document'], camera_id)
        if camera.get('type') != 'camera':
            raise ValueError('DIRECTOR_CAMERA_REQUIRED')
        body['document']['content']['activeShotCameraNodeId'] = camera_id
        body['cameraNodeId'] = camera_id
    return body


def _detach_subject(camera: dict, subject: dict):
    binding = camera['camera'].pop('subject')
    if not binding.get('follow'):
        return
    rotation = subject['transform']['rotation']
    yaw = math.atan2(math.sin(math.radians(rotation['y'])),
                     math.cos(math.radians(rotation['x'])) * math.cos(math.radians(rotation['y']))) \
        if binding.get('followRotation') else 0
    position = subject['transform']['position']
    def world(offset):
        return {'x': position['x'] + offset['x'] * math.cos(yaw) + offset['z'] * math.sin(yaw),
                'y': position['y'] + offset['y'],
                'z': position['z'] - offset['x'] * math.sin(yaw) + offset['z'] * math.cos(yaw)}
    camera['transform']['position'] = world(binding['offset'])
    camera['camera']['lookAt'] = world(binding['lookAtOffset'])


def delete_node_operations(snapshot: dict, node_id: str) -> tuple[dict, dict]:
    document = snapshot['document']
    target = node_in(document, node_id)
    if target.get('locked'):
        raise ValueError(f'DIRECTOR_NODE_LOCKED:{node_id}')
    nodes = document['content']['nodes']
    cameras = [n for n in nodes if n['type'] == 'camera' and n['id'] != node_id]
    if target['type'] == 'camera' and not cameras:
        raise ValueError('DIRECTOR_LAST_CAMERA_REQUIRED')
    if target.get('children'):
        raise ValueError('DIRECTOR_DELETE_CHILDREN_FIRST')
    sequence = snapshot.get('sceneSequence', 0)
    versions = snapshot.get('entityVersions') or {}
    operations = []
    def add(kind, entity_id, payload):
        operations.append({'kind': kind, 'entityId': entity_id, 'payload': payload,
                           'operationId': new_scene_operation_id('static_delete'),
                           'baseSequence': sequence, 'expectedEntityVersion': versions.get(entity_id)})
    add('director.node.delete', node_id, {})
    detached = []
    for original in nodes:
        if original['id'] == node_id:
            continue
        node = copy.deepcopy(original)
        if node.get('camera', {}).get('subject', {}).get('nodeId') == node_id:
            _detach_subject(node, target)
            detached.append(node['id'])
        if node.get('camera', {}).get('lookAtTarget', {}).get('nodeId') == node_id:
            look_target = node['camera'].pop('lookAtTarget')
            offset = look_target.get('offset') or {'x': 0, 'y': 1.2, 'z': 0}
            node['camera']['lookAt'] = {
                axis: target['transform']['position'][axis] + offset[axis]
                for axis in ('x', 'y', 'z')}
            if node['id'] not in detached:
                detached.append(node['id'])
        if node_id in node.get('children', []):
            node['children'] = [n for n in node['children'] if n != node_id]
        if node != original:
            add('director.node.upsert', node['id'], {'node': node})
    content = document['content']
    removed_clips = []
    animation = content['timeline']['animation']
    for key in ('cameraMotionClips', 'motionClips', 'pathMotionClips'):
        for clip in animation.get(key, []):
            if clip.get('target', {}).get('nodeId') == node_id or clip.get('pathNodeId') == node_id:
                add('director.clip.delete', clip['id'], {})
                removed_clips.append(clip['id'])
    curves_id = 'fcurves__' + node_id
    curves = snapshot.get('fcurves') or {}
    if curves_id in versions or curves_id in curves or any(fcurve_node_id(c) == node_id for c in curves.get('fcurves', [])):
        add('director.fcurves.delete', curves_id, {})
    # Scene-level patch preserves unrelated environment/timeline data.
    scene = {}
    animation_patch = {}
    for key in ('fcurves', 'motionTransitions'):
        original = animation.get(key, [])
        kept_entries = [entry for entry in original if not (
            isinstance(entry, dict) and (
                entry.get('nodeId') == node_id
                or entry.get('targetNodeId') == node_id
                or (isinstance(entry.get('target'), dict) and entry['target'].get('nodeId') == node_id)
                or any(entry.get(field) in removed_clips for field in ('fromClipId', 'toClipId'))))]
        if kept_entries != original:
            animation_patch[key] = kept_entries
    if animation_patch:
        # scene.set replaces content.timeline as a whole, so send the full timeline.
        timeline = copy.deepcopy(content['timeline'])
        timeline['animation'] = {
            key: value for key, value in timeline['animation'].items()
            if key not in ('cameraMotionClips', 'motionClips', 'pathMotionClips')}
        timeline['animation'].update(animation_patch)
        scene['timeline'] = timeline
    if content.get('activeShotCameraNodeId') == node_id:
        scene['activeShotCameraNodeId'] = cameras[0]['id']
    editorial = copy.deepcopy(content.get('editorial'))
    if isinstance(editorial, dict):
        for sequence_item in editorial.get('sequences', []):
            sequence_item['clips'] = [c for c in sequence_item.get('clips', []) if c.get('cameraNodeId') != node_id]
        if editorial != content['editorial']:
            scene['editorial'] = editorial
    constraints = content.get('physicalConstraints', [])
    kept = [c for c in constraints if not (isinstance(c, dict) and any(
        c.get(key) == node_id for key in ('nodeId', 'targetNodeId', 'sourceNodeId', 'supportNodeId')))]
    if kept != constraints:
        scene['physicalConstraints'] = kept
    if scene:
        add('director.scene.set', 'director', {'scene': {'content': {'version': 1, **scene}}})
    if len(operations) > 64:
        raise ValueError('DIRECTOR_DELETE_TOO_MANY_DEPENDENCIES')
    return ({'schemaVersion': 2, 'batchId': new_scene_operation_id('delete_node'), 'operations': operations},
            {'deletedNodeId': node_id, 'deletedClipIds': removed_clips, 'detachedCameraIds': detached})

"""Pure-function checks for the static helpers behind node batches and deletes."""
import copy

import pytest
from jsonschema import Draft7Validator

from topview_3d_cli.director_document import (
    default_camera_node, empty_director_document, node_from_library,
    summarize_director_snapshot,
)
from topview_3d_cli.director_static import camera_view, delete_node_operations, node_in
from topview_3d_cli.node_batch import BATCH_SCHEMA, affected_nodes, node_state


def character(name='主角·小明', node_id='hero'):
    return node_from_library('characters', {'id': 'fixture-person', 'name': name, 'file': ''}, node_id=node_id)


def test_delete_active_camera_repairs_editorial_and_protects_last_camera():
    doc = empty_director_document()
    with pytest.raises(ValueError, match='LAST_CAMERA'):
        delete_node_operations({'document': doc}, 'cam-main')
    doc['content']['nodes'].append(default_camera_node('second'))
    doc['content']['editorial'] = {'version': 1, 'activeSequenceId': 'seq', 'sequences': [
        {'id': 'seq', 'clips': [{'id': 'shot1', 'cameraNodeId': 'cam-main'}, {'id': 'shot2', 'cameraNodeId': 'second'}]}]}
    batch, _detail = delete_node_operations(
        {'document': doc, 'entityVersions': {'director': 3, 'cam-main': 2}, 'sceneSequence': 4}, 'cam-main')
    scene = next(op['payload']['scene']['content'] for op in batch['operations'] if op['kind'] == 'director.scene.set')
    assert scene['activeShotCameraNodeId'] == 'second'
    assert scene['editorial']['sequences'][0]['clips'] == [{'id': 'shot2', 'cameraNodeId': 'second'}]
    assert doc['content']['activeShotCameraNodeId'] == 'cam-main'
    assert all(op['baseSequence'] == 4 for op in batch['operations'])


def test_delete_character_detaches_bound_camera_and_clears_motion():
    doc = empty_director_document()
    hero = character()
    hero['transform']['position']['x'] = 3
    cam = doc['content']['nodes'][0]
    cam['camera']['subject'] = {'nodeId': 'hero', 'follow': True, 'followRotation': False,
                                'offset': {'x': 0, 'y': 1, 'z': 5}, 'lookAtOffset': {'x': 0, 'y': 1, 'z': 0}, 'distance': 5}
    cam['camera']['lookAtTarget'] = {'nodeId': 'hero', 'offset': {'x': 0, 'y': 1.2, 'z': 0}}
    doc['content']['nodes'].append(hero)
    doc['content']['timeline']['animation']['motionClips'] = [{'id': 'motion-hero', 'target': {'nodeId': 'hero'}}]
    snapshot = {'document': doc, 'sceneSequence': 5, 'entityVersions': {'director': 1, 'hero': 1, 'cam-main': 1}}
    batch, _ = delete_node_operations(snapshot, 'hero')
    kinds = {(op['kind'], op['entityId']) for op in batch['operations']}
    assert ('director.node.delete', 'hero') in kinds
    assert ('director.clip.delete', 'motion-hero') in kinds
    camera = next(op['payload']['node'] for op in batch['operations']
                  if op['kind'] == 'director.node.upsert' and op['entityId'] == 'cam-main')
    assert 'subject' not in camera['camera'] and 'lookAtTarget' not in camera['camera']
    assert camera['camera']['lookAt'] == {'x': 3, 'y': 1.2, 'z': 0}


def test_camera_view_requires_camera_and_sets_active_shot():
    doc = empty_director_document()
    doc['content']['nodes'].append(character())
    body = camera_view({'document': copy.deepcopy(doc)}, 'cam-main')
    assert body['cameraNodeId'] == 'cam-main'
    assert body['document']['content']['activeShotCameraNodeId'] == 'cam-main'
    with pytest.raises(ValueError, match='CAMERA_REQUIRED'):
        camera_view({'document': copy.deepcopy(doc)}, 'hero')
    with pytest.raises(ValueError, match='NODE_NOT_FOUND'):
        node_in(doc, 'missing')


def test_snapshot_summary_reports_mode_and_active_camera():
    doc = empty_director_document()
    summary = summarize_director_snapshot({'document': doc, 'sceneSequence': 1})
    assert summary['suggestedMode'] == 'new'
    assert summary['activeCameraNodeId'] == doc['content']['activeShotCameraNodeId']
    doc['content']['nodes'].append(character())
    assert summarize_director_snapshot({'document': doc, 'sceneSequence': 2})['suggestedMode'] == 'edit'


def test_affected_nodes_follow_parents_children_and_bound_cameras():
    doc = empty_director_document()
    hero = character()
    doc['content']['nodes'][0]['camera']['lookAtTarget'] = {'nodeId': 'hero', 'offset': {'x': 0, 'y': 1, 'z': 0}}
    doc['content']['nodes'].append(hero)
    ids = affected_nodes({'document': doc}, ['hero'])
    assert set(ids) == {'cam-main', 'hero'}
    row = node_state(hero, {'hero': 7})
    assert row['entityVersion'] == 7 and row['assetId'] == 'fixture-person' and row['type'] == 'character'


def test_batch_schema_rejects_unknown_actions_and_negative_scale():
    validator = Draft7Validator(BATCH_SCHEMA)
    good = {'expectedSceneSequence': 1, 'changes': [
        {'action': 'add_primitive', 'nodeId': 'box', 'primitive': {'kind': 'BoxGeometry', 'parameters': {'width': 1, 'height': 1, 'depth': 1}}}]}
    assert not list(validator.iter_errors(good))
    assert list(validator.iter_errors({'expectedSceneSequence': 1, 'changes': [{'action': 'explode', 'nodeId': 'box'}]}))
    assert list(validator.iter_errors({'expectedSceneSequence': 1, 'changes': [
        {'action': 'update', 'nodeId': 'box', 'scale': {'x': -1}}]}))
    assert list(validator.iter_errors({'expectedSceneSequence': 1, 'changes': [
        {'action': 'update', 'nodeId': 'cam-overview', 'presetId': 'bird-eye',
         'position': {'x': 0, 'y': 14, 'z': 0}}]}))

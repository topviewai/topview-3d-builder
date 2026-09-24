import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { applyMotionAndPose } from '../objects/applySnapshot'
import type { StageGraph } from '../objects/graph'

function characterGraph(loadedClip: THREE.AnimationClip | null) {
  const node = {
    id: 'hero', name: 'Hero', type: 'character' as const, visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { animation: { mode: 'pose', controlValues: {}, rootPositionOffset: { x: 0, y: -0.3, z: 0 } } },
  }
  const root = new THREE.Group()
  const inner = new THREE.Group()
  root.add(inner)
  const played: string[] = []
  const character = {
    node, root, inner, rig: 'mixamorig', restPose: new Map(), restPos: new Map(),
    animator: { playAt: (id: string) => played.push(id), stopAll: () => played.push('stop') },
  }
  const clip = { id: 'walk-clip', motion: { assetId: 'walk' } }
  const graph = {
    doc: { content: { timeline: { animation: { motionClips: [clip] } } } },
    scene: new THREE.Scene(), nodeById: new Map([['hero', node]]),
    characters: new Map([['hero', character]]), props: new Map(), primitives: new Map(), groups: new Map(),
    cameras: new Map(), poseBank: new Map(),
    motionPlayer: { getClipForDirectBind: () => loadedClip, getRaw: () => null },
  } as unknown as StageGraph
  const snapshot = createFrameSnapshot()
  snapshot.motionPlayback.push({ nodeId: 'hero', clipId: 'walk-clip', timeSeconds: 0.5 } as never)
  applyMotionAndPose(graph, snapshot)
  return { inner, played }
}

test('动作素材已加载时片段覆盖姿势', () => {
  const { inner, played } = characterGraph(new THREE.AnimationClip('walk', 1, []))
  assert.deepEqual(played, ['walk-clip'])
  assert.equal(inner.position.y, 0)
})

test('动作素材缺失时角色保持姿势而不是停在 bind pose', () => {
  const { inner, played } = characterGraph(null)
  assert.deepEqual(played, ['stop'])
  assert.equal(inner.position.y, -0.3)
})

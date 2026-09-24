import type { DraftNode } from '../../contract/types'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import {
  CAMERA_PRESETS,
  type CameraMotionPreset,
} from '../../data/cameraLibrary'
import { bakeCameraMotionPoses, type CameraPoseSample } from './bakeMotion'

export const PREVIEW_FRONT = CAMERA_PRESETS.find((p) => p.id === 'front-medium')

function needsWalkPath(preset: CameraMotionPreset): boolean {
  const kind = preset.recipe.pathKind
  return preset.recipe.type === 'path' && (kind === 'follow' || kind === 'leading' || kind === 'profile' || kind === 'fpv')
}

function previewCharacter(): DraftNode {
  return {
    id: 'char_1',
    type: 'character',
    name: 'preview',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    character: {
      placeholder: true,
      gender: 'neutral',
      motionId: null,
      appearance: { color: '#888888' },
      label: { showLabel: false, scale: 1, yOffset: 0 },
      animation: { mode: 'pose', controlValues: {} },
    },
  }
}

export function previewCameraMotionPoses(preset: CameraMotionPreset): CameraPoseSample[] | null {
  if (!PREVIEW_FRONT) return null
  const doc = makeEmptyDraft('thumb', 30, 90, PREVIEW_FRONT)
  const cameraNode = doc.content.nodes[0]
  if (!cameraNode) return null
  const targetNode = previewCharacter()
  doc.content.nodes.push(targetNode)
  if (needsWalkPath(preset)) {
    doc.content.nodes.push({
      id: 'path_1',
      type: 'path',
      name: 'walk',
      visible: true,
      locked: false,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      path: {
        source: 'click',
        curve: 'polyline',
        closed: false,
        groundSnap: true,
        parameterization: 'time-ratio',
        smoothing: 0,
        points: [
          { id: 'a', position: { x: 0, y: 0, z: -1.5 }, timeRatio: 0 },
          { id: 'b', position: { x: 0, y: 0, z: 2.5 }, timeRatio: 1 },
        ],
      },
    })
    doc.content.timeline.animation.pathMotionClips.push({
      id: 'pmc_1',
      status: 'active',
      locked: false,
      source: 'preview',
      target: { type: 'node', nodeId: targetNode.id },
      pathNodeId: 'path_1',
      pathName: 'walk',
      pathLength: 4,
      pathStartPercent: 0,
      pathEndPercent: 100,
      direction: 'forward',
      facing: 'path-tangent',
      frameStart: 0,
      frameEnd: 90,
      playback: { version: 1, speed: 1, loop: false, loopMode: 'ping-pong', baseDurationFrames: 90 },
    })
  }
  const baked = bakeCameraMotionPoses(preset, { cameraNode, targetNode, doc }, 0)
  return baked.ok && baked.poses ? baked.poses : null
}

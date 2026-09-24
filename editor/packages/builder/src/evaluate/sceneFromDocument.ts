import type { DirectorDocument } from '../contract/types'
import type { FCurveSet } from './curves/FCurveSet'
import type { UserKeys } from './curves/KeyframeTrack'
import type { SceneContract } from './FrameSnapshot'

export interface SceneOverlays {
  fcurves?: FCurveSet | null
  userKeys?: UserKeys
  userKeysEnabled?: boolean
  chainCameraMotion?: boolean
}

export function sceneFromDocument(doc: DirectorDocument, overlays?: SceneOverlays): SceneContract {
  const tl = doc.content.timeline
  return {
    meta: { fps: tl.fps, frameStart: tl.frameStart, frameEnd: tl.frameEnd },
    nodes: doc.content.nodes,
    timeline: tl,
    fcurves: overlays?.fcurves ?? null,
    userKeys: overlays?.userKeys,
    userKeysEnabled: overlays?.userKeysEnabled,
    chainCameraMotion: overlays?.chainCameraMotion,
  }
}

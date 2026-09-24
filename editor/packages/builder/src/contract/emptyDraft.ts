// 新建空草稿：构造最小合法的内存 DirectorDocument（不落盘、不带 fcurvesRef）。
// 环境沿用 load 的默认（灯光/网格必建，地面由 display.groundVisible 控制）。
// 主相机姿态由调用方传入，contract 不硬抄机位库。
import { DEFAULT_ASPECT_RATIO } from './aspectRatio'
import { DEFAULT_SKY_COLOR } from './skyColor'
import type { DirectorDocument, DraftNode, Vec3 } from './types'

export interface EmptyDraftCamera {
  fov: number
  position: Vec3
  rotation: Vec3
  lookAt: Vec3
}

export function makeEmptyDraft(
  name: string,
  fps: number,
  totalFrames: number,
  camera?: EmptyDraftCamera,
): DirectorDocument {
  const nodes: DraftNode[] = []
  if (camera) {
    nodes.push({
      id: 'camera_1',
      type: 'camera',
      name: 'Main Camera',
      visible: true,
      locked: false,
      transform: {
        position: { ...camera.position },
        rotation: { ...camera.rotation },
        scale: { x: 1, y: 1, z: 1 },
      },
      camera: {
        projection: 'perspective',
        fov: camera.fov,
        fovAxis: 'vertical',
        near: 0.1,
        far: 2000,
        isPrimary: true,
        lookAt: { ...camera.lookAt },
      },
    })
  }
  return {
    type: 'biz/scene3d-director-document',
    pippitAssetId: '',
    extra: { customDraftName: name },
    content: {
      version: 1,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      activeShotCameraNodeId: camera ? 'camera_1' : '',
      environment: {
        background: { mode: 'color', skyColor: DEFAULT_SKY_COLOR },
        display: {
          characterLabelsVisible: true,
          groundVisible: true,
          groundHeight: 0,
          groundOpacity: 1,
        },
      },
      asset: { motionPath: [] },
      nodes,
      physicalConstraints: [],
      editorial: {
        version: 1,
        activeSequenceId: 'sequence_1',
        sequences: [{ id: 'sequence_1', clips: [] }],
      },
      timeline: {
        version: 1,
        fps,
        frameStart: 0,
        frameEnd: Math.max(1, Math.round(totalFrames)),
        usePreviewRange: false,
        animation: {
          fcurves: [],
          cameraMotionClips: [],
          motionTransitions: [],
          motionClips: [],
          pathMotionClips: [],
        },
      },
    },
  }
}

import type {
  CameraMotionClip,
  MotionClip,
  PathMotionClip,
} from '../../contract/types'
import type { TrackProp } from '../../evaluate/curves/KeyframeTrack'

export type RowKind = 'node' | 'group' | 'clips-camera' | 'clips-motion' | 'clips-path' | 'kf'

export interface TimelineRow {
  key: string
  nodeId: string
  nodeName: string
  nodeType: string
  label: string
  kind: RowKind
  prop?: TrackProp
  /**
   * 变换主轨：◆+ 一次写入这些维度（人物位移/旋转/缩放，机位再加看点/FOV），
   * 并在主轨显示聚合钻石。行自带维度列表，消费方不必按 nodeType 反查。
   */
  addTransformKeys?: TrackProp[]
  /** 这台相机是因为跟随当前选中的人物才列出来的 */
  followsSubject?: boolean
  camClips?: CameraMotionClip[]
  motionClips?: MotionClip[]
  pathClips?: PathMotionClip[]
  children?: TimelineRow[]
}

export interface TimelineSummary {
  cam: CameraMotionClip[]
  motion: MotionClip[]
  path: PathMotionClip[]
  kfTracks: { nodeId: string; prop: TrackProp }[]
}

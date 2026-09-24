import type { EditSequenceClip } from '../../contract/types'

/** 成片轨道上单个片段的绝对布局；重排时被拖的那个浮在上层。 */
export interface SlotLayout {
  clip: EditSequenceClip
  left: number
  width: number
  dragging: boolean
}

export interface SequenceLayout {
  slots: SlotLayout[]
  /** 重排时真实让出来的占位槽；非重排为 null。 */
  drop: { left: number; width: number } | null
  total: number
}

/** 单个片段的胶片格取帧结果。 */
export interface ClipStrip {
  clipId: string
  cameraId: string
  frames: number[]
}

/** 源条上某台机位已被选进视频的一段。 */
export interface UsedRange {
  clipId: string
  /** 1-based 分镜编号，与视频轨道上的序号一致。 */
  index: number
  sourceFrameStart: number
  sourceFrameEnd: number
}

/** 源时间轴上重叠的已用区间收成一组，轨道上只占一块。 */
export interface UsedCluster {
  id: string
  items: UsedRange[]
  sourceFrameStart: number
  sourceFrameEnd: number
}

/** 源条上正在编辑的区间：可能来自已有片段，也可能来自新建草稿。 */
export interface SourceWorkingRange {
  cameraNodeId: string
  sourceFrameStart: number
  sourceFrameEnd: number
}

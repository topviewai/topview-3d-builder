import type { CameraMotionClip } from '../../contract/types'

/** 视频导出默认结束帧：该机位运镜最后一段的 frameEnd；未指定机位则看全部运镜。没有运镜时退回时间轴终点。 */
export function defaultVideoExportEndFrame(
  clips: readonly CameraMotionClip[],
  cameraId: string | null,
  timelineEnd: number,
): number {
  const scoped = cameraId
    ? clips.filter((clip) => clip.target.nodeId === cameraId)
    : clips
  if (scoped.length === 0) return timelineEnd
  return Math.min(timelineEnd, Math.max(...scoped.map((clip) => clip.frameEnd)))
}

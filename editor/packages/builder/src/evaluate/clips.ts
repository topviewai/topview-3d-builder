import type { MotionClip } from '../contract/types'

/** 闭区间 [frameStart, frameEnd]，与 parser.findMotionClipAt 一致。 */
export function motionClipAt(
  clips: readonly MotionClip[],
  nodeId: string,
  frame: number,
): MotionClip | null {
  for (const clip of clips) {
    if (clip.target.nodeId === nodeId && frame >= clip.frameStart && frame <= clip.frameEnd) {
      return clip
    }
  }
  return null
}

export function motionTimeSeconds(clip: MotionClip, frame: number, fps: number): number {
  const speed = clip.playback.speed ?? 1
  const t = ((Math.max(clip.frameStart, frame) - clip.frameStart) / fps) * speed
  if (clip.playback.loop && clip.sourceDuration > 0) {
    return clip.motion.time + (t % clip.sourceDuration)
  }
  return Math.min(clip.motion.time + t, clip.sourceDuration)
}

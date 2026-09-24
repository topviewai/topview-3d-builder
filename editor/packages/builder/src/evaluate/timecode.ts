export function safeFps(fps: number): number {
  return Math.max(1, Math.round(fps))
}

/** 时间线帧号 → 秒（展示用，不量化）。 */
export function framesToSeconds(frame: number, fps: number): number {
  return frame / safeFps(fps)
}

/** 秒 → 时间线帧号。 */
export function secondsToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * safeFps(fps))
}

/** 改帧率时按秒锁定同一时刻，把旧帧号映射到新 fps。 */
export function remapFrame(frame: number, fromFps: number, toFps: number): number {
  return secondsToFrame(framesToSeconds(frame, fromFps), toFps)
}

export function formatTimecode(frame: number, fps: number): string {
  const rate = safeFps(fps)
  const total = Math.max(0, Math.round(frame))
  const ff = total % rate
  const seconds = Math.floor(total / rate)
  const ss = seconds % 60
  const mm = Math.floor(seconds / 60) % 60
  const hh = Math.floor(seconds / 3600)
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`
}

export function parseTimecode(value: string, fps: number): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const rate = safeFps(fps)
  const hh = Number(match[1])
  const mm = Number(match[2])
  const ss = Number(match[3])
  const ff = Number(match[4])
  if (mm > 59 || ss > 59 || ff >= rate) return null
  return ((hh * 60 + mm) * 60 + ss) * rate + ff
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

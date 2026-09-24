export const MIN_EXPORT_BITRATE = 4_000_000
export const MAX_EXPORT_BITRATE = 20_000_000
export const EXPORT_BITS_PER_PIXEL = 0.12

export function evenExportSize(value: number): number {
  const whole = Math.max(2, Math.floor(value))
  return whole - (whole % 2)
}

export function exportFps(fps: number): number {
  return Math.max(1, Math.round(fps))
}

export function exportBitrate(width: number, height: number, fps: number): number {
  return Math.min(
    MAX_EXPORT_BITRATE,
    Math.max(MIN_EXPORT_BITRATE, Math.round(width * height * fps * EXPORT_BITS_PER_PIXEL)),
  )
}

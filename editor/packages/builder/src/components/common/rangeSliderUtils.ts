export type RangeThumb = 'start' | 'end'

export function clampFrame(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

export function valueFromClientX(
  clientX: number,
  left: number,
  width: number,
  min: number,
  max: number,
): number {
  if (width <= 0) return min
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width))
  return clampFrame(min + ratio * (max - min), min, max)
}

export function pickCloserThumb(value: number, start: number, end: number): RangeThumb {
  return Math.abs(value - start) <= Math.abs(value - end) ? 'start' : 'end'
}

export function applyRangeThumb(
  thumb: RangeThumb,
  next: number,
  start: number,
  end: number,
  min: number,
  max: number,
): { start: number; end: number } {
  if (thumb === 'start') return { start: clampFrame(next, min, end), end }
  return { start, end: clampFrame(next, start, max) }
}

export function rangePercent(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return ((value - min) / (max - min)) * 100
}

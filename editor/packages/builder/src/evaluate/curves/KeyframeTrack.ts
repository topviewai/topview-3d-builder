// 通用关键帧轨道（扩展功能）：任意节点的 position/rotation/scale，相机额外 lookAt/fov。
// 作为 clip 求值之后的覆写层（可在 UI 开关）。linear / smooth(smoothstep) 插值，端点 constant 外推。

export type TrackProp = 'position' | 'rotation' | 'scale' | 'lookAt' | 'fov'
/** Keyframe segment easing. Legacy `smooth` equals ease-in-out (smoothstep). */
export type Interpolation = 'linear' | 'smooth' | 'ease-in-out' | 'ease-in' | 'ease-out'

export const KEYFRAME_EASINGS = ['ease-in-out', 'ease-in', 'ease-out', 'linear'] as const
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number]

/** Map stored interpolation (incl. legacy smooth) to UI / write-back easing. */
export function toKeyframeEasing(interp: Interpolation | string | undefined): KeyframeEasing {
  if (interp === 'ease-in' || interp === 'ease-out' || interp === 'linear') return interp
  // smooth / ease-in-out / unknown -> ease-in-out
  return 'ease-in-out'
}

function applyInterpolation(interp: Interpolation | string | undefined, t: number): number {
  switch (interp) {
    case 'smooth':
      // legacy smoothstep: keep exact prior behavior for existing keys
      return t * t * (3 - 2 * t)
    case 'ease-in-out':
      // match CameraRig quadratic ease-in-out
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'linear':
    default:
      return t
  }
}

export interface Keyframe {
  id: string
  frame: number
  value: number[] // [x,y,z] 或 [v]（fov）
  interpolation: Interpolation
}

export type UserKeys = Record<string, Partial<Record<TrackProp, Keyframe[]>>>

const _sortedCache = new WeakMap<Keyframe[], Keyframe[]>()

function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  let sorted = _sortedCache.get(kfs)
  if (sorted) return sorted
  sorted = kfs.slice().sort((a, b) => a.frame - b.frame)
  _sortedCache.set(kfs, sorted)
  return sorted
}

/** Extrapolation past key range.
 *  - true: constant hold both ends (default; cameras)
 *  - false: only sample inside [first, last]; outside return false
 *  - 'hold-after': hold after last (Constant Hold); before first still return false
 */
export type KeyframeExtrapolate = boolean | 'hold-after'

export function sampleKeyframesInto(
  kfs: Keyframe[],
  frame: number,
  out: number[],
  extrapolate: KeyframeExtrapolate = true,
): boolean {
  if (kfs.length === 0) return false
  const sorted = sortedKeyframes(kfs)
  const write = (src: number[]) => {
    const n = Math.max(src.length, out.length)
    for (let i = 0; i < n; i++) out[i] = src[i] ?? 0
  }
  if (frame <= sorted[0].frame) {
    // Before first: hold only when extrapolate===true; false/'hold-after' fall through.
    if (extrapolate !== true && frame < sorted[0].frame) return false
    write(sorted[0].value)
    return true
  }
  const last = sorted[sorted.length - 1]
  if (frame >= last.frame) {
    // 末键之后始终钉住最后一键，避免播完弹回打键前的静态值
    write(last.value)
    return true
  }
  let i = 0
  while (i < sorted.length - 2 && sorted[i + 1].frame < frame) i++
  const a = sorted[i]
  const b = sorted[i + 1]
  const span = b.frame - a.frame
  let t = span > 0 ? (frame - a.frame) / span : 0
  t = applyInterpolation(a.interpolation, t)
  const dims = Math.max(a.value.length, b.value.length, out.length)
  for (let j = 0; j < dims; j++) {
    const av = a.value[j] ?? 0
    out[j] = av + ((b.value[j] ?? av) - av) * t
  }
  return true
}

export function sampleKeyframes(kfs: Keyframe[], frame: number): number[] | null {
  if (kfs.length === 0) return null
  const dims = kfs[0]?.value.length ?? 0
  const out = new Array<number>(dims)
  return sampleKeyframesInto(kfs, frame, out) ? out : null
}

export function makeKeyframe(frame: number, value: number[]): Keyframe {
  return {
    id: `kf_${Math.random().toString(36).slice(2, 10)}`,
    frame: Math.round(frame),
    value: [...value],
    interpolation: 'linear',
  }
}

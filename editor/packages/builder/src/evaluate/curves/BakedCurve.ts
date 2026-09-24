// 烘焙曲线采样器：linear 直接插值；bezier 无手柄字段，用 smoothstep 近似；端点外 constant 外推。
import type { BakedCurve } from '../../contract/types'

export function sampleCurve(curve: BakedCurve, timeMs: number): number {
  const kfs = curve.keyframes
  if (kfs.length === 0) return 0
  if (kfs.length === 1 || timeMs <= kfs[0].time) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (timeMs >= last.time) return last.value // constant 外推

  // 二分查找所在段
  let lo = 0
  let hi = kfs.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (kfs[mid].time <= timeMs) lo = mid
    else hi = mid
  }
  const a = kfs[lo]
  const b = kfs[hi]
  const span = b.time - a.time
  let t = span > 0 ? (timeMs - a.time) / span : 0
  if (a.interpolation === 'bezier') {
    // 草稿里 bezier 没有手柄字段，只是「缓动」标记：用 smoothstep 近似
    t = t * t * (3 - 2 * t)
  }
  return a.value + (b.value - a.value) * t
}

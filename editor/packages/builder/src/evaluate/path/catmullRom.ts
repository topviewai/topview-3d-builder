// centripetal Catmull-Rom（对齐 three.js CatmullRomCurve3 + Curve.getPointAt）
// evaluate 层零 three：位置 / 切线 / 弧长全部纯函数。
// 缓存按 points 数组引用作键；点变了一定是新数组。

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface SampledPoint {
  x: number
  y: number
  z: number
}

const ARC_DIVISIONS = 200

interface CurveCache {
  pts: SampledPoint[]
  closed: boolean
  lengths: number[]
  total: number
}

const curveCache = new WeakMap<object, CurveCache>()

function distSq(a: SampledPoint, b: SampledPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function lerpPoint(a: SampledPoint, b: SampledPoint, t: number, out: SampledPoint): void {
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
}

/** Nonuniform Catmull-Rom 插值（three.js CubicPoly，centripetal pow=0.25） */
function interpolate(
  p0: SampledPoint,
  p1: SampledPoint,
  p2: SampledPoint,
  p3: SampledPoint,
  dt0: number,
  dt1: number,
  dt2: number,
  t: number,
  out: SampledPoint,
): void {
  const axis = (a: number, b: number, c: number, d: number): number => {
    const t1 = (b - a) / dt0 - (c - a) / (dt0 + dt1) + (c - b) / dt1
    const t2 = (c - b) / dt1 - (d - b) / (dt1 + dt2) + (d - c) / dt2
    const c0 = b
    const c1 = dt1 * t1
    const c2 = -3 * b + 3 * c - 2 * dt1 * t1 - dt1 * t2
    const c3 = 2 * b - 2 * c + dt1 * t1 + dt1 * t2
    return c0 + c1 * t + c2 * t * t + c3 * t * t * t
  }
  out.x = axis(p0.x, p1.x, p2.x, p3.x)
  out.y = axis(p0.y, p1.y, p2.y, p3.y)
  out.z = axis(p0.z, p1.z, p2.z, p3.z)
}

const _p0: SampledPoint = { x: 0, y: 0, z: 0 }
const _p3: SampledPoint = { x: 0, y: 0, z: 0 }
const _tmp: SampledPoint = { x: 0, y: 0, z: 0 }

function getPoint(cache: CurveCache, t: number, out: SampledPoint): void {
  const points = cache.pts
  const l = points.length
  const closed = cache.closed
  const p = (l - (closed ? 0 : 1)) * t
  let intPoint = Math.floor(p)
  let weight = p - intPoint
  if (closed) {
    intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l
  } else if (weight === 0 && intPoint === l - 1) {
    intPoint = l - 2
    weight = 1
  }

  let p0: SampledPoint
  if (closed || intPoint > 0) {
    p0 = points[(intPoint - 1 + l) % l]
  } else {
    _p0.x = points[0].x * 2 - points[1].x
    _p0.y = points[0].y * 2 - points[1].y
    _p0.z = points[0].z * 2 - points[1].z
    p0 = _p0
  }
  const p1 = points[intPoint % l]
  const p2 = points[(intPoint + 1) % l]
  let p3: SampledPoint
  if (closed || intPoint + 2 < l) {
    p3 = points[(intPoint + 2) % l]
  } else {
    const last = points[l - 1]
    const prev = points[l - 2]
    _p3.x = last.x * 2 - prev.x
    _p3.y = last.y * 2 - prev.y
    _p3.z = last.z * 2 - prev.z
    p3 = _p3
  }

  let dt0 = Math.pow(distSq(p0, p1), 0.25)
  let dt1 = Math.pow(distSq(p1, p2), 0.25)
  let dt2 = Math.pow(distSq(p2, p3), 0.25)
  if (dt1 < 1e-4) dt1 = 1
  if (dt0 < 1e-4) dt0 = dt1
  if (dt2 < 1e-4) dt2 = dt1
  interpolate(p0, p1, p2, p3, dt0, dt1, dt2, weight, out)
}

function buildCache(points: readonly { position: Vec3Like }[], closed: boolean): CurveCache {
  const pts = points.map((p) => ({ x: p.position.x, y: p.position.y, z: p.position.z }))
  const cache: CurveCache = { pts, closed, lengths: [0], total: 0 }
  let sum = 0
  const a: SampledPoint = { x: 0, y: 0, z: 0 }
  const b: SampledPoint = { x: 0, y: 0, z: 0 }
  getPoint(cache, 0, a)
  for (let i = 1; i <= ARC_DIVISIONS; i++) {
    getPoint(cache, i / ARC_DIVISIONS, b)
    sum += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    cache.lengths.push(sum)
    a.x = b.x
    a.y = b.y
    a.z = b.z
  }
  cache.total = sum
  return cache
}

function cacheOf(points: readonly { position: Vec3Like }[], closed: boolean): CurveCache {
  const key = points as object
  const hit = curveCache.get(key)
  if (hit && hit.closed === closed) return hit
  const next = buildCache(points, closed)
  curveCache.set(key, next)
  return next
}

function uToT(cache: CurveCache, u: number): number {
  const target = Math.min(Math.max(u, 0), 1) * cache.total
  const lengths = cache.lengths
  let lo = 0
  let hi = ARC_DIVISIONS
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] < target) lo = mid
    else hi = mid
  }
  const span = lengths[hi] - lengths[lo]
  const t = span > 0 ? (target - lengths[lo]) / span : 0
  return (lo + t) / ARC_DIVISIONS
}

export function catmullRomPointAt(
  points: readonly { position: Vec3Like }[],
  closed: boolean,
  u: number,
  out: SampledPoint,
): void {
  const cache = cacheOf(points, closed)
  getPoint(cache, uToT(cache, u), out)
}

export function catmullRomTangentAt(
  points: readonly { position: Vec3Like }[],
  closed: boolean,
  u: number,
  out: SampledPoint,
): void {
  const cache = cacheOf(points, closed)
  const t = uToT(cache, u)
  const delta = 0.0001
  let t1 = t - delta
  let t2 = t + delta
  if (t1 < 0) t1 = closed ? t1 + 1 : 0
  if (t2 > 1) t2 = closed ? t2 - 1 : 1
  getPoint(cache, t1, _tmp)
  getPoint(cache, t2, out)
  out.x -= _tmp.x
  out.y -= _tmp.y
  out.z -= _tmp.z
}

export function catmullRomLength(points: readonly { position: Vec3Like }[], closed: boolean): number {
  return cacheOf(points, closed).total
}

export function catmullRomSpacedPoints(
  points: readonly { position: Vec3Like }[],
  closed: boolean,
  divisions: number,
): SampledPoint[] {
  const out: SampledPoint[] = []
  for (let i = 0; i <= divisions; i++) {
    const p: SampledPoint = { x: 0, y: 0, z: 0 }
    catmullRomPointAt(points, closed, i / divisions, p)
    out.push(p)
  }
  return out
}

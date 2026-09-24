// fcurves（compact-v1）解码与求值。
// 数据形态：{ version, encoding: 'compact-v1', fcurves: [...] }
// 每条曲线：{ id, t: ['node', nodeId], p: propPath, i: 分量序号, k: 关键帧数组 }
// 关键帧：[帧(浮点), 值, 'bezier'|'linear', kf_id, 入手柄?, 出手柄?]，手柄 { x: 帧, y: 值 }。
// 求值规则：范围外 constant 外推；bezier 段缺手柄时按水平自动切线补齐
//（两端都缺等价 smoothstep），linear 段线性插值。
// rotation 轨道单位是角度（由调用方转弧度）。

import type { Keyframe, TrackProp, UserKeys } from './KeyframeTrack'

export type CompactFCurvesJson = {
  version: 1
  encoding: 'compact-v1'
  fcurves: unknown[]
  userKeys?: UserKeys
}

const USER_KEY_PROPS: TrackProp[] = ['position', 'rotation', 'scale', 'lookAt', 'fov']

export interface FCurveHandle {
  x: number
  y: number
}

export interface FCurveKey {
  frame: number
  value: number
  interp: string
  id: string
  inHandle: FCurveHandle | null
  outHandle: FCurveHandle | null
}

export interface FCurve {
  id: string
  nodeId: string
  propPath: string
  index: number
  keys: FCurveKey[] // 按 frame 升序
}

const _autoOut: FCurveHandle = { x: 0, y: 0 }
const _autoIn: FCurveHandle = { x: 0, y: 0 }
const _tmpA: FCurveKey = { frame: 0, value: 0, interp: '', id: '', inHandle: null, outHandle: null }
const _tmpB: FCurveKey = { frame: 0, value: 0, interp: '', id: '', inHandle: null, outHandle: null }

/** 求值用：贝塞尔 x(t)=frame 反解 t，再取 y(t)。牛顿法为主，失败退二分。 */
function evalBezierSegment(
  a: FCurveKey,
  b: FCurveKey,
  frame: number,
): number {
  const p0x = a.frame
  const p0y = a.value
  const p1x = a.outHandle!.x
  const p1y = a.outHandle!.y
  const p2x = b.inHandle!.x
  const p2y = b.inHandle!.y
  const p3x = b.frame
  const p3y = b.value

  const xAt = (t: number) => {
    const u = 1 - t
    return u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x
  }
  const yAt = (t: number) => {
    const u = 1 - t
    return u * u * u * p0y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y
  }
  const dxAt = (t: number) => {
    const u = 1 - t
    return 3 * u * u * (p1x - p0x) + 6 * u * t * (p2x - p1x) + 3 * t * t * (p3x - p2x)
  }

  // 牛顿迭代（限制在 [0,1]），初值取线性估计
  let t = p3x !== p0x ? (frame - p0x) / (p3x - p0x) : 0.5
  t = Math.min(Math.max(t, 0), 1)
  let ok = false
  for (let i = 0; i < 8; i++) {
    const err = xAt(t) - frame
    if (Math.abs(err) < 1e-7) {
      ok = true
      break
    }
    const d = dxAt(t)
    if (Math.abs(d) < 1e-12) break
    const nt = t - err / d
    if (nt < 0 || nt > 1) break
    t = nt
  }
  if (!ok) {
    // 二分兜底（假定 x 单调；官方导出的手柄都在段内）
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (xAt(mid) < frame) lo = mid
      else hi = mid
    }
    t = (lo + hi) / 2
  }
  return yAt(t)
}

/** 新关键帧 id：`kf_<毫秒时间base36>_<6位随机base36>`（与 encodeUserKeys 同款） */
function genKeyId(): string {
  return `kf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class FCurveSet {
  /** nodeId → propPath → 分量序号 → 曲线 */
  private byNode = new Map<string, Map<string, Map<number, FCurve>>>()
  curveCount: number

  private constructor(curves: FCurve[]) {
    this.curveCount = curves.length
    for (const c of curves) {
      let byProp = this.byNode.get(c.nodeId)
      if (!byProp) {
        byProp = new Map()
        this.byNode.set(c.nodeId, byProp)
      }
      let byIndex = byProp.get(c.propPath)
      if (!byIndex) {
        byIndex = new Map()
        byProp.set(c.propPath, byIndex)
      }
      byIndex.set(c.index, c)
    }
  }

  static parse(json: any): FCurveSet {
    if (!json || json.encoding !== 'compact-v1' || !Array.isArray(json.fcurves)) {
      throw new Error('不是 compact-v1 格式的 fcurves 文件')
    }
    const curves: FCurve[] = json.fcurves.map((raw: any) => {
      const nodeId = Array.isArray(raw.t) ? String(raw.t[1]) : String(raw.t)
      const keys: FCurveKey[] = (raw.k as any[]).map((k) => ({
        frame: Number(k[0]),
        value: Number(k[1]),
        interp: String(k[2] ?? 'linear'),
        id: String(k[3] ?? ''),
        inHandle: k[4] ? { x: Number(k[4].x), y: Number(k[4].y) } : null,
        outHandle: k[5] ? { x: Number(k[5].x), y: Number(k[5].y) } : null,
      }))
      keys.sort((a, b) => a.frame - b.frame)
      return {
        id: String(raw.id),
        nodeId,
        propPath: String(raw.p),
        index: Number(raw.i ?? 0),
        keys,
      }
    })
    return new FCurveSet(curves)
  }

  private findCurve(nodeId: string, propPath: string, index: number): FCurve | null {
    return this.byNode.get(nodeId)?.get(propPath)?.get(index) ?? null
  }

  /** 空集合（无 fcurves 的草稿首次提交拖拽时用） */
  static empty(): FCurveSet {
    return new FCurveSet([])
  }

  /**
   * upsert 一个关键帧：曲线不存在则建（id `fc_node_<nodeId>_<propPath点转下划线>_<分量>`），
   * 键按 frame 升序插入；同帧（严格相等）替换值并保留原键 id/插值。
   * 新键 interp='bezier'、手柄 null（运行时等价 smoothstep）。
   */
  upsertKey(
    nodeId: string,
    propPath: string,
    index: number,
    frame: number,
    value: number,
    keyId?: string,
  ): FCurveKey {
    let byProp = this.byNode.get(nodeId)
    if (!byProp) {
      byProp = new Map()
      this.byNode.set(nodeId, byProp)
    }
    let byIndex = byProp.get(propPath)
    if (!byIndex) {
      byIndex = new Map()
      byProp.set(propPath, byIndex)
    }
    let curve = byIndex.get(index)
    if (!curve) {
      curve = {
        id: `fc_node_${nodeId}_${propPath.replace(/\./g, '_')}_${index}`,
        nodeId,
        propPath,
        index,
        keys: [],
      }
      byIndex.set(index, curve)
      this.curveCount++
    }
    const keys = curve.keys
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid].frame < frame) lo = mid + 1
      else hi = mid
    }
    if (lo < keys.length && keys[lo].frame === frame) {
      keys[lo].value = value
      return keys[lo]
    }
    const key: FCurveKey = {
      frame,
      value,
      interp: 'bezier',
      id: keyId ?? genKeyId(),
      inHandle: null,
      outHandle: null,
    }
    keys.splice(lo, 0, key)
    return key
  }

  /** 某分量曲线在某帧（严格相等）是否已有键；有则返回该键 */
  getKeyAt(nodeId: string, propPath: string, index: number, frame: number): FCurveKey | null {
    const curve = this.findCurve(nodeId, propPath, index)
    if (!curve) return null
    let lo = 0
    let hi = curve.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (curve.keys[mid].frame < frame) lo = mid + 1
      else hi = mid
    }
    const k = curve.keys[lo]
    return k && k.frame === frame ? k : null
  }

  /** 某分量曲线 id（派生 clip 的 derivedSource.curveIds 用）；无曲线返回 null */
  curveId(nodeId: string, propPath: string, index: number): string | null {
    return this.findCurve(nodeId, propPath, index)?.id ?? null
  }

  /**
   * 节点 position 曲线的关键帧列表（按帧升序）：三分量键总是一起写，
   * 按 x 曲线的键列表取帧，y/z 取同帧值（缺任一分量则跳过该帧）。
   * 返回值同时携带三条曲线上的键 id（派生 clip 的 derivedSource.keyframeIds 用）。
   */
  positionKeys(
    nodeId: string,
  ): { frame: number; value: [number, number, number]; keyIds: [string, string, string] }[] {
    const cx = this.findCurve(nodeId, 'transform.position', 0)
    const cy = this.findCurve(nodeId, 'transform.position', 1)
    const cz = this.findCurve(nodeId, 'transform.position', 2)
    if (!cx || !cy || !cz) return []
    const byFrameY = new Map(cy.keys.map((k) => [k.frame, k]))
    const byFrameZ = new Map(cz.keys.map((k) => [k.frame, k]))
    const out: { frame: number; value: [number, number, number]; keyIds: [string, string, string] }[] = []
    for (const kx of cx.keys) {
      const ky = byFrameY.get(kx.frame)
      const kz = byFrameZ.get(kx.frame)
      if (!ky || !kz) continue
      out.push({
        frame: kx.frame,
        value: [kx.value, ky.value, kz.value],
        keyIds: [kx.id, ky.id, kz.id],
      })
    }
    return out
  }

  /** 节点某条属性路径是否有曲线（任一分量存在即算有） */
  hasTrack(nodeId: string, propPath: string): boolean {
    return (this.byNode.get(nodeId)?.get(propPath)?.size ?? 0) > 0
  }

  /** 单分量求值；无曲线返回 null。范围外 constant 外推。 */
  evalScalar(nodeId: string, propPath: string, index: number, frame: number): number | null {
    const curve = this.findCurve(nodeId, propPath, index)
    if (!curve || curve.keys.length === 0) return null
    const keys = curve.keys
    const first = keys[0]
    const last = keys[keys.length - 1]
    if (frame <= first.frame) return first.value
    if (frame >= last.frame) return last.value
    // 二分定位段：keys[lo].frame <= frame < keys[lo+1].frame
    let lo = 0
    let hi = keys.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (keys[mid].frame <= frame) lo = mid
      else hi = mid
    }
    const a = keys[lo]
    const b = keys[hi]
    if (a.interp === 'bezier') {
      // bezier 键缺手柄时按水平自动
      // 切线补齐（出/入手柄默认在段 1/3 处、y=端点值；两端都缺即 smoothstep），
      // 不是 linear 回退。三个无手柄段（32-65 / 159-177 / 177-199）拟合误差 <1e-3。
      const span = b.frame - a.frame
      _autoOut.x = a.frame + span / 3
      _autoOut.y = a.value
      _autoIn.x = b.frame - span / 3
      _autoIn.y = b.value
      _tmpA.frame = a.frame
      _tmpA.value = a.value
      _tmpA.interp = a.interp
      _tmpA.id = a.id
      _tmpA.inHandle = a.inHandle
      _tmpA.outHandle = a.outHandle ?? _autoOut
      _tmpB.frame = b.frame
      _tmpB.value = b.value
      _tmpB.interp = b.interp
      _tmpB.id = b.id
      _tmpB.inHandle = b.inHandle ?? _autoIn
      _tmpB.outHandle = b.outHandle
      return evalBezierSegment(_tmpA, _tmpB, frame)
    }
    const span = b.frame - a.frame
    const t = span > 0 ? (frame - a.frame) / span : 0
    return a.value + (b.value - a.value) * t
  }

  /**
   * 把 fromId 的全部曲线拷到 toId：新曲线 id、新 key id。
   * mapKey 可在拷贝时改值（例如套变换增量）。不改源曲线。
   */
  copyNode(
    fromId: string,
    toId: string,
    mapKey?: (key: FCurveKey, curve: FCurve) => FCurveKey,
  ): void {
    const source = this.byNode.get(fromId)
    if (!source || fromId === toId) return
    let destProps = this.byNode.get(toId)
    if (!destProps) {
      destProps = new Map()
      this.byNode.set(toId, destProps)
    }
    for (const [propPath, byIndex] of source) {
      let destIndex = destProps.get(propPath)
      if (!destIndex) {
        destIndex = new Map()
        destProps.set(propPath, destIndex)
      }
      for (const [index, curve] of byIndex) {
        if (destIndex.has(index)) {
          this.curveCount = Math.max(0, this.curveCount - 1)
        }
        destIndex.set(index, {
          id: `fc_node_${toId}_${propPath.replace(/\./g, '_')}_${index}`,
          nodeId: toId,
          propPath,
          index,
          keys: curve.keys.map((key) => {
            const cloned: FCurveKey = {
              frame: key.frame,
              value: key.value,
              interp: key.interp,
              id: genKeyId(),
              inHandle: key.inHandle ? { ...key.inHandle } : null,
              outHandle: key.outHandle ? { ...key.outHandle } : null,
            }
            return mapKey ? mapKey(cloned, curve) : cloned
          }),
        })
        this.curveCount++
      }
    }
  }

  /** 去掉某节点的全部曲线（删角色/机位时清轨道，curveCount 同步减） */
  removeNode(nodeId: string): void {
    const byProp = this.byNode.get(nodeId)
    if (!byProp) return
    let n = 0
    for (const byIndex of byProp.values()) n += byIndex.size
    this.byNode.delete(nodeId)
    this.curveCount = Math.max(0, this.curveCount - n)
  }

  /** 去掉某节点若干属性路径上的曲线（点机位时清旧 position/lookAt/fov，避免 overlay 把新机位拽回去） */
  removeTracks(nodeId: string, propPaths: string[]): void {
    const byProp = this.byNode.get(nodeId)
    if (!byProp) return
    for (const path of propPaths) {
      const byIndex = byProp.get(path)
      if (!byIndex) continue
      this.curveCount = Math.max(0, this.curveCount - byIndex.size)
      byProp.delete(path)
    }
    if (byProp.size === 0) this.byNode.delete(nodeId)
  }

  /**
   * 删除某属性路径在指定帧（严格相等）的关键帧：所有分量曲线同帧一起删，
   * 返回删除的键数。删空的曲线/属性路径/节点壳一并清掉，避免落盘留下 k:[]。
   */
  removeKeysAtFrame(nodeId: string, propPath: string, frame: number): number {
    const byProp = this.byNode.get(nodeId)
    const byIndex = byProp?.get(propPath)
    if (!byProp || !byIndex) return 0
    let removed = 0
    for (const [index, curve] of byIndex) {
      const before = curve.keys.length
      curve.keys = curve.keys.filter((k) => k.frame !== frame)
      removed += before - curve.keys.length
      if (curve.keys.length === 0) {
        byIndex.delete(index)
        this.curveCount = Math.max(0, this.curveCount - 1)
      }
    }
    if (byIndex.size === 0) {
      byProp.delete(propPath)
      if (byProp.size === 0) this.byNode.delete(nodeId)
    }
    return removed
  }

  /** 节点的全部曲线（UI 列轨道用） */
  tracksForNode(nodeId: string): FCurve[] {
    const out: FCurve[] = []
    for (const byIndex of this.byNode.get(nodeId)?.values() ?? []) {
      for (const c of byIndex.values()) out.push(c)
    }
    return out
  }

  /** 某轨道（单分量）的关键帧列表（UI 画菱形用） */
  keyframesForTrack(
    nodeId: string,
    propPath: string,
    index: number,
  ): { frame: number; value: number }[] {
    const curve = this.findCurve(nodeId, propPath, index)
    if (!curve) return []
    return curve.keys.map((k) => ({ frame: k.frame, value: k.value }))
  }

  /**
   * 某属性路径的所有分量曲线是否全程无真实变化（平台）。
   * 用于判断派生路径的 path-tangent yaw 是否还让位给 fcurve。
   */
  trackIsFlat(nodeId: string, propPath: string, eps = 1e-3): boolean {
    const byIndex = this.byNode.get(nodeId)?.get(propPath)
    if (!byIndex || byIndex.size === 0) return false
    for (const c of byIndex.values()) {
      let min = Infinity
      let max = -Infinity
      for (const k of c.keys) {
        if (k.value < min) min = k.value
        if (k.value > max) max = k.value
      }
      if (max - min > eps) return false
    }
    return true
  }

  encode(): CompactFCurvesJson {
    const fcurves: unknown[] = []
    for (const byProp of this.byNode.values()) {
      for (const byIndex of byProp.values()) {
        for (const curve of byIndex.values()) {
          fcurves.push({
            id: curve.id,
            t: ['node', curve.nodeId],
            p: curve.propPath,
            i: curve.index,
            k: curve.keys.map((key) => {
              const row: unknown[] = [key.frame, key.value, key.interp, key.id]
              if (key.inHandle || key.outHandle) {
                row.push(key.inHandle)
                row.push(key.outHandle)
              }
              return row
            }),
          })
        }
      }
    }
    return { version: 1, encoding: 'compact-v1', fcurves }
  }

  /**
   * 落盘：官方 compact-v1 曲线原样保留（不把用户键烘焙进去，避免改 walk / 删键无法撤回）。
   * 时间线「位移 / 旋转 / 缩放」读的是 userKeys 覆写层，非空时挂在 sidecar，加载后再灌回去。
   */
  static persist(
    fcurves: FCurveSet | null | undefined,
    userKeys: UserKeys,
  ): CompactFCurvesJson {
    const overlay = FCurveSet.parseUserKeys({ userKeys })
    const encoded =
      fcurves && fcurves.curveCount > 0
        ? fcurves.encode()
        : { version: 1 as const, encoding: 'compact-v1' as const, fcurves: [] }
    if (Object.keys(overlay).length === 0) return encoded
    return { ...encoded, userKeys: overlay }
  }

  /** 从 compact-v1 JSON 取出时间线覆写层（缺省 / 损坏则空对象）。 */
  static parseUserKeys(json: unknown): UserKeys {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
    const raw = (json as { userKeys?: unknown }).userKeys
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: UserKeys = {}
    for (const [nodeId, props] of Object.entries(raw as Record<string, unknown>)) {
      if (!nodeId || !props || typeof props !== 'object' || Array.isArray(props)) continue
      const node: NonNullable<UserKeys[string]> = {}
      for (const prop of USER_KEY_PROPS) {
        const keys = (props as Record<string, unknown>)[prop]
        if (!Array.isArray(keys)) continue
        const parsed: Keyframe[] = []
        for (const item of keys) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue
          const rec = item as Record<string, unknown>
          if (!Array.isArray(rec.value)) continue
          const frame = Math.round(Number(rec.frame))
          if (!Number.isFinite(frame)) continue
          parsed.push({
            id: String(rec.id ?? ''),
            frame,
            value: rec.value.map((v) => {
              const n = Number(v)
              return Number.isFinite(n) ? n : 0
            }),
            interpolation: (() => {
              const raw = String(rec.interpolation ?? 'linear')
              if (
                raw === 'smooth' ||
                raw === 'ease-in-out' ||
                raw === 'ease-in' ||
                raw === 'ease-out' ||
                raw === 'linear'
              ) {
                return raw
              }
              return 'linear'
            })(),
          })
        }
        if (parsed.length) node[prop] = parsed
      }
      if (Object.keys(node).length) out[nodeId] = node
    }
    return out
  }

  /**
   * 用户关键帧层（userKeys）→ 官方 compact-v1 fcurves JSON。
   * 格式：
   *   曲线 id `fc_node_<nodeId>_<propPath 点转下划线>_<分量>`；
   *   关键帧 [帧, 值, 插值, kfId, 入手柄?, 出手柄?]，手柄缺省 = 运行时自动水平切线；
   *   我们的 smooth（smoothstep）与官方「bezier 无手柄」运行时行为一致 → 映射为 bezier 无手柄；
   *   linear → linear。rotation 单位保持「度」（与官方一致，由消费方转弧度）。
   */
  static encodeUserKeys(userKeys: UserKeys): CompactFCurvesJson {
    const PROP_PATH: Record<TrackProp, string> = {
      position: 'transform.position',
      rotation: 'transform.rotation',
      scale: 'transform.scale',
      lookAt: 'camera.lookAt',
      fov: 'camera.fov',
    }
    const kfId = () =>
      `kf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const fcurves: unknown[] = []
    for (const [nodeId, props] of Object.entries(userKeys)) {
      for (const [prop, keys] of Object.entries(props) as [TrackProp, Keyframe[]][]) {
        if (!keys || keys.length === 0) continue
        const p = PROP_PATH[prop]
        const components = prop === 'fov' ? 1 : 3
        const sorted = [...keys].sort((a, b) => a.frame - b.frame)
        for (let i = 0; i < components; i++) {
          fcurves.push({
            id: `fc_node_${nodeId}_${p.replace(/\./g, '_')}_${i}`,
            t: ['node', nodeId],
            p,
            i,
            k: sorted.map((k) => [
              k.frame,
              k.value[i] ?? 0,
              k.interpolation === 'linear' ? 'linear' : 'bezier',
              kfId(),
            ]),
          })
        }
      }
    }
    return { version: 1, encoding: 'compact-v1', fcurves }
  }
}

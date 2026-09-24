// 运镜烘焙器：「点击运镜 → 草稿数据」的转换。
//
// 流程：preset + config(defaultConfig 合并) + context（相机当前状态 / 目标 / 场景）
//   → 按 recipe.type 烘焙出相机姿态序列（timeMs + position + lookAt + fov + rollDeg）
//   → toCurves() 转成 7 条曲线（camera.position xyz / camera.lookAt xyz / camera.lens.fov，
//     有 roll 时加 camera.rollDeg），毫秒域
//   → buildClip() 包装成 CameraMotionClip（frameStart=当前帧，frameEnd=当前帧+时长换算帧数）
//
// 与原版的对应关系：
//   T()=resolveCameraState  A()=lerpPoses  C()=toCurves  S()=bakeTranslate
//   M()=translatePose  I()=bakeLinePath(64 采样，source 见 linePathSource)
//   k()=sampled(96 采样，曲线标 linear，带 source)  P()=contextScale(恒 4)
//   R()=targetPoint  N()=hashRand  hH()=pathObj
// 已实证对齐（2026-09-11 真实草稿对照，camera_5 点击「镜头前推」）：
//   - translate 位移 = distance × 4（scene.boundsRadius 硬编码），与视距无关
//   - 2 关键帧 bezier / 采样类 linear；曲线 id `<preset>:position-x` 等；
//     无 warning 时省略 warnings 字段；确定性 recipe 无 source 字段
// 已知有意简化（标注 warning）：
//   - tracking 系（follow/leading/profile）：目标位置沿其 pathMotionClip 折线采样，
//     无路径时目标静止（等价于原版的 fallback 方向）
//   - rack_focus：secondaryTarget 用当前选中角色近似
//   - fpv：沿目标路径折线（原版 preferCurve 平滑曲线）
//   - shake：原版 seed=Date.now() 每次随机，我们用固定 seed=1 换可复现
//   - 有选中目标时原版 contextScale=目标包围半径，我们无此数据，统一用 4
import type {
  BakedCurve,
  CameraMotionClip,
  CurveKeyframe,
  DirectorDocument,
  DraftNode,
  Vec3,
} from '../../contract/types'
import type { CameraMotionPreset, CameraPreset } from '../../data/cameraLibrary'
import { evaluatePathMotion } from '../path/samplePath'
import { resolveSubjectCameraPose, subjectYawDeg, type CameraSubjectBinding } from './subjectBinding'

// ---------- 向量工具（对应模块 674909：WG/pP/Wm/n0/qF/nT/gG/lQ/Qd/Wo/zR/N/KP） ----------

const UP: Vec3 = { x: 0, y: 1, z: 0 } // v.KP

const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const vNorm = (a: Vec3): Vec3 => {
  const l = vLen(a)
  return l > 1e-9 ? vScale(a, 1 / l) : { x: 0, y: 0, z: 0 }
}
const vDist = (a: Vec3, b: Vec3): number => vLen(vSub(a, b))
const vLerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** 绕轴旋转（Rodrigues），角度单位度 —— v.nT */
function vRotateAxis(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const k = vNorm(axis)
  const th = (deg * Math.PI) / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)
  const term1 = vScale(v, cos)
  const term2 = vScale(vCross(k, v), sin)
  const term3 = vScale(k, vDot(k, v) * (1 - cos))
  return vAdd(vAdd(term1, term2), term3)
}

interface Basis {
  forward: Vec3
  right: Vec3
  up: Vec3
}

/** 由 position/lookAt/sceneUp 构建相机基 —— v.gG */
function cameraBasis(position: Vec3, lookAt: Vec3, sceneUp: Vec3 = UP): Basis {
  const forward = vNorm(vSub(lookAt, position))
  let right = vNorm(vCross(forward, sceneUp))
  if (vLen(right) < 1e-6) right = { x: 1, y: 0, z: 0 } // 正对正上/正下时的兜底
  const up = vCross(right, forward)
  return { forward, right, up }
}

/** 局部向量 → 世界（basis 为列）—— v.lQ */
function localToWorld(local: Vec3, b: Basis): Vec3 {
  return vAdd(vAdd(vScale(b.right, local.x), vScale(b.up, local.y)), vScale(b.forward, local.z))
}

// ---------- 缓动（对应模块 383903 的 y.n(easing, u)，u∈[0,1]） ----------

export function easeValue(easing: string | undefined, u: number): number {
  const t = clamp(u, 0, 1)
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in-out':
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
}

// ---------- 烘焙上下文 ----------

export interface BakeContext {
  /** 目标相机节点（当前状态从节点静态机位取） */
  cameraNode: DraftNode
  /** 选中角色作为运镜目标（可选，按 preset.targetPolicy 要求） */
  targetNode?: DraftNode | null
  doc: DirectorDocument
}

interface CamState {
  timeMs: number
  position: Vec3
  lookAt: Vec3
  fov: number
  rollDeg?: number
}

interface MergedConfig {
  durationMs: number
  easing: string
  strength: number
  /** 旧草稿可能仍带此字段；转幅只认 recipe.yawDeg / pitchDeg。 */
  angleDeg?: number
  distance?: number
  fovDelta?: number
  height?: number
  keyframeCount?: number
  shakeAmplitude?: number
  rollDeg?: number
}

/** T()：相机当前状态（fov 钳 18–85） */
function resolveCameraState(ctx: BakeContext): CamState {
  const n = ctx.cameraNode
  return {
    timeMs: 0,
    position: { ...n.transform.position },
    lookAt: { ...(n.camera?.lookAt ?? { x: 0, y: 1.2, z: 0 }) },
    fov: clamp(n.camera?.fov ?? 50, 18, 85),
    rollDeg: undefined,
  }
}

/** 目标点：选中角色胸口高度（position + 1.2y），否则相机 lookAt —— R() */
function targetPoint(ctx: BakeContext): Vec3 {
  if (ctx.targetNode) {
    const p = ctx.targetNode.transform.position
    return { x: p.x, y: p.y + 1.2, z: p.z }
  }
  return ctx.cameraNode.camera?.lookAt ?? { x: 0, y: 1.2, z: 0 }
}

/** 场景尺度 —— P()。
 * 原版：target?.boundsRadius ?? occluder?.boundsRadius ?? scene.boundsRadius ?? 相机到目标距离 ?? 1。
 * 官方 App 构建 context 时 scene.boundsRadius 硬编码为 4（main.js 模块 118198 调用处实测），
 * 所以无目标包围半径时恒为 4 —— 已由真实草稿实证：dolly/crane/truck 位移 = distance(0.8) × 4 = 3.2m，
 * 与相机到 lookAt 距离（5.07）无关。我们的节点模型没有 boundsRadius，统一返回 4。 */
function contextScale(_ctx: BakeContext): number {
  return 4
}

/** 确定性伪随机 —— N() */
function hashRand(seed: number, i: number, channel: number): number {
  const s = Math.sin((seed + 1) * 12.9898 + (i + 1) * 78.233 + 37.719 * channel)
  return s - Math.trunc(s)
}

// ---------- 姿态序列生成 ----------

/** A()：两姿态按 easing 插值出 keyframeCount（默认 2）个姿态；时间轴不缓动 */
function lerpPoses(a: CamState, b: CamState, cfg: MergedConfig): CamState[] {
  const count = Math.max(2, Math.round(cfg.keyframeCount ?? 2))
  return Array.from({ length: count }, (_, i) => {
    const u = count <= 1 ? 0 : i / (count - 1)
    const s = easeValue(cfg.easing, u)
    const hasRoll = a.rollDeg !== undefined || b.rollDeg !== undefined
    return {
      timeMs: lerp(0, cfg.durationMs, u),
      position: vLerp(a.position, b.position, s),
      lookAt: vLerp(a.lookAt, b.lookAt, s),
      fov: lerp(a.fov, b.fov, s),
      rollDeg: hasRoll ? lerp(a.rollDeg ?? 0, b.rollDeg ?? 0, s) : undefined,
    }
  })
}

/** M()：把姿态沿「相机局部方向 × 距离」平移；lockLookAt 时看向目标点 */
function translatePose(
  state: CamState,
  ctx: BakeContext,
  localDir: Vec3,
  dist: number,
  lockLookAt: boolean,
): CamState {
  const b = cameraBasis(state.position, state.lookAt)
  const offset = vScale(localToWorld(localDir, b), dist)
  return {
    ...state,
    position: vAdd(state.position, offset),
    lookAt: lockLookAt ? targetPoint(ctx) : vAdd(state.lookAt, offset),
  }
}

/** S()：translate recipe —— world 空间沿 localOffset，否则相机局部空间 */
function bakeTranslate(
  recipe: NonNullable<CameraMotionPreset['recipe']>,
  ctx: BakeContext,
  cfg: MergedConfig,
): CamState[] {
  const start = resolveCameraState(ctx)
  const scale = contextScale(ctx)
  const n = Math.max(cfg.distance ?? 1, 0) * scale
  const off = recipe.localOffset ?? { x: 0, y: 0, z: 1 }
  const dir =
    recipe.targetSpace === 'world'
      ? vScale(vNorm(off), 1) // world：localOffset 即世界方向
      : localToWorld(off, cameraBasis(start.position, start.lookAt))
  const offset = vScale(dir, n)
  const end: CamState = {
    ...start,
    position: vAdd(start.position, offset),
    lookAt: recipe.lockTarget ? targetPoint(ctx) : vAdd(start.lookAt, offset),
  }
  return lerpPoses(start, end, cfg)
}

/** I()：两姿态间直线 64 采样（easing 逐样本施加，曲线标 linear） */
function bakeLinePath(a: CamState, b: CamState, cfg: MergedConfig): CamState[] {
  const N_SAMPLE = 64
  return Array.from({ length: N_SAMPLE }, (_, i) => {
    const u = i / (N_SAMPLE - 1)
    const s = easeValue(cfg.easing, u)
    const hasRoll = a.rollDeg !== undefined || b.rollDeg !== undefined
    return {
      timeMs: lerp(0, cfg.durationMs, u),
      position: vLerp(a.position, b.position, s),
      lookAt: vLerp(a.lookAt, b.lookAt, s),
      fov: lerp(a.fov, b.fov, s),
      rollDeg: hasRoll ? lerp(a.rollDeg ?? 0, b.rollDeg ?? 0, s) : undefined,
    }
  })
}

/** 原版 I() 写入的 source（type:"path"，两点直线段） */
function linePathSource(a: CamState, b: CamState, cfg: MergedConfig): Record<string, unknown> {
  return {
    easing: cfg.easing,
    fovEnd: b.fov,
    fovStart: a.fov,
    lookAt: { path: pathObj([a.lookAt, b.lookAt]), type: 'curve' },
    positionPath: pathObj([a.position, b.position]),
    rollDeg: a.rollDeg ?? b.rollDeg,
    type: 'path',
  }
}

/** orbit：绕目标点（lookAt）旋转 yawDeg，可带 heightDelta / radiusDelta，96 采样。
 *  原版 k() 会随曲线一起写 source 描述对象（type:"orbit"），这里一并返回。 */
function bakeOrbit(
  recipe: NonNullable<CameraMotionPreset['recipe']>,
  ctx: BakeContext,
  cfg: MergedConfig,
): { poses: CamState[]; source: Record<string, unknown> } {
  const start = resolveCameraState(ctx)
  // 原版 orbit 预设 pivot="look-at"：绕当前看点旋转
  const pivot = start.lookAt
  const scale = contextScale(ctx)
  const yawDeg = recipe.yawDeg ?? 0
  const heightDelta = (cfg.height ?? recipe.heightDelta ?? 0) * scale
  const radiusDelta = (recipe.radiusDelta ?? 0) * scale
  const startOffset = vSub(start.position, pivot)
  const startRadius = Math.max(vLen(startOffset), 0.001)
  const N_SAMPLE = 96
  const poses = Array.from({ length: N_SAMPLE }, (_, i) => {
    const u = i / (N_SAMPLE - 1)
    const s = easeValue(cfg.easing, u)
    const rotated = vRotateAxis(startOffset, UP, yawDeg * s)
    const radius = startRadius + radiusDelta * s
    const scaled = vScale(vNorm(rotated), radius)
    const pos = vAdd(vAdd(pivot, scaled), vScale(UP, heightDelta * s))
    return {
      timeMs: lerp(0, cfg.durationMs, u),
      position: pos,
      lookAt: { ...pivot },
      fov: start.fov,
      rollDeg: start.rollDeg,
    }
  })
  // 与原版 k() 写入的 source 同构（字段顺序无关，undefined 序列化时自动省略）
  const source = {
    axis: { ...UP },
    easing: cfg.easing,
    fov: start.fov,
    heightDelta,
    lookAtTarget: { ...pivot },
    pivot: { ...pivot },
    radiusDelta,
    rollDeg: start.rollDeg,
    startLookAt: { ...start.lookAt },
    startPosition: { ...start.position },
    type: 'orbit',
    yawDeg,
  }
  return { poses, source }
}

/** shake（手持）：静态底片 + 确定性噪声，keyframeCount（≥8）个关键帧 */
function bakeShake(
  recipe: NonNullable<CameraMotionPreset['recipe']>,
  ctx: BakeContext,
  cfg: MergedConfig,
): CamState[] {
  const start = resolveCameraState(ctx)
  const count = Math.max(8, Math.round(cfg.keyframeCount ?? 12))
  const Q = (cfg.shakeAmplitude ?? recipe.amplitude ?? 0.04) * contextScale(ctx)
  // 原版 seed = context.seed = Date.now()（每次点击结果都不同，无法逐值对齐）；
  // 我们用固定 seed=1 换可复现性，波形公式与系数与原版一致
  const seed = 1
  return Array.from({ length: count }, (_, i) => {
    const u = count <= 1 ? 0 : i / (count - 1)
    const n1 = hashRand(seed, i, 1) * Q
    const n2 = hashRand(seed, i, 2) * Q * 0.5
    const n3 = hashRand(seed, i, 3) * Q * 0.35
    const n4 = hashRand(seed, i, 4) * Q * 0.4
    return {
      timeMs: lerp(0, cfg.durationMs, u),
      position: vAdd(start.position, { x: n1, y: n2, z: n3 }),
      lookAt: vAdd(start.lookAt, { x: n4, y: -0.3 * n4, z: 0 }),
      fov: start.fov,
      rollDeg: hashRand(seed, i, 5) * (cfg.rollDeg ?? 1.2),
    }
  })
}

/** 目标位置随时间采样：目标有重叠的 pathMotionClip 时沿折线路径走，否则静止 */
function makeTargetSampler(
  ctx: BakeContext,
  frameStart: number,
  durationMs: number,
): ((u: number) => Vec3) | null {
  const tn = ctx.targetNode
  if (!tn) return null
  const anim = ctx.doc.content.timeline.animation
  const fps = ctx.doc.content.timeline.fps
  const frameEnd = frameStart + Math.round((durationMs * fps) / 1000)
  const clip = anim.pathMotionClips.find(
    (c) => c.target.nodeId === tn.id && c.frameEnd >= frameStart && c.frameStart <= frameEnd,
  )
  const pathNode = clip
    ? ctx.doc.content.nodes.find((n) => n.id === clip.pathNodeId)
    : undefined
  const base = tn.transform.position
  if (!clip || !pathNode) {
    const p = { x: base.x, y: base.y + 1.2, z: base.z }
    return () => ({ ...p })
  }
  return (u: number) => {
    const f = frameStart + u * (frameEnd - frameStart)
    const res = evaluatePathMotion(pathNode, clip, f)
    const p = res?.position ?? base
    return { x: p.x, y: p.y + 1.2, z: p.z }
  }
}

/** 原版 hH()：点列 → 路径对象（2 点 line / 多点 polyline / preferCurve 且 ≥3 点 catmullRom） */
function pathObj(points: Vec3[], preferCurve = false): Record<string, unknown> {
  let curve = 'line'
  if (preferCurve && points.length >= 3) curve = 'catmullRom'
  else if (points.length > 2) curve = 'polyline'
  return { closed: undefined, curve, points: points.map((p) => ({ ...p })), tension: 0.5 }
}

/** 目标在 frameStart 附近重叠的 pathMotionClip 的原始路径点（无则 null） */
function targetPathPoints(
  ctx: BakeContext,
  frameStart: number,
  durationMs: number,
): { timeRatio?: number; position: Vec3 }[] | null {
  const tn = ctx.targetNode
  if (!tn) return null
  const anim = ctx.doc.content.timeline.animation
  const fps = ctx.doc.content.timeline.fps
  const frameEnd = frameStart + Math.round((durationMs * fps) / 1000)
  const clip = anim.pathMotionClips.find(
    (c) => c.target.nodeId === tn.id && c.frameEnd >= frameStart && c.frameStart <= frameEnd,
  )
  const pathNode = clip ? ctx.doc.content.nodes.find((n) => n.id === clip.pathNodeId) : undefined
  const pts = pathNode?.path?.points
  return clip && pathNode && pts && pts.length >= 2 ? pts : null
}

/** target-tracking（follow/leading/profile）：相机保持相对目标的偏移，96 采样。
 *  原版 k() 会写 source（type:"target-tracking"），一并返回。 */
function bakeTracking(
  pathKind: string,
  ctx: BakeContext,
  cfg: MergedConfig,
  frameStart: number,
): { poses: CamState[]; source: Record<string, unknown> } {
  const start = resolveCameraState(ctx)
  const target0 = targetPoint(ctx)
  const scale = contextScale(ctx)
  const m = Math.max(vDist(start.position, target0), Math.max(cfg.distance ?? 1, 0.001) * scale)
  const h = Number.isFinite(start.position.y - target0.y) ? start.position.y - target0.y : 0
  const offset: Vec3 =
    pathKind === 'leading'
      ? { x: 0, y: h, z: m }
      : pathKind === 'profile'
        ? { x: m, y: h, z: 0 }
        : { x: 0, y: h, z: -m }
  // 原版目标朝向基 S：目标路径 ≥2 点时用「末点-首点」切线，否则用 相机→目标 方向（兜底 {0,0,-1}）
  const pathPts = targetPathPoints(ctx, frameStart, cfg.durationMs)
  const rawFwd = pathPts
    ? vSub(pathPts[pathPts.length - 1].position, pathPts[0].position)
    : vSub(target0, start.position)
  const fwd = vLen(rawFwd) > 1e-9 ? vNorm(rawFwd) : { x: 0, y: 0, z: -1 }
  const basis = cameraBasis({ x: 0, y: 0, z: 0 }, fwd)
  const sampler = makeTargetSampler(ctx, frameStart, cfg.durationMs)
  const lookOffsetWorld = vSub(start.lookAt, target0)
  const lookOffsetLocal: Vec3 = {
    x: vDot(lookOffsetWorld, basis.right),
    y: vDot(lookOffsetWorld, basis.up),
    z: vDot(lookOffsetWorld, basis.forward),
  }
  const N_SAMPLE = 96
  const poses = Array.from({ length: N_SAMPLE }, (_, i) => {
    const u = i / (N_SAMPLE - 1)
    const s = easeValue(cfg.easing, u)
    const tp = sampler ? sampler(s) : target0
    const pos = vAdd(tp, localToWorld(offset, basis))
    const look = vAdd(tp, localToWorld(lookOffsetLocal, basis))
    return { timeMs: lerp(0, cfg.durationMs, u), position: pos, lookAt: look, fov: start.fov }
  })
  const mode = pathKind === 'leading' ? 'leading' : pathKind === 'profile' ? 'profile' : 'follow'
  const target =
    ctx.targetNode && ctx.targetNode.id
      ? { type: 'node', nodeId: ctx.targetNode.id }
      : { type: 'point', point: target0 }
  const source = {
    basisFallback: { forward: fwd, up: { ...UP } },
    fov: start.fov,
    lookAtOffset: lookOffsetLocal,
    mode,
    offset,
    rollDeg: start.rollDeg,
    target,
    targetFallback: { forward: fwd, position: target0, up: { ...UP } },
    type: 'target-tracking',
  }
  return { poses, source }
}

/** fpv 穿越：沿目标路径飞行（折线近似），lookAt 看向前方。
 *  原版 k() 写 source（type:"path"，lookAt 为 path-ahead），一并返回。 */
function bakeFpv(
  ctx: BakeContext,
  cfg: MergedConfig,
  frameStart: number,
): { poses: CamState[]; source: Record<string, unknown> } | null {
  const pts = targetPathPoints(ctx, frameStart, cfg.durationMs)
  if (!pts) return null // 走 push-through 兜底
  const start = resolveCameraState(ctx)
  // arc-length 轨迹的点不带 timeRatio，数组顺序即路径顺序（排序退化为稳定 no-op）
  const sorted = [...pts].sort((a, b) => (a.timeRatio ?? 0) - (b.timeRatio ?? 0))
  const N_SAMPLE = 96
  const posAt = (u: number): Vec3 => {
    const i = Math.min(sorted.length - 2, Math.floor(u * (sorted.length - 1)))
    const t = u * (sorted.length - 1) - i
    return vLerp(sorted[i].position, sorted[i + 1].position, clamp(t, 0, 1))
  }
  const ahead = 1 / Math.max(4 * sorted.length, 12)
  const poses = Array.from({ length: N_SAMPLE }, (_, i) => {
    const u = i / (N_SAMPLE - 1)
    const s = easeValue(cfg.easing, u)
    const position = posAt(s)
    const lookAt = posAt(clamp(s + ahead, 0, 1))
    return { timeMs: lerp(0, cfg.durationMs, u), position, lookAt, fov: start.fov }
  })
  const source = {
    easing: cfg.easing,
    fovStart: start.fov,
    lookAt: {
      fallbackOffset: vSub(start.lookAt, start.position),
      progressOffset: ahead,
      type: 'path-ahead',
    },
    positionPath: pathObj(sorted.map((p) => p.position), true),
    rollDeg: start.rollDeg,
    type: 'path',
  }
  return { poses, source }
}

// ---------- 姿态序列 → 曲线（C()） ----------

function kfId(prefix: string, i: number): string {
  return `${prefix}:${i}`
}

function toCurves(
  poses: CamState[],
  preset: CameraMotionPreset,
  cfg: MergedConfig,
  approximated: boolean,
): { curves: BakedCurve[]; warnings?: string[] } {
  const interpolation: CurveKeyframe['interpolation'] =
    cfg.easing === 'linear' ? 'linear' : 'bezier'
  // 密集采样（>8 个姿态）按原版 k() 行为：缓动已烘进值，曲线标 linear
  const interp2 = poses.length > 8 ? 'linear' : interpolation
  const build = (
    suffix: string,
    group: BakedCurve['group'],
    dataPath: string,
    arrayIndex: number,
    pick: (p: CamState) => number,
  ): BakedCurve => ({
    id: `${preset.id}:${suffix}`,
    group,
    dataPath,
    arrayIndex,
    extrapolation: 'constant',
    keyframes: poses.map((p, i) => ({
      id: kfId(`${preset.id}:${suffix}`, i),
      time: p.timeMs,
      value: pick(p),
      interpolation: interp2,
    })),
  })
  const curves: BakedCurve[] = [
    build('position-x', 'position', 'camera.position', 0, (p) => p.position.x),
    build('position-y', 'position', 'camera.position', 1, (p) => p.position.y),
    build('position-z', 'position', 'camera.position', 2, (p) => p.position.z),
    build('look-at-x', 'lookAt', 'camera.lookAt', 0, (p) => p.lookAt.x),
    build('look-at-y', 'lookAt', 'camera.lookAt', 1, (p) => p.lookAt.y),
    build('look-at-z', 'lookAt', 'camera.lookAt', 2, (p) => p.lookAt.z),
    build('fov', 'lens', 'camera.lens.fov', 0, (p) => p.fov),
  ]
  if (poses.some((p) => p.rollDeg !== undefined && p.rollDeg !== 0)) {
    curves.push({
      id: `${preset.id}:roll`,
      group: 'rotation',
      dataPath: 'camera.rollDeg',
      arrayIndex: 0,
      extrapolation: 'constant',
      keyframes: poses.map((p, i) => ({
        id: kfId(`${preset.id}:roll`, i),
        time: p.timeMs,
        value: p.rollDeg ?? 0,
        interpolation: interp2,
      })),
    })
  }
  const warnings: string[] = []
  if (approximated) warnings.push('advanced-motion-approximated')
  if (poses.some((p) => p.fov <= 18 || p.fov >= 85)) warnings.push('fov-clamped')
  return { curves, warnings: warnings.length ? warnings : undefined }
}

// ---------- 主入口 ----------

export interface BakeResult {
  ok: boolean
  reason?: string
  clip?: CameraMotionClip
}

export interface CameraPoseSample {
  timeMs: number
  position: Vec3
  lookAt: Vec3
  fov: number
  rollDeg?: number
}

export interface BakePosesResult {
  ok: boolean
  reason?: string
  poses?: CameraPoseSample[]
}

let clipSeq = 1
function rand6(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** targetPolicy 校验（对应原版的 context 校验） */
function checkTargetPolicy(preset: CameraMotionPreset, ctx: BakeContext): string | null {
  switch (preset.targetPolicy) {
    case 'required-look-at':
    case 'required-focus-target':
      return ctx.targetNode ? null : 'missing-target'
    default:
      return null
  }
}

function sampleCameraMotionPoses(
  preset: CameraMotionPreset,
  ctx: BakeContext,
  frameStart: number,
  userConfig?: Partial<MergedConfig>,
): {
  ok: boolean
  reason?: string
  poses?: CamState[]
  cfg?: MergedConfig
  approximated?: boolean
  source?: Record<string, unknown>
} {
  const reason = checkTargetPolicy(preset, ctx)
  if (reason) return { ok: false, reason }

  const cfg: MergedConfig = {
    ...preset.defaultConfig,
    ...userConfig,
    strength: clamp(userConfig?.strength ?? preset.defaultConfig.strength, 0, 1),
  }
  if (!Number.isFinite(cfg.durationMs) || cfg.durationMs <= 0)
    return { ok: false, reason: 'invalid-config' }

  const recipe = preset.recipe
  let poses: CamState[]
  let approximated = false
  let source: Record<string, unknown> | undefined
  const start = resolveCameraState(ctx)

  switch (recipe.type) {
    case 'static': {
      poses = [start, { ...start, timeMs: cfg.durationMs }]
      break
    }
    case 'pan-tilt': {
      const dist = Math.max(vDist(start.position, start.lookAt), 0.001)
      const b = cameraBasis(start.position, start.lookAt)
      const yaw = recipe.yawDeg ?? 0
      const pitch = recipe.pitchDeg ?? 0
      let fwd = vRotateAxis(b.forward, UP, yaw)
      fwd = vRotateAxis(fwd, b.right, pitch)
      const end: CamState = { ...start, lookAt: vAdd(start.position, vScale(fwd, dist)) }
      poses = lerpPoses(start, end, cfg)
      break
    }
    case 'translate': {
      poses = bakeTranslate(recipe, ctx, cfg)
      break
    }
    case 'zoom': {
      const delta = cfg.fovDelta ?? recipe.fovDelta ?? 0
      const end: CamState = { ...start, fov: clamp(start.fov + delta, 18, 85) }
      poses = lerpPoses(start, end, cfg)
      break
    }
    case 'orbit': {
      const r = bakeOrbit(recipe, ctx, cfg)
      poses = r.poses
      source = r.source
      break
    }
    case 'shake': {
      poses = bakeShake(recipe, ctx, cfg)
      approximated = true
      break
    }
    case 'focus-shift': {
      const end: CamState = { ...start, lookAt: targetPoint(ctx) }
      poses = lerpPoses(start, end, cfg)
      approximated = true // 原版也标 advanced-motion-approximated
      break
    }
    case 'path': {
      const kind = recipe.pathKind ?? 'slider-reveal'
      if (kind === 'follow' || kind === 'leading' || kind === 'profile') {
        const r = bakeTracking(kind, ctx, cfg, frameStart)
        poses = r.poses
        source = r.source
        break
      }
      if (kind === 'fpv') {
        const fpv = bakeFpv(ctx, cfg, frameStart)
        if (fpv) {
          poses = fpv.poses
          source = fpv.source
          break
        }
        // 无路径：按原版兜底为 push-through
        const end = translatePose(start, ctx, { x: 0, y: 0, z: 1 }, 1.4 * contextScale(ctx), true)
        poses = bakeLinePath(start, end, cfg)
        source = linePathSource(start, end, cfg)
        approximated = true
        break
      }
      // M() + I() 组合系
      const scale = contextScale(ctx)
      let end: CamState
      switch (kind) {
        case 'slider-reveal':
          end = translatePose(start, ctx, { x: 1, y: 0, z: 0 }, scale, true)
          break
        case 'foreground-wipe':
          end = translatePose(start, ctx, { x: 1, y: 0, z: 0 }, 0.8 * scale, true)
          break
        case 'push-through':
          end = translatePose(start, ctx, { x: 0, y: 0, z: 1 }, 1.4 * scale, true)
          break
        case 'aerial':
          end = {
            ...translatePose(start, ctx, { x: 0.6, y: 0.5, z: -0.25 }, scale, true),
            fov: clamp(start.fov + (cfg.fovDelta ?? 6), 18, 85),
          }
          break
        case 'dive':
          end = translatePose(start, ctx, { x: 0, y: -0.7, z: 0.8 }, scale, true)
          break
        case 'pull-away':
          end = {
            ...translatePose(start, ctx, { x: 0, y: 0.7, z: -1 }, scale, true),
            fov: clamp(start.fov + (cfg.fovDelta ?? 8), 18, 85),
          }
          break
        default:
          return { ok: false, reason: `unsupported-path-kind:${kind}` }
      }
      poses = bakeLinePath(start, end, cfg)
      source = linePathSource(start, end, cfg)
      if (kind === 'aerial' || kind === 'pull-away' || kind === 'push-through' || kind === 'slider-reveal' || kind === 'foreground-wipe' || kind === 'dive') {
        approximated = true
      }
      break
    }
    default:
      return { ok: false, reason: `unsupported-recipe:${(recipe as { type: string }).type}` }
  }

  return { ok: true, poses, cfg, approximated, source }
}

export function bakeCameraMotionPoses(
  preset: CameraMotionPreset,
  ctx: BakeContext,
  frameStart: number,
  userConfig?: Partial<MergedConfig>,
): BakePosesResult {
  const sampled = sampleCameraMotionPoses(preset, ctx, frameStart, userConfig)
  if (!sampled.ok || !sampled.poses) return { ok: false, reason: sampled.reason }
  return { ok: true, poses: sampled.poses }
}

/**
 * 点击运镜 → 烘焙并包装成草稿 clip。
 * frameStart = 当前帧；frameEnd = frameStart + round(durationMs·fps/1000)。
 */
export function bakeCameraMotionClip(
  preset: CameraMotionPreset,
  ctx: BakeContext,
  frameStart: number,
  userConfig?: Partial<MergedConfig>,
): BakeResult {
  const sampled = sampleCameraMotionPoses(preset, ctx, frameStart, userConfig)
  if (!sampled.ok || !sampled.poses || !sampled.cfg) return { ok: false, reason: sampled.reason }

  const { poses, cfg, approximated = false, source } = sampled
  const { curves, warnings } = toCurves(poses, preset, cfg, approximated)
  const fps = ctx.doc.content.timeline.fps
  const spanFrames = Math.max(1, Math.round((cfg.durationMs * fps) / 1000))
  const outerId = `camera_motion_clip_${Date.now().toString(36)}_${rand6()}`
  const motionId = `camera_motion_clip_${clipSeq++}`

  const clip: CameraMotionClip = {
    id: outerId,
    target: { type: 'node', nodeId: ctx.cameraNode.id },
    focusTarget: { type: 'center' },
    frameStart,
    frameEnd: frameStart + spanFrames,
    trimStartMs: 0,
    trimEndMs: cfg.durationMs,
    playback: {
      version: 1,
      speed: 1,
      loop: false,
      loopMode: 'ping-pong',
      baseDurationFrames: spanFrames,
    },
    motion: {
      id: motionId,
      version: 1,
      presetId: preset.id,
      label: preset.name,
      timeUnit: 'millisecond',
      durationMs: cfg.durationMs,
      metadata: {
        generatedAt: Date.now(),
        cameraNodeId: ctx.cameraNode.id,
        targetNodeId: ctx.targetNode?.id,
        // 本次烘焙用的合并参数（defaultConfig + 用户调参），重烘焙时叠加修改
        // —— 注意：官方 metadata 只有 generatedAt/cameraNodeId/targetNodeId/
        //    secondaryTargetNodeId/occluderNodeId，config 是我们为重烘焙额外加的
        config: cfg,
      },
      // 原版：确定性 recipe（C()）无 source；采样类（k()/I()）写 source 描述对象
      source,
      // 原版：无 warning 时整个字段省略（undefined），不写 null
      warnings,
      curves,
    },
  }
  return { ok: true, clip }
}

/** 点击机位 → 把预设写入相机节点（position/rotation/fov/lookAt），与原版「机位即静态相机状态」一致 */
export function applyCameraPresetToNode(node: DraftNode, preset: CameraPreset): void {
  node.transform.position = { ...preset.position }
  node.transform.rotation = { ...preset.rotation }
  if (node.camera) {
    node.camera.fov = preset.fov
    node.camera.lookAt = { ...preset.lookAt }
    // 绝对机位不再跟随任何人物，否则求值时旧绑定会把刚写进去的位置盖掉。
    delete node.camera.subject
  }
}

/**
 * 点击机位 + 选中了人物 → 把预设当成「人物局部机位」写入。
 * 预设本身是按「人物站在原点、朝向本地 +Z」设计的，所以偏移量取
 * `preset.position - preset.lookAt`（水平面）再按人物 yaw 旋转到世界。
 */
export function applyCameraPresetToSubject(node: DraftNode, preset: CameraPreset, subject: DraftNode): void {
  const offset = {
    x: preset.position.x - preset.lookAt.x,
    y: preset.position.y,
    z: preset.position.z - preset.lookAt.z,
  }
  const lookAtOffset = { x: 0, y: preset.lookAt.y, z: 0 }
  const binding: CameraSubjectBinding = {
    nodeId: subject.id,
    distance: Math.hypot(offset.x, offset.z) || 1,
    offset,
    lookAtOffset,
    // 默认不跟随：机位只按人物当前姿态摆一次，之后可以自由拖。
    // 用户在 Inspector 勾上「跟随人物」后才会跟着走。
    follow: false,
    followRotation: true,
    overridesMotion: true,
  }
  const pose = resolveSubjectCameraPose(binding, subject.transform.position, subject.transform.rotation)
  node.transform.position = pose.position
  node.transform.rotation = {
    ...preset.rotation,
    y: preset.rotation.y + subjectYawDeg(subject.transform.rotation),
  }
  if (node.camera) {
    node.camera.fov = preset.fov
    node.camera.lookAt = pose.lookAt
    node.camera.subject = binding
  }
}

/** 机位预设应用时的目标相机：优先激活机位，否则第一台相机 */
export function resolveTargetCamera(doc: DirectorDocument, activeCameraId: string | null): DraftNode | null {
  const cams = doc.content.nodes.filter((n) => n.type === 'camera')
  return cams.find((n) => n.id === activeCameraId) ?? cams[0] ?? null
}

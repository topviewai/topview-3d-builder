// 相机求值：cameraMotionClips 的 7 条烘焙曲线（毫秒域）→ position / lookAt / fov；
// 无 clip 覆盖时回退到节点的静态机位（lookAt 优先于 transform.rotation）。
// 播放时每条 clip 的曲线按绝对值
// 直接求值（不做链式衔接），片段外一律回落静态机位；chained=true 的链式衔接仅作
// 实验模式保留（同一相机的 clip 按 frameStart 排序，第 N 段整体加偏移使首尾相接）。
import type { BakedCurve, CameraMotionClip, DraftNode } from '../../contract/types'
import { sampleCurve } from '../curves/BakedCurve'

export interface CamPose {
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
  clipId: string | null
}

const _rawOut: CamPose = { position: [0, 0, 0], lookAt: [0, 0, 0], fov: 50, clipId: null }
const _evalOut: CamPose = { position: [0, 0, 0], lookAt: [0, 0, 0], fov: 50, clipId: null }

const curveMapCache = new WeakMap<CameraMotionClip, Map<string, BakedCurve>>()

function curveMap(clip: CameraMotionClip): Map<string, BakedCurve> {
  let m = curveMapCache.get(clip)
  if (!m) {
    m = new Map()
    for (const c of clip.motion.curves) m.set(`${c.group}:${c.arrayIndex}`, c)
    curveMapCache.set(clip, m)
  }
  return m
}

// 带 motion.source 的运镜按 source 参数程序化播放，烘焙曲线仅是导出快照；
// 时间映射是「帧比例」而非 fps 毫秒：progress = (frame-frameStart)/(frameEnd-frameStart)，
// 再映射进 trim 毫秒区间。用户在创建运镜后移动过机位时，曲线与 source 会不一致，
// 此刻以 source 为准。
function clipProgress(clip: CameraMotionClip, frame: number): number {
  const span = clip.frameEnd - clip.frameStart
  const p = span > 0 ? (frame - clip.frameStart) / span : 0
  const dur = clip.motion.durationMs
  if (!(dur > 0)) return Math.min(Math.max(p, 0), 1)
  const ms = clip.trimStartMs + p * (clip.trimEndMs - clip.trimStartMs)
  return Math.min(Math.max(ms / dur, 0), 1)
}

/** source.easing='ease-in-out' 是 easeInOutQuad（2t² / 1-2(1-t)²），不是 smoothstep */
function applyEasing(easing: string | undefined, t: number): number {
  switch (easing) {
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    default:
      return t
  }
}

const D2R = Math.PI / 180

/** orbit 类运镜（descending_orbit / ascending_orbit / orbit_180）的程序化求值 */
function proceduralOrbitPose(node: DraftNode, clip: CameraMotionClip, frame: number): boolean {
  const src = clip.motion.source
  if (!src || src.type !== 'orbit' || !src.startPosition || !src.pivot) return false
  const e = applyEasing(src.easing, clipProgress(clip, frame))
  const axis = src.axis ?? { x: 0, y: 1, z: 0 }
  const al = Math.hypot(axis.x, axis.y, axis.z) || 1
  const ax = { x: axis.x / al, y: axis.y / al, z: axis.z / al }
  const v = {
    x: src.startPosition.x - src.pivot.x,
    y: src.startPosition.y - src.pivot.y,
    z: src.startPosition.z - src.pivot.z,
  }
  const dot = v.x * ax.x + v.y * ax.y + v.z * ax.z
  const par = { x: ax.x * dot, y: ax.y * dot, z: ax.z * dot }
  const perp = { x: v.x - par.x, y: v.y - par.y, z: v.z - par.z }
  const ang = (src.yawDeg ?? 0) * e * D2R
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const cross = {
    x: ax.y * perp.z - ax.z * perp.y,
    y: ax.z * perp.x - ax.x * perp.z,
    z: ax.x * perp.y - ax.y * perp.x,
  }
  let rp = {
    x: perp.x * cos + cross.x * sin,
    y: perp.y * cos + cross.y * sin,
    z: perp.z * cos + cross.z * sin,
  }
  const r0 = Math.hypot(perp.x, perp.y, perp.z)
  const rd = src.radiusDelta ?? 0
  if (r0 > 1e-9 && rd !== 0) {
    const k = (r0 + rd * e) / r0
    rp = { x: rp.x * k, y: rp.y * k, z: rp.z * k }
  }
  const hd = (src.heightDelta ?? 0) * e
  _rawOut.position[0] = src.pivot.x + par.x + ax.x * hd + rp.x
  _rawOut.position[1] = src.pivot.y + par.y + ax.y * hd + rp.y
  _rawOut.position[2] = src.pivot.z + par.z + ax.z * hd + rp.z
  const la0 = src.startLookAt ?? { x: 0, y: 1.2, z: 0 }
  const la1 = src.lookAtTarget ?? la0
  _rawOut.lookAt[0] = la0.x + (la1.x - la0.x) * e
  _rawOut.lookAt[1] = la0.y + (la1.y - la0.y) * e
  _rawOut.lookAt[2] = la0.z + (la1.z - la0.z) * e
  _rawOut.fov = src.fov ?? node.camera?.fov ?? 50
  _rawOut.clipId = clip.id
  return true
}

function staticPose(node: DraftNode): CamPose {
  const t = node.transform
  const la = node.camera?.lookAt ?? { x: 0, y: 1.2, z: 0 }
  return {
    position: [t.position.x, t.position.y, t.position.z],
    lookAt: [la.x, la.y, la.z],
    fov: node.camera?.fov ?? 50,
    clipId: null,
  }
}

function writeStaticPose(node: DraftNode, out: CamPose): void {
  const t = node.transform
  const la = node.camera?.lookAt ?? { x: 0, y: 1.2, z: 0 }
  out.position[0] = t.position.x
  out.position[1] = t.position.y
  out.position[2] = t.position.z
  out.lookAt[0] = la.x
  out.lookAt[1] = la.y
  out.lookAt[2] = la.z
  out.fov = node.camera?.fov ?? 50
  out.clipId = null
}

function writeRawClipPose(
  node: DraftNode,
  clip: CameraMotionClip,
  frame: number,
  _fps: number,
  out: CamPose,
): void {
  if (proceduralOrbitPose(node, clip, frame)) {
    out.position[0] = _rawOut.position[0]
    out.position[1] = _rawOut.position[1]
    out.position[2] = _rawOut.position[2]
    out.lookAt[0] = _rawOut.lookAt[0]
    out.lookAt[1] = _rawOut.lookAt[1]
    out.lookAt[2] = _rawOut.lookAt[2]
    out.fov = _rawOut.fov
    out.clipId = _rawOut.clipId
    return
  }
  const speed = clip.playback?.speed ?? 1
  const span = clip.frameEnd - clip.frameStart
  const p = span > 0 ? (frame - clip.frameStart) / span : 0
  // 帧域 → 毫秒域：帧比例映射（frame-frameStart)/(frameEnd-frameStart) × trim 区间，
  // 不是 (帧差/fps)×1000；用户把 clip 拉长/缩短（帧数≠毫秒数）时两者才会分叉
  let ms = clip.trimStartMs + p * (clip.trimEndMs - clip.trimStartMs) * speed
  const trimSpan = clip.trimEndMs - clip.trimStartMs
  if (clip.playback?.loop && trimSpan > 0) {
    ms = clip.trimStartMs + (((ms - clip.trimStartMs) % trimSpan) + trimSpan) % trimSpan
  }
  ms = Math.min(Math.max(ms, clip.trimStartMs), clip.trimEndMs)

  const m = curveMap(clip)
  const s = (group: string, idx: number, fallback: number): number => {
    const c = m.get(`${group}:${idx}`)
    return c ? sampleCurve(c, ms) : fallback
  }
  const t = node.transform
  const staticLa = node.camera?.lookAt ?? { x: 0, y: 1.2, z: 0 }
  out.position[0] = s('position', 0, t.position.x)
  out.position[1] = s('position', 1, t.position.y)
  out.position[2] = s('position', 2, t.position.z)
  out.lookAt[0] = s('lookAt', 0, staticLa.x)
  out.lookAt[1] = s('lookAt', 1, staticLa.y)
  out.lookAt[2] = s('lookAt', 2, staticLa.z)
  out.fov = s('lens', 0, node.camera?.fov ?? 50)
  out.clipId = clip.id
}

/** 单段 clip 的原生（未加链式偏移）求值 */
function rawClipPose(
  node: DraftNode,
  clip: CameraMotionClip,
  frame: number,
  fps: number,
): CamPose {
  writeRawClipPose(node, clip, frame, fps, _rawOut)
  return {
    position: [_rawOut.position[0], _rawOut.position[1], _rawOut.position[2]],
    lookAt: [_rawOut.lookAt[0], _rawOut.lookAt[1], _rawOut.lookAt[2]],
    fov: _rawOut.fov,
    clipId: _rawOut.clipId,
  }
}

interface ChainSeg {
  clip: CameraMotionClip
  /** 该段输出 = 原生值 + offset（position/lookAt 逐分量，fov 标量） */
  offset: { position: [number, number, number]; lookAt: [number, number, number]; fov: number }
  /** 该段末帧（frameEnd）加偏移后的状态 */
  end: { position: [number, number, number]; lookAt: [number, number, number]; fov: number }
}

/** 每台相机的链：WeakMap<clips 数组, WeakMap<节点, 段列表>>（doc 生命周期内稳定） */
const chainCache = new WeakMap<CameraMotionClip[], WeakMap<DraftNode, ChainSeg[]>>()

function buildChain(node: DraftNode, clips: CameraMotionClip[], fps: number): ChainSeg[] {
  const segs = clips
    .filter((c) => c.target.nodeId === node.id)
    .sort((a, b) => a.frameStart - b.frameStart)
  // 链的初始状态 = 节点静态机位；第一段偏移 0（保持原生曲线，回归不变）
  let prev = staticPose(node)
  let first = true
  return segs.map((clip) => {
    const rawFirst = rawClipPose(node, clip, clip.frameStart, fps)
    const rawLast = rawClipPose(node, clip, clip.frameEnd, fps)
    const offset = first
      ? { position: [0, 0, 0] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], fov: 0 }
      : {
          position: [
            prev.position[0] - rawFirst.position[0],
            prev.position[1] - rawFirst.position[1],
            prev.position[2] - rawFirst.position[2],
          ] as [number, number, number],
          lookAt: [
            prev.lookAt[0] - rawFirst.lookAt[0],
            prev.lookAt[1] - rawFirst.lookAt[1],
            prev.lookAt[2] - rawFirst.lookAt[2],
          ] as [number, number, number],
          fov: prev.fov - rawFirst.fov,
        }
    first = false
    const end = {
      position: [
        rawLast.position[0] + offset.position[0],
        rawLast.position[1] + offset.position[1],
        rawLast.position[2] + offset.position[2],
      ] as [number, number, number],
      lookAt: [
        rawLast.lookAt[0] + offset.lookAt[0],
        rawLast.lookAt[1] + offset.lookAt[1],
        rawLast.lookAt[2] + offset.lookAt[2],
      ] as [number, number, number],
      fov: rawLast.fov + offset.fov,
    }
    prev = { ...end, clipId: null }
    return { clip, offset, end }
  })
}

function getChain(node: DraftNode, clips: CameraMotionClip[], fps: number): ChainSeg[] {
  let byNode = chainCache.get(clips)
  if (!byNode) {
    byNode = new WeakMap()
    chainCache.set(clips, byNode)
  }
  let chain = byNode.get(node)
  if (!chain) {
    chain = buildChain(node, clips, fps)
    byNode.set(node, chain)
  }
  return chain
}

export function evaluateCameraPoseInto(
  node: DraftNode,
  clips: CameraMotionClip[],
  frame: number,
  fps: number,
  chained: boolean,
  out: CamPose,
): void {
  const clip = clips.find(
    (c) => c.target.nodeId === node.id && frame >= c.frameStart && frame <= c.frameEnd,
  )
  if (!node.camera) {
    writeStaticPose(node, out)
    return
  }
  if (!chained) {
    if (!clip) writeStaticPose(node, out)
    else writeRawClipPose(node, clip, frame, fps, out)
    return
  }

  const chain = getChain(node, clips, fps)
  if (chain.length === 0) {
    writeStaticPose(node, out)
    return
  }
  if (clip) {
    const seg = chain.find((s) => s.clip === clip)!
    writeRawClipPose(node, clip, frame, fps, out)
    out.position[0] += seg.offset.position[0]
    out.position[1] += seg.offset.position[1]
    out.position[2] += seg.offset.position[2]
    out.lookAt[0] += seg.offset.lookAt[0]
    out.lookAt[1] += seg.offset.lookAt[1]
    out.lookAt[2] += seg.offset.lookAt[2]
    out.fov += seg.offset.fov
    out.clipId = clip.id
    return
  }
  if (frame < chain[0].clip.frameStart) {
    writeStaticPose(node, out)
    return
  }
  let prev = chain[0]
  for (const s of chain) {
    if (s.clip.frameEnd < frame) prev = s
    else break
  }
  out.position[0] = prev.end.position[0]
  out.position[1] = prev.end.position[1]
  out.position[2] = prev.end.position[2]
  out.lookAt[0] = prev.end.lookAt[0]
  out.lookAt[1] = prev.end.lookAt[1]
  out.lookAt[2] = prev.end.lookAt[2]
  out.fov = prev.end.fov
  out.clipId = null
}

export function evaluateCameraPose(
  node: DraftNode,
  clips: CameraMotionClip[],
  frame: number,
  fps: number,
  chained = false,
): CamPose {
  evaluateCameraPoseInto(node, clips, frame, fps, chained, _evalOut)
  return {
    position: [_evalOut.position[0], _evalOut.position[1], _evalOut.position[2]],
    lookAt: [_evalOut.lookAt[0], _evalOut.lookAt[1], _evalOut.lookAt[2]],
    fov: _evalOut.fov,
    clipId: _evalOut.clipId,
  }
}

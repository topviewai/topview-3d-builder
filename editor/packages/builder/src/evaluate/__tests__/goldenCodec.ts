import { createHash } from 'node:crypto'
import type { FrameSnapshot, SceneContract, TransformValue } from '../FrameSnapshot'

export const GOLDEN_PREC = 6
export const SAMPLE_STRIDE = 50

const XF_NAMES = [
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z',
  'lookAt.x', 'lookAt.y', 'lookAt.z',
  'fov',
] as const

export interface GoldenSample {
  frame: number
  camera: string[] | null
  transforms: Record<string, string[]>
  poses: Record<string, Array<[string, string]>>
  motionPlayback: Array<[string, string, string, string]>
}

export interface GoldenFile {
  draft: string
  note: string
  frameStart: number
  frameEnd: number
  hashes: string[]
  samples: GoldenSample[]
}

export function fmtNum(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (n === Infinity) return 'Inf'
  if (n === -Infinity) return '-Inf'
  const s = (Object.is(n, -0) ? 0 : n).toFixed(GOLDEN_PREC)
  return s === '-0.000000' ? '0.000000' : s
}

function xfParts(xf: TransformValue): string[] {
  return [
    fmtNum(xf.position.x), fmtNum(xf.position.y), fmtNum(xf.position.z),
    fmtNum(xf.rotation.x), fmtNum(xf.rotation.y), fmtNum(xf.rotation.z),
    fmtNum(xf.scale.x), fmtNum(xf.scale.y), fmtNum(xf.scale.z),
    fmtNum(xf.lookAt?.x ?? 0), fmtNum(xf.lookAt?.y ?? 0), fmtNum(xf.lookAt?.z ?? 0),
    fmtNum(xf.fov ?? 0),
  ]
}

function cameraParts(snap: FrameSnapshot): string[] | null {
  if (!snap.camera) return null
  const c = snap.camera
  return [
    fmtNum(c.position.x), fmtNum(c.position.y), fmtNum(c.position.z),
    fmtNum(c.lookAt.x), fmtNum(c.lookAt.y), fmtNum(c.lookAt.z),
    fmtNum(c.fov),
  ]
}

export function serializeFrame(snap: FrameSnapshot): string {
  const chunks: string[] = []
  for (const id of [...snap.transforms.keys()].sort()) {
    chunks.push(`t:${id}:${xfParts(snap.transforms.get(id)!).join(',')}`)
  }
  for (const id of [...snap.poses.keys()].sort()) {
    const arr = snap.poses.get(id)
    if (!arr || arr.length === 0) continue
    chunks.push(`p:${id}:${arr.map((p) => `${p.key}=${fmtNum(p.value)}`).join(',')}`)
  }
  for (const c of snap.motionPlayback) {
    chunks.push(`m:${c.nodeId}:${c.clipId}:${fmtNum(c.timeSeconds)}:${fmtNum(c.weight)}`)
  }
  const cam = cameraParts(snap)
  chunks.push(cam ? `c:${cam.join(',')}` : 'c:null')
  return chunks.join('|')
}

export function hashFrame(snap: FrameSnapshot): string {
  return createHash('sha1').update(serializeFrame(snap)).digest('hex')
}

export function buildSample(frame: number, snap: FrameSnapshot): GoldenSample {
  const transforms: Record<string, string[]> = {}
  for (const id of [...snap.transforms.keys()].sort()) {
    transforms[id] = xfParts(snap.transforms.get(id)!)
  }
  const poses: Record<string, Array<[string, string]>> = {}
  for (const id of [...snap.poses.keys()].sort()) {
    const arr = snap.poses.get(id)
    if (!arr || arr.length === 0) continue
    poses[id] = arr.map((p) => [p.key, fmtNum(p.value)])
  }
  return {
    frame,
    camera: cameraParts(snap),
    transforms,
    poses,
    motionPlayback: snap.motionPlayback.map((c) => [
      c.nodeId, c.clipId, fmtNum(c.timeSeconds), fmtNum(c.weight),
    ]),
  }
}

function addBounded(set: Set<number>, frame: number, start: number, end: number): void {
  if (frame >= start && frame <= end) set.add(frame)
}

export function collectSampleFrames(scene: SceneContract): number[] {
  const start = scene.meta.frameStart
  const end = scene.meta.frameEnd
  const set = new Set<number>()
  set.add(start)
  set.add(end)
  const anim = scene.timeline.animation
  const clips = [
    ...anim.cameraMotionClips,
    ...anim.pathMotionClips,
    ...anim.motionClips,
  ]
  for (const clip of clips) {
    addBounded(set, clip.frameStart, start, end)
    addBounded(set, clip.frameEnd - 1, start, end)
    addBounded(set, clip.frameEnd, start, end)
  }
  for (let frame = start; frame <= end; frame += SAMPLE_STRIDE) set.add(frame)
  return [...set].sort((a, b) => a - b)
}

function pushPairDiff(out: string[], label: string, expected: string, actual: string): void {
  if (expected !== actual) out.push(`${label}: expected ${expected} actual ${actual}`)
}

export function diffSamples(draft: string, expected: GoldenSample, actual: GoldenSample): string[] {
  const prefix = `${draft} frame ${expected.frame}`
  const lines: string[] = []
  const expCam = expected.camera
  const actCam = actual.camera
  if (expCam === null || actCam === null) {
    if (expCam !== actCam) lines.push(`${prefix} camera: expected ${expCam === null ? 'null' : 'set'} actual ${actCam === null ? 'null' : 'set'}`)
  } else {
    const names = ['position.x', 'position.y', 'position.z', 'lookAt.x', 'lookAt.y', 'lookAt.z', 'fov']
    for (let i = 0; i < names.length; i++) {
      pushPairDiff(lines, `${prefix} camera.${names[i]}`, expCam[i] ?? '', actCam[i] ?? '')
    }
  }
  const ids = new Set([...Object.keys(expected.transforms), ...Object.keys(actual.transforms)])
  for (const id of [...ids].sort()) {
    const ev = expected.transforms[id]
    const av = actual.transforms[id]
    if (!ev) { lines.push(`${prefix} transforms.${id}: missing in golden`); continue }
    if (!av) { lines.push(`${prefix} transforms.${id}: missing in actual`); continue }
    for (let i = 0; i < XF_NAMES.length; i++) {
      pushPairDiff(lines, `${prefix} ${id} ${XF_NAMES[i]}`, ev[i] ?? '', av[i] ?? '')
    }
  }
  const poseIds = new Set([...Object.keys(expected.poses), ...Object.keys(actual.poses)])
  for (const id of [...poseIds].sort()) {
    const ev = expected.poses[id] ?? []
    const av = actual.poses[id] ?? []
    const n = Math.max(ev.length, av.length)
    for (let i = 0; i < n; i++) {
      const e = ev[i]
      const a = av[i]
      if (!e || !a) {
        lines.push(`${prefix} poses.${id}[${i}]: expected ${e ? e.join('=') : 'missing'} actual ${a ? a.join('=') : 'missing'}`)
        continue
      }
      pushPairDiff(lines, `${prefix} poses.${id}[${i}].key`, e[0], a[0])
      pushPairDiff(lines, `${prefix} poses.${id}[${i}].value`, e[1], a[1])
    }
  }
  const em = expected.motionPlayback
  const am = actual.motionPlayback
  if (em.length !== am.length) {
    lines.push(`${prefix} motionPlayback.length: expected ${em.length} actual ${am.length}`)
  }
  const m = Math.max(em.length, am.length)
  const fields = ['nodeId', 'clipId', 'timeSeconds', 'weight'] as const
  for (let i = 0; i < m; i++) {
    const e = em[i]
    const a = am[i]
    if (!e || !a) {
      lines.push(`${prefix} motionPlayback[${i}]: expected ${e ? e.join('/') : 'missing'} actual ${a ? a.join('/') : 'missing'}`)
      continue
    }
    for (let f = 0; f < fields.length; f++) {
      pushPairDiff(lines, `${prefix} motionPlayback[${i}].${fields[f]}`, e[f], a[f])
    }
  }
  return lines
}

export function formatHashMismatch(input: {
  draft: string
  frame: number
  expectedHash: string
  actualHash: string
  details: string[]
}): string {
  const head = `${input.draft} frame ${input.frame} hash expected ${input.expectedHash} actual ${input.actualHash}`
  if (input.details.length === 0) return head
  return `${head}\n${input.details.join('\n')}`
}

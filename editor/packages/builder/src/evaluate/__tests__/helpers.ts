import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DirectorDocument } from '../../contract/types'
import { FCurveSet } from '../curves/FCurveSet'
import {
  createFrameSnapshot,
  prepareFrameSnapshot,
  type FrameSnapshot,
  type SceneContract,
} from '../FrameSnapshot'
import { evaluateFrame } from '../evaluateFrame'
import { sceneFromDocument } from '../sceneFromDocument'

export const EPS = 1e-9

export function nearly(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) < eps
}

export function samplesDir(): string {
  return join(__dirname, '../../../../../docs/samples')
}

export function loadDraft(name: string): DirectorDocument {
  const path = join(samplesDir(), name)
  return JSON.parse(readFileSync(path, 'utf8')) as DirectorDocument
}

export function loadFcurves(name: string): FCurveSet | null {
  const path = join(samplesDir(), name)
  if (!existsSync(path)) return null
  return FCurveSet.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function sceneOf(doc: DirectorDocument, fcurves: FCurveSet | null = null): SceneContract {
  return sceneFromDocument(doc, {
    fcurves,
    userKeys: {},
    userKeysEnabled: false,
    chainCameraMotion: false,
  })
}

export function evalAt(scene: SceneContract, frame: number, out?: FrameSnapshot): FrameSnapshot {
  const snap = out ?? createFrameSnapshot()
  const ids = scene.nodes.map((n) => n.id)
  prepareFrameSnapshot(snap, ids)
  evaluateFrame(scene, frame, snap)
  return snap
}

export interface SnapClone {
  transforms: Record<string, number[]>
  poses: Record<string, Array<{ key: string; value: number }>>
  motionPlayback: Array<{ nodeId: string; clipId: string; timeSeconds: number; weight: number }>
}

export function cloneNumbers(snap: FrameSnapshot): SnapClone {
  const transforms: Record<string, number[]> = {}
  for (const [id, xf] of snap.transforms) {
    transforms[id] = [
      xf.position.x, xf.position.y, xf.position.z,
      xf.rotation.x, xf.rotation.y, xf.rotation.z,
      xf.scale.x, xf.scale.y, xf.scale.z,
      xf.lookAt?.x ?? 0, xf.lookAt?.y ?? 0, xf.lookAt?.z ?? 0,
      xf.fov ?? 0,
    ]
  }
  const poses: Record<string, Array<{ key: string; value: number }>> = {}
  for (const [id, arr] of snap.poses) {
    if (arr.length === 0) continue
    poses[id] = arr.map((p) => ({ key: p.key, value: p.value }))
  }
  return {
    transforms,
    poses,
    motionPlayback: snap.motionPlayback.map((c) => ({
      nodeId: c.nodeId,
      clipId: c.clipId,
      timeSeconds: c.timeSeconds,
      weight: c.weight,
    })),
  }
}

function assertRecordEqual(
  a: Record<string, number[]>,
  b: Record<string, number[]>,
  label: string,
): void {
  const ids = Object.keys(a)
  if (ids.length !== Object.keys(b).length) {
    throw new Error(`${label}: node count ${ids.length} vs ${Object.keys(b).length}`)
  }
  for (const id of ids) {
    const av = a[id]
    const bv = b[id]
    if (!bv || av.length !== bv.length) throw new Error(`${label}: missing ${id}`)
    for (let i = 0; i < av.length; i++) {
      if (!nearly(av[i], bv[i])) {
        throw new Error(`${label}: ${id}[${i}] ${av[i]} vs ${bv[i]}`)
      }
    }
  }
}

export function assertSnapEqual(a: SnapClone, b: SnapClone, label: string): void {
  assertRecordEqual(a.transforms, b.transforms, `${label} transforms`)
  const poseIds = new Set([...Object.keys(a.poses), ...Object.keys(b.poses)])
  for (const id of poseIds) {
    const av = a.poses[id] ?? []
    const bv = b.poses[id] ?? []
    if (av.length !== bv.length) throw new Error(`${label} poses ${id}: len ${av.length} vs ${bv.length}`)
    for (let i = 0; i < av.length; i++) {
      if (av[i].key !== bv[i].key || !nearly(av[i].value, bv[i].value)) {
        throw new Error(`${label} poses ${id}[${i}]: ${av[i].key}=${av[i].value} vs ${bv[i].key}=${bv[i].value}`)
      }
    }
  }
  if (a.motionPlayback.length !== b.motionPlayback.length) {
    throw new Error(`${label} motionPlayback: len ${a.motionPlayback.length} vs ${b.motionPlayback.length}`)
  }
  for (let i = 0; i < a.motionPlayback.length; i++) {
    const av = a.motionPlayback[i]
    const bv = b.motionPlayback[i]
    if (
      av.nodeId !== bv.nodeId ||
      av.clipId !== bv.clipId ||
      av.weight !== bv.weight ||
      !nearly(av.timeSeconds, bv.timeSeconds)
    ) {
      throw new Error(`${label} motionPlayback[${i}]: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`)
    }
  }
}

/**
 * golden 基线覆盖两种文档形态：
 * - xiaoyunque：旧文档（无 content.editorial），同时是 drafts.test.ts 的冻结检查点
 * - qa-director-full：素材库时代文档（素材 key 为 3d-builder/library/，带 editorial）
 */
export const DRAFT_FILES: { draft: string; fcurves: string | null }[] = [
  { draft: 'xiaoyunque-draft.json', fcurves: 'xiaoyunque-fcurves.json' },
  { draft: 'qa-director-full-draft.json', fcurves: 'qa-director-full-fcurves.json' },
]

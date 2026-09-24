import type { DirectorDocument } from '../../contract/types'
import type { FCurveSet } from '../../evaluate/curves/FCurveSet'
import type { TrackProp, UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { timelinePathClips } from '../../evaluate/path/deriveWalk'
import type { TranslateFn } from '../../locale/types'
import {
  isKeyframeSelected,
  keyframeRefsOf,
  makeKeyframeSelection,
  type KeyframeRef,
  type Selection,
} from '../../stores/types'
import { displayNodeName } from '../displayNames'
import { CAMERA_XFORM_PROPS, NODE_XFORM_PROPS } from './constants'
import type { TimelineRow, TimelineSummary } from './types'

function baseOf(n: DirectorDocument['content']['nodes'][number]) {
  return { nodeId: n.id, nodeName: n.name, nodeType: n.type }
}

function propLabel(t: TranslateFn, prop: TrackProp): string {
  if (prop === 'position') return t('timeline.position')
  if (prop === 'rotation') return t('timeline.rotation')
  if (prop === 'scale') return t('timeline.scale')
  if (prop === 'lookAt') return t('timeline.lookAt')
  return t('timeline.fov')
}

export function collectFrameBundles(
  nodeId: string,
  props: TrackProp[],
  userKeys: UserKeys,
): { frame: number; refs: { nodeId: string; prop: TrackProp; keyId: string }[] }[] {
  const byFrame = new Map<number, { nodeId: string; prop: TrackProp; keyId: string }[]>()
  for (const prop of props) {
    for (const kf of userKeys[nodeId]?.[prop] ?? []) {
      const list = byFrame.get(kf.frame) ?? []
      list.push({ nodeId, prop, keyId: kf.id })
      byFrame.set(kf.frame, list)
    }
  }
  return [...byFrame.entries()]
    .map(([frame, refs]) => ({ frame, refs }))
    .sort((a, b) => a.frame - b.frame)
}

function xformGroup(
  n: DirectorDocument['content']['nodes'][number],
  t: TranslateFn,
  props: TrackProp[],
): TimelineRow {
  return {
    key: `${n.id}:xform`,
    ...baseOf(n),
    label: t('timeline.transform'),
    kind: 'group',
    addTransformKeys: props,
    children: props.map((prop) => ({
      key: `${n.id}:${prop}`,
      ...baseOf(n),
      label: propLabel(t, prop),
      kind: 'kf' as const,
      prop,
    })),
  }
}

function nodeXformGroup(
  n: DirectorDocument['content']['nodes'][number],
  t: TranslateFn,
): TimelineRow {
  return xformGroup(n, t, NODE_XFORM_PROPS)
}

export function selectedTimelineNodeId(
  doc: DirectorDocument,
  selection: Selection | null,
): string | null {
  if (!selection) return null
  if (selection.kind === 'node' || selection.kind === 'keyframe' || selection.kind === 'transformKeyframe') {
    return selection.nodeId
  }
  if (selection.kind === 'timelineBox') {
    if (selection.keys[0]) return selection.keys[0].nodeId
    const ref = selection.clips[0]
    if (!ref) return null
    const list =
      ref.clipType === 'camera'
        ? doc.content.timeline.animation.cameraMotionClips
        : ref.clipType === 'motion'
          ? doc.content.timeline.animation.motionClips
          : doc.content.timeline.animation.pathMotionClips
    return list.find((clip) => clip.id === ref.clipId)?.target.nodeId ?? null
  }
  const clips = selection.clipType === 'camera'
    ? doc.content.timeline.animation.cameraMotionClips
    : selection.clipType === 'motion'
      ? doc.content.timeline.animation.motionClips
      : doc.content.timeline.animation.pathMotionClips
  return clips.find((clip) => clip.id === selection.clipId)?.target.nodeId ?? null
}

/** 点空白处：片段 / 关键帧高亮收回到所属节点，避免片段一直保持选中描边。 */
export function collapseTimelineItemSelection(
  doc: DirectorDocument | null,
  selection: Selection | null,
): Selection | null {
  if (!selection || selection.kind === 'node') return selection
  if (!doc) return null
  const nodeId = selectedTimelineNodeId(doc, selection)
  return nodeId ? { kind: 'node', nodeId } : null
}

/** 相机 / 角色子树；道具与基础形状在有关键帧或走位 clip 时入轨。 */
export function buildTree(
  doc: DirectorDocument,
  t: TranslateFn,
  nodeId?: string | null | readonly string[],
  userKeys?: UserKeys,
): TimelineRow[] {
  const anim = doc.content.timeline.animation
  const cameraRoots: TimelineRow[] = []
  const characterRoots: TimelineRow[] = []
  const propRoots: TimelineRow[] = []

  // 选中道具/基础形状时入轨展示；多选时所有选中的道具/基础形状也都入轨。
  // 取消相机和角色的独显过滤，所有相机与角色常驻全局可见，保持轨道层级与顺序稳定。
  const selectedIds = typeof nodeId === 'string' ? [nodeId] : nodeId ? [...nodeId] : []
  const selectedSet = new Set(selectedIds)
  const selectedNodes = doc.content.nodes.filter((x) => selectedSet.has(x.id))
  const focusIds = new Set(
    selectedNodes.filter((x) => x.type !== 'prop' && x.type !== 'primitive').map((x) => x.id),
  )
  const followerIds = new Set(
    doc.content.nodes
      .filter(
        (x) =>
          x.type === 'camera'
          && x.camera?.subject?.follow
          && x.camera.subject.nodeId
          && focusIds.has(x.camera.subject.nodeId),
      )
      .map((x) => x.id),
  )

  for (const n of doc.content.nodes.filter((x) => x.type === 'camera')) {
    const children: TimelineRow[] = []
    const camClips = anim.cameraMotionClips.filter((c) => c.target.nodeId === n.id)
    if (camClips.length > 0) {
      children.push({
        key: `${n.id}:cam`,
        ...baseOf(n),
        label: t('timeline.cameraMotion'),
        kind: 'clips-camera',
        camClips,
      })
    }
    const camPathClips = timelinePathClips(anim.pathMotionClips, n.id)
    if (camPathClips.length > 0) {
      children.push({
        key: `${n.id}:path`,
        ...baseOf(n),
        label: t('timeline.pathMotion'),
        kind: 'clips-path',
        pathClips: camPathClips,
      })
    }
    children.push(xformGroup(n, t, CAMERA_XFORM_PROPS))
    cameraRoots.push({
      key: n.id,
      ...baseOf(n),
      label: displayNodeName(t, n),
      kind: 'node',
      followsSubject: followerIds.has(n.id),
      children,
    })
  }

  for (const n of doc.content.nodes.filter((x) => x.type === 'character')) {
    const children: TimelineRow[] = []
    const motionClips = anim.motionClips.filter((c) => c.target.nodeId === n.id)
    if (motionClips.length > 0) {
      children.push({
        key: `${n.id}:motion`,
        ...baseOf(n),
        label: t('timeline.action'),
        kind: 'clips-motion',
        motionClips,
      })
    }
    // 派生走位 clip（由位移关键帧自动生成）不在时间轴展示——它随关键帧
    // reconcile 自动创建/删除，展示出来是无法操作的噪音；数据仍在文档里，
    // 视口轨迹线照常渲染。用户没加过可操作轨迹时，这一行也不占位。
    const pathClips = timelinePathClips(anim.pathMotionClips, n.id)
    if (pathClips.length > 0) {
      children.push({
        key: `${n.id}:path`,
        ...baseOf(n),
        label: t('timeline.pathMotion'),
        kind: 'clips-path',
        pathClips,
      })
    }
    children.push(nodeXformGroup(n, t))
    characterRoots.push({
      key: n.id,
      ...baseOf(n),
      label: displayNodeName(t, n),
      kind: 'node',
      children,
    })
  }

  const nodeHasUserKeys = (id: string): boolean => {
    const tracks = userKeys?.[id]
    if (!tracks) return false
    return Object.values(tracks).some((keys) => (keys?.length ?? 0) > 0)
  }

  for (const n of doc.content.nodes.filter((x) => x.type === 'prop' || x.type === 'primitive')) {
    const pathClips = timelinePathClips(anim.pathMotionClips, n.id)
    // 选中就先入轨：多选打关键帧前也能看到自己选了哪些道具/基础形状。
    if (!selectedSet.has(n.id) && !nodeHasUserKeys(n.id) && pathClips.length === 0) continue
    const children: TimelineRow[] = []
    if (pathClips.length > 0) {
      children.push({
        key: `${n.id}:path`,
        ...baseOf(n),
        label: t('timeline.pathMotion'),
        kind: 'clips-path',
        pathClips,
      })
    }
    children.push(nodeXformGroup(n, t))
    propRoots.push({
      key: n.id,
      ...baseOf(n),
      label: displayNodeName(t, n),
      kind: 'node',
      children,
    })
  }

  // 保持轨道顺序稳定：相机在前，角色在中，已入轨的道具/基础形状挂在末尾。
  return [...cameraRoots, ...characterRoots, ...propRoots]
}


export function collectSummary(row: TimelineRow): TimelineSummary {
  const acc: TimelineSummary = { cam: [], motion: [], path: [], kfTracks: [] }
  const walk = (r: TimelineRow) => {
    if (r.camClips) acc.cam.push(...r.camClips)
    if (r.motionClips) acc.motion.push(...r.motionClips)
    if (r.pathClips) acc.path.push(...r.pathClips)
    if (r.kind === 'kf' && r.prop) acc.kfTracks.push({ nodeId: r.nodeId, prop: r.prop })
    for (const c of r.children ?? []) walk(c)
  }
  for (const c of row.children ?? []) walk(c)
  return acc
}

export function flattenTree(
  list: TimelineRow[],
  isOpen: (row: TimelineRow) => boolean,
  depth = 0,
): { row: TimelineRow; depth: number }[] {
  const rows: { row: TimelineRow; depth: number }[] = []
  for (const row of list) {
    rows.push({ row, depth })
    if (row.children?.length && isOpen(row)) rows.push(...flattenTree(row.children, isOpen, depth + 1))
  }
  return rows
}

export function collectUserKeyframeFrames(userKeys: UserKeys, nodeId: string | null): number[] {
  if (!nodeId) return []
  const tracks = userKeys[nodeId]
  if (!tracks) return []
  const frames = new Set<number>()
  for (const keys of Object.values(tracks)) {
    if (!keys) continue
    for (const key of keys) frames.add(key.frame)
  }
  return [...frames].sort((a, b) => a - b)
}

export function stepToKeyframe(frames: number[], current: number, dir: -1 | 1): number | null {
  if (dir < 0) {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i] < current) return frames[i]
    }
    return null
  }
  return frames.find((frame) => frame > current) ?? null
}

export function timelineScale(pxPerFrame: number, frameCount: number, availableTrackW: number): number {
  if (frameCount <= 0 || availableTrackW <= 0) return pxPerFrame
  return Math.max(pxPerFrame, availableTrackW / frameCount)
}

export function timelineTickStep(pxPerFrame: number): number {
  if (pxPerFrame >= 4) return 5
  if (pxPerFrame >= 2) return 10
  if (pxPerFrame >= 1) return 20
  if (pxPerFrame >= 0.5) return 30
  return 60
}

export function timelineLabelEvery(pxPerFrame: number, step: number): number {
  const minLabelPx = 72
  return Math.max(1, Math.ceil(minLabelPx / (step * pxPerFrame)))
}

export function formatTimelineTick(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const secTotal = Math.floor(frame / safeFps)
  const rem = frame % safeFps
  const mm = String(Math.floor(secTotal / 60)).padStart(2, '0')
  const ss = String(secTotal % 60).padStart(2, '0')
  return rem === 0 ? `${mm}:${ss}` : `${mm}:${ss}+${rem}`
}

/** 播放头时间标签：始终秒 + 两位小数，避免 Number(toFixed(2)) 丢掉末尾 0。 */
export function formatTimelinePlayhead(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  return `${(frame / safeFps).toFixed(2)}s`
}

/** 场景时间轴标尺：对齐 Canvas Director Stage（密时用帧，疏时用秒）。 */
export function timelineSheetRuler(pxPerFrame: number, fps: number) {
  const safeFps = fps > 0 ? fps : 30
  const useFrames = pxPerFrame >= 12
  const secondStep = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]
    .find((step) => step * safeFps * pxPerFrame >= 70) ?? 600
  const frameStep = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
    .find((step) => step * pxPerFrame >= 70) ?? 5000
  return {
    step: useFrames ? frameStep : secondStep * safeFps,
    format: (frame: number) => (
      useFrames
        ? `${Math.round(frame)}f`
        : `${Number((frame / safeFps).toFixed(2))}s`
    ),
  }
}

/** 吸附锚点。keyId / clipId 用来在拖自己时把自身排除掉。 */
export type SnapTarget = { frame: number; keyId?: string; clipId?: string }

export function collectSnapTargets(
  doc: DirectorDocument | null,
  userKeys: UserKeys,
  fcurves: FCurveSet | null,
): SnapTarget[] {
  if (!doc) return []
  const tl = doc.content.timeline
  const targets: SnapTarget[] = [{ frame: tl.frameStart }, { frame: tl.frameEnd }]
  const anim = tl.animation
  for (const clip of [...anim.cameraMotionClips, ...anim.motionClips, ...anim.pathMotionClips]) {
    targets.push({ frame: clip.frameStart, clipId: clip.id })
    targets.push({ frame: clip.frameEnd, clipId: clip.id })
  }
  for (const tracks of Object.values(userKeys)) {
    for (const keys of Object.values(tracks ?? {})) {
      for (const key of keys ?? []) targets.push({ frame: key.frame, keyId: key.id })
    }
  }
  if (fcurves) {
    for (const node of doc.content.nodes) {
      for (const curve of fcurves.tracksForNode(node.id)) {
        for (const key of curve.keys) targets.push({ frame: key.frame })
      }
    }
  }
  return targets
}

/** 锚点优先于刻度：刻度线只在没有关键帧 / 片段边界落在容差内时才吸。 */
export function snapFrame(
  frame: number,
  targets: SnapTarget[],
  toleranceFrames: number,
  options?: {
    tickStep?: number
    tickOrigin?: number
    excludeKeyIds?: ReadonlySet<string>
    excludeClipId?: string
    excludeClipIds?: ReadonlySet<string>
  },
): number {
  if (toleranceFrames <= 0) return frame
  let best: number | null = null
  let bestDist = Infinity
  for (const target of targets) {
    if (target.keyId && options?.excludeKeyIds?.has(target.keyId)) continue
    if (target.clipId && target.clipId === options?.excludeClipId) continue
    if (target.clipId && options?.excludeClipIds?.has(target.clipId)) continue
    const dist = Math.abs(target.frame - frame)
    if (dist <= toleranceFrames && dist < bestDist) {
      bestDist = dist
      best = target.frame
    }
  }
  if (best != null) return best
  const step = options?.tickStep ?? 0
  if (step > 0) {
    const origin = options?.tickOrigin ?? 0
    const tick = origin + Math.round((frame - origin) / step) * step
    if (Math.abs(tick - frame) <= toleranceFrames) return tick
  }
  return frame
}

export function isSameSelection(a: Selection | null, b: Selection): boolean {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId
  if (a.kind === 'clip' && b.kind === 'clip') return a.clipId === b.clipId
  if (a.kind === 'keyframe' && b.kind === 'keyframe') return a.keyId === b.keyId
  if (a.kind === 'timelineBox' && b.kind === 'timelineBox') {
    if (a.clips.length !== b.clips.length || a.keys.length !== b.keys.length) return false
    const clipIds = new Set(a.clips.map((c) => c.clipId))
    const keyIds = new Set(a.keys.map((k) => k.keyId))
    return (
      b.clips.every((c) => clipIds.has(c.clipId)) && b.keys.every((k) => keyIds.has(k.keyId))
    )
  }
  if (a.kind === 'transformKeyframe' && b.kind === 'transformKeyframe') {
    return a.nodeId === b.nodeId && a.frame === b.frame
  }
  return false
}

export type KeyframeDragItem = {
  nodeId: string
  prop: TrackProp
  keyId: string
  origFrame: number
}

/** 某节点在指定帧上仍存在的用户关键帧（位移 / 旋转 / 缩放 / 看点 / FOV）。 */
export function userKeyRefsAtFrame(
  userKeys: UserKeys,
  nodeId: string,
  frame: number,
): KeyframeRef[] {
  const tracks = userKeys[nodeId]
  if (!tracks) return []
  const refs: KeyframeRef[] = []
  for (const [prop, keys] of Object.entries(tracks)) {
    for (const kf of keys ?? []) {
      if (kf.frame === frame) refs.push({ nodeId, prop: prop as TrackProp, keyId: kf.id })
    }
  }
  return refs
}

/**
 * 子钻石高亮：显式选中该 keyId，或落在已选「变换」总关键帧的同一节点 + 同一帧。
 * 总关键帧本身仍用 transformKeyframe，不把子 ref 写进 selection。
 */
export function isKeyframeHighlighted(
  sel: Selection | null,
  key: { keyId: string; nodeId: string; frame: number },
): boolean {
  if (isKeyframeSelected(sel, key.keyId)) return true
  return sel?.kind === 'transformKeyframe' && sel.nodeId === key.nodeId && sel.frame === key.frame
}

export function isGroupKeyframeSelected(
  selection: Selection | null,
  nodeId: string,
  frame: number,
  refs: KeyframeRef[],
): boolean {
  if (isSameSelection(selection, { kind: 'transformKeyframe', nodeId, frame })) return true
  return refs.length > 0 && refs.every((ref) => isKeyframeSelected(selection, ref.keyId))
}

/** 对齐 canvas selectKeys：非累加时若已选中该键则保持整组；累加则 toggle。 */
export function nextKeyframeSelection(
  current: Selection | null,
  ref: KeyframeRef,
  additive: boolean,
  frame?: number,
): Selection {
  if (
    !additive &&
    current?.kind === 'transformKeyframe' &&
    current.nodeId === ref.nodeId &&
    (frame == null || current.frame === frame)
  ) {
    return current
  }
  const existing = keyframeRefsOf(current)
  if (!additive) {
    if (existing.some((item) => item.keyId === ref.keyId)) return current ?? makeKeyframeSelection([ref])!
    return makeKeyframeSelection([ref])!
  }
  if (existing.some((item) => item.keyId === ref.keyId)) {
    const next = existing.filter((item) => item.keyId !== ref.keyId)
    return next.length ? makeKeyframeSelection(next)! : makeKeyframeSelection([ref])!
  }
  return makeKeyframeSelection([...existing, ref])!
}

/** 只收集当前选中、且在 userKeys 里还在的键。未选中的不会进拖动集合。 */
export function selectedKeyframeDragItems(
  selection: Selection | null,
  userKeys: UserKeys,
): KeyframeDragItem[] {
  if (selection?.kind === 'transformKeyframe') {
    return userKeyRefsAtFrame(userKeys, selection.nodeId, selection.frame).map((ref) => ({
      ...ref,
      origFrame: selection.frame,
    }))
  }
  return keyframeRefsOf(selection).flatMap((ref) => {
    const frame = userKeys[ref.nodeId]?.[ref.prop]?.find((item) => item.id === ref.keyId)?.frame
    return frame == null ? [] : [{ ...ref, origFrame: frame }]
  })
}

/** 拖拽预览：仅对本次拖动集合里的子钻石施加帧偏移。 */
export function keyframePreviewOffset(
  previewDf: number | null,
  keyId: string,
  draggingKeyIds: ReadonlySet<string> | null | undefined,
): number {
  if (previewDf == null || !draggingKeyIds?.has(keyId)) return 0
  return previewDf
}

/**
 * 总关键帧预览：只有整束子键都在拖动集合里才跟着走，
 * 避免只拖其中一维时总钻也滑走。
 */
export function bundlePreviewOffset(
  previewDf: number | null,
  keyIds: readonly string[],
  draggingKeyIds: ReadonlySet<string> | null | undefined,
): number {
  if (previewDf == null || !draggingKeyIds || keyIds.length === 0) return 0
  return keyIds.every((id) => draggingKeyIds.has(id)) ? previewDf : 0
}

import type { DirectorDocument, EditSequenceClip } from '../../contract/types'
import { getClipDurationFrames, validateEditorial } from '../../evaluate/editSequence'
import type { FilmDragPreview } from '../../stores/types'
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_PX,
  MAX_STRIP_CELLS,
  SOURCE_STRIP_CELLS,
  SOURCE_TICK_COUNT,
  STRIP_ASPECT,
  THUMB_HEIGHT_MAX,
  THUMB_HEIGHT_MIN,
  THUMB_HEIGHT_STEP,
} from './constants'
import type { ClipStrip, SequenceLayout, SlotLayout, UsedCluster, UsedRange } from './types'
import type { ThumbRequest } from './hooks/thumbnailStore'

export function clipIssueCodes(document: DirectorDocument, clipId: string): string[] {
  return validateEditorial(document)
    .filter((issue) => issue.clipId === clipId)
    .map((issue) => issue.code)
}

export function clipIsInvalid(document: DirectorDocument, clipId: string): boolean {
  return clipIssueCodes(document, clipId).length > 0
}

export function displayDuration(clip: Pick<EditSequenceClip, 'sourceFrameStart' | 'sourceFrameEnd'>): number {
  return getClipDurationFrames(clip)
}

export function sourceTimelineFrames(timeline: { frameStart: number; frameEnd: number }): number {
  return Math.max(1, timeline.frameEnd - timeline.frameStart + 1)
}

/** 初始化时视频轨道至少和机位一样长；成片更长就跟着长。 */
export function filmTrackDisplayFrames(clipFrames: number, sourceFrames: number): number {
  return Math.max(1, clipFrames, sourceFrames)
}

export function frameFromClientX(
  clientX: number,
  el: HTMLElement,
  frameStart: number,
  pxPerFrame: number,
): number {
  const rect = el.getBoundingClientRect()
  return frameStart + (clientX - rect.left) / pxPerFrame
}

export function formatSeconds(frames: number, fps: number): string {
  return (frames / Math.max(1, fps)).toFixed(1)
}

/** 与场景时间轴播放头同一格式：秒 + 两位小数。 */
export function formatFilmPlayhead(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  return `${(frame / safeFps).toFixed(2)}s`
}

/** Ruler labels stay compact: MM:SS reads better than full HH:MM:SS:FF at tick density. */
export function shortTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.max(0, Math.round(frame / Math.max(1, fps)))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Stable per-camera hue so neighbouring clips stay visually distinguishable. */
export function cameraHue(cameraNodeId: string): number {
  // FNV-1a 全宽哈希 + 黄金角散开：机位 id 共享长前缀时也不会挤在同一色带
  let hash = 2166136261
  for (let i = 0; i < cameraNodeId.length; i++) {
    hash ^= cameraNodeId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.round((((hash >>> 0) % 977) * 137.508) % 360)
}

/**
 * 重排拖拽时被拖的片段留在原位（由指针增量实时位移），其余片段让位并做过渡动画，
 * 这样拖起来跟手，而不是整条轨道跳来跳去。
 */
export function computeSequenceLayout(
  clips: EditSequenceClip[],
  preview: FilmDragPreview | null,
  pxPerFrame: number,
): SequenceLayout {
  const applied = clips.map((clip) => (
    preview && preview.clipId === clip.id
      ? {
          ...clip,
          cameraNodeId: preview.cameraNodeId,
          sourceFrameStart: preview.sourceFrameStart,
          sourceFrameEnd: preview.sourceFrameEnd,
        }
      : clip
  ))
  const widthOf = (clip: EditSequenceClip) => Math.max(1, getClipDurationFrames(clip)) * pxPerFrame
  const sequential = (): SequenceLayout => {
    let cursor = 0
    const slots = applied.map((clip) => {
      const slot: SlotLayout = {
        clip,
        left: cursor,
        width: widthOf(clip),
        dragging: preview != null && preview.clipId === clip.id,
      }
      cursor += slot.width
      return slot
    })
    return { slots, drop: null, total: cursor }
  }
  if (!preview || preview.kind !== 'sequence-reorder' || preview.toIndex == null) return sequential()

  const fromIndex = applied.findIndex((clip) => clip.id === preview.clipId)
  if (fromIndex < 0) return sequential()
  const dragged = applied[fromIndex]
  const others = applied.filter((_, i) => i !== fromIndex)
  const to = Math.min(Math.max(preview.toIndex, 0), others.length)
  const originLeft = applied.slice(0, fromIndex).reduce((sum, clip) => sum + widthOf(clip), 0)

  const slots: SlotLayout[] = []
  const draggedWidth = widthOf(dragged)
  let cursor = 0
  let dropLeft = 0
  for (let i = 0; i <= others.length; i++) {
    // 插入点真的空出一整段，后面的片段让开；只画一条线看不出要插到哪
    if (i === to) {
      dropLeft = cursor
      cursor += draggedWidth
    }
    if (i < others.length) {
      slots.push({ clip: others[i], left: cursor, width: widthOf(others[i]), dragging: false })
      cursor += widthOf(others[i])
    }
  }
  slots.push({ clip: dragged, left: originLeft, width: draggedWidth, dragging: true })
  return { slots, drop: { left: dropLeft, width: draggedWidth }, total: cursor }
}

/**
 * 指针贴到轨道两端时的自动滚动速度（px / 帧，带方向）。
 * 越靠边越快；越过边界按最大速度走，手不用悬在像素级的窄带上。
 */
export function autoScrollSpeed(clientX: number, rect: { left: number; right: number }): number {
  const toLeft = clientX - rect.left
  const toRight = rect.right - clientX
  if (toLeft < AUTO_SCROLL_EDGE_PX) return -rampSpeed(toLeft)
  if (toRight < AUTO_SCROLL_EDGE_PX) return rampSpeed(toRight)
  return 0
}

function rampSpeed(distance: number): number {
  const ratio = Math.min(1, Math.max(0, 1 - distance / AUTO_SCROLL_EDGE_PX))
  return Math.max(2, Math.round(ratio * AUTO_SCROLL_MAX_PX))
}

/** 一次校验拿到全部问题片段：逐个片段各跑一遍 validateEditorial 会退化成 O(片段 × 节点)。 */
export function invalidClipIds(document: DirectorDocument): Set<string> {
  const ids = new Set<string>()
  for (const issue of validateEditorial(document)) {
    if (issue.clipId) ids.add(issue.clipId)
  }
  return ids
}

/**
 * 离屏渲染高度 = CSS 显示高度 × DPR，向上取到 STEP 的整数倍。
 * 取整是为了让 resize 过程中的中间高度命中同一份缓存，不然拖一次面板要重渲几十张。
 */
export function resolveThumbHeight(cssHeight: number): number {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
  const raw = Math.max(1, cssHeight) * dpr
  const stepped = Math.ceil(raw / THUMB_HEIGHT_STEP) * THUMB_HEIGHT_STEP
  return Math.min(THUMB_HEIGHT_MAX, Math.max(THUMB_HEIGHT_MIN, stepped))
}

export function thumbWidthFor(height: number): number {
  return Math.round(height * STRIP_ASPECT)
}

/** 每个片段按宽度铺胶片格，取每格中点，缩略图更能代表这一段而不是永远停在入点。 */
export function buildClipStrips(slots: SlotLayout[], cellPx: number): ClipStrip[] {
  return slots.map((slot) => {
    const cells = Math.min(MAX_STRIP_CELLS, Math.max(1, Math.round(slot.width / Math.max(1, cellPx))))
    const start = slot.clip.sourceFrameStart
    const end = Math.max(start, slot.clip.sourceFrameEnd)
    const frames: number[] = []
    for (let i = 0; i < cells; i++) {
      const ratio = cells === 1 ? 0 : (i + 0.5) / cells
      frames.push(Math.round(start + (end - start) * ratio))
    }
    return { clipId: slot.clip.id, cameraId: slot.clip.cameraNodeId, frames: [...new Set(frames)] }
  })
}

export function dedupeThumbRequests(
  strips: Pick<ClipStrip, 'cameraId' | 'frames'>[],
  height: number,
): ThumbRequest[] {
  const seen = new Set<string>()
  const out: ThumbRequest[] = []
  for (const strip of strips) {
    for (const frame of strip.frames) {
      const key = `${strip.cameraId}@${frame}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ cameraId: strip.cameraId, frame, height })
    }
  }
  return out
}

/** 指针落在哪两个片段之间；返回的是「移走被拖片段后」的插入下标。 */
export function insertIndexAt(
  clips: EditSequenceClip[],
  clipId: string,
  frame: number,
): number {
  const others = clips.filter((clip) => clip.id !== clipId)
  let cursor = 0
  for (let i = 0; i < others.length; i++) {
    const duration = Math.max(1, getClipDurationFrames(others[i]))
    if (frame < cursor + duration / 2) return i
    cursor += duration
  }
  return others.length
}

/** 某台机位在当前视频里已经被用掉的区间。 */
export function buildUsedRanges(
  clips: readonly EditSequenceClip[],
  cameraNodeId: string,
): UsedRange[] {
  return clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => clip.cameraNodeId === cameraNodeId)
    .sort((a, b) => a.clip.sourceFrameStart - b.clip.sourceFrameStart || a.index - b.index)
    .map(({ clip, index }) => ({
      clipId: clip.id,
      index: index + 1,
      sourceFrameStart: clip.sourceFrameStart,
      sourceFrameEnd: clip.sourceFrameEnd,
    }))
}

/** 闭区间重叠的已用片段收成一组，N 段也只占轨道上一块。 */
export function clusterUsedRanges(ranges: readonly UsedRange[]): UsedCluster[] {
  const sorted = [...ranges].sort(
    (a, b) => a.sourceFrameStart - b.sourceFrameStart || a.index - b.index,
  )
  const clusters: UsedCluster[] = []
  for (const range of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && range.sourceFrameStart <= last.sourceFrameEnd) {
      last.items.push(range)
      last.sourceFrameEnd = Math.max(last.sourceFrameEnd, range.sourceFrameEnd)
    } else {
      clusters.push({
        id: range.clipId,
        items: [range],
        sourceFrameStart: range.sourceFrameStart,
        sourceFrameEnd: range.sourceFrameEnd,
      })
    }
  }
  return clusters
}

export function focusedUsedRange(cluster: UsedCluster, currentId: string | null): UsedRange {
  const current = cluster.items.find((item) => item.clipId === currentId)
  if (current) return current
  const first = cluster.items[0]
  if (!first) throw new Error('used cluster is empty')
  return first
}

export function nextUsedClipId(cluster: UsedCluster, currentId: string | null): string {
  const items = cluster.items
  const index = items.findIndex((item) => item.clipId === currentId)
  const next = items[index < 0 ? 0 : (index + 1) % items.length]
  if (!next) throw new Error('used cluster is empty')
  return next.clipId
}

/** 重叠块上的分镜号，太多时收成前几个 + 余数。 */
export function formatUsedIndices(items: readonly UsedRange[], max = 4): string {
  const labels = items.map((item) => String(item.index).padStart(2, '0'))
  if (labels.length <= max) return labels.join(' · ')
  return `${labels.slice(0, max - 1).join(' · ')} · +${labels.length - (max - 1)}`
}

export function buildSourceStripFrames(frameStart: number, frameEnd: number): number[] {
  const span = Math.max(1, frameEnd - frameStart)
  const frames = Array.from({ length: SOURCE_STRIP_CELLS }, (_, index) => (
    Math.round(frameStart + (span * (index + 0.5)) / SOURCE_STRIP_CELLS)
  ))
  return [...new Set(frames)]
}

export function buildSourceTicks(
  frameStart: number,
  frameEnd: number,
  fps: number,
): { frame: number; label: string }[] {
  const span = Math.max(1, frameEnd - frameStart)
  const step = span / (SOURCE_TICK_COUNT - 1)
  return Array.from({ length: SOURCE_TICK_COUNT }, (_, index) => {
    const frame = Math.round(frameStart + step * index)
    return { frame, label: shortTimecode(frame, fps) }
  })
}

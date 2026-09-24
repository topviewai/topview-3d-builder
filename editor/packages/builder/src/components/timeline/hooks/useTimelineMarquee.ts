import { useRef, useState, type RefObject, type KeyboardEvent, type PointerEvent } from 'react'
import type { DirectorDocument } from '../../../contract/types'
import { clipRefsOf, keyframeRefsOf, makeTimelineBoxSelection, type ClipRef, type KeyframeRef, type Selection } from '../../../stores/types'
import { clipIntersectsMarquee, DRAG_THRESHOLD_PX, MARQUEE_HIT_SLOP_PX } from '../constants'
import { collapseTimelineItemSelection } from '../utils'

export function useTimelineMarquee({ contentRef, doc, selection, select, setFrame, snap, frameFromClientX }: {
  contentRef: RefObject<HTMLDivElement>
  doc: DirectorDocument | null
  selection: Selection | null
  select: (selection: Selection | null) => void
  setFrame: (frame: number) => void
  snap: (frame: number) => number
  frameFromClientX: (x: number) => number
}) {
  const boxDrag = useRef<{
    pointerId: number
    startX: number
    startY: number
    additive: boolean
    mode: 'pending' | 'box'
    previous: Selection | null
  } | null>(null)
  const [kfBox, setKfBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const boxFromClient = (x0: number, y0: number, x1: number, y1: number) => {
    const root = contentRef.current
    if (!root) return { left: 0, top: 0, width: 0, height: 0 }
    const bounds = root.getBoundingClientRect()
    const left = Math.min(x0, x1) - bounds.left
    const top = Math.min(y0, y1) - bounds.top
    return { left, top, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
  }

  const pickTimelineItemsInClientRect = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { keys: KeyframeRef[]; clips: ClipRef[] } => {
    const root = contentRef.current
    if (!root) return { keys: [], clips: [] }
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    const right = Math.max(x0, x1)
    const bottom = Math.max(y0, y1)
    const slop = MARQUEE_HIT_SLOP_PX
    const keys: KeyframeRef[] = []
    const clips: ClipRef[] = []
    for (const el of root.querySelectorAll<HTMLElement>('[data-kf-id]')) {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      // canvas: center ±6 vs box
      if (cx + slop < left || cx - slop > right || cy + slop < top || cy - slop > bottom) continue
      let refs: KeyframeRef[] = []
      if (el.dataset.kfBundle) {
        try {
          refs = JSON.parse(el.dataset.kfBundle) as KeyframeRef[]
        } catch {
          refs = []
        }
      }
      if (refs.length === 0) {
        const nodeId = el.dataset.kfNode
        const prop = el.dataset.kfProp as KeyframeRef['prop'] | undefined
        const keyId = el.dataset.kfId
        if (nodeId && prop && keyId) refs = [{ nodeId, prop, keyId }]
      }
      for (const ref of refs) {
        if (!keys.some((item) => item.keyId === ref.keyId)) keys.push(ref)
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-clip-id]')) {
      if (el.classList.contains('t3d-timeline-clip-ghost')) continue
      if (el.classList.contains('t3d-timeline-clip-drop-preview')) continue
      const r = el.getBoundingClientRect()
      if (!clipIntersectsMarquee(r, { left, top, right, bottom })) continue
      const clipId = el.dataset.clipId
      const clipType = el.dataset.clipType as ClipRef['clipType'] | undefined
      if (!clipId || !clipType) continue
      if (!clips.some((item) => item.clipId === clipId)) clips.push({ clipType, clipId })
    }
    return { keys, clips }
  }

  const applyBoxPick = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    additive: boolean,
    previous: Selection | null,
  ) => {
    const picked = pickTimelineItemsInClientRect(x0, y0, x1, y1)
    let clips = picked.clips
    let keys = picked.keys
    if (additive) {
      const mergedClips = [...clipRefsOf(previous)]
      for (const ref of clips) {
        if (!mergedClips.some((item) => item.clipId === ref.clipId)) mergedClips.push(ref)
      }
      const mergedKeys = [...keyframeRefsOf(previous)]
      for (const ref of keys) {
        if (!mergedKeys.some((item) => item.keyId === ref.keyId)) mergedKeys.push(ref)
      }
      clips = mergedClips
      keys = mergedKeys
    }
    const next = makeTimelineBoxSelection(clips, keys)
    if (next) select(next)
    else if (!additive) {
      const collapsed = collapseTimelineItemSelection(doc, previous)
      if (collapsed !== previous) select(collapsed)
    }
  }

  const onKfBoxPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.t3d-timeline-kf, .t3d-timeline-clip, .t3d-timeline-name, .t3d-timeline-ruler, .t3d-timeline-cursor-label, .t3d-timeline-playhead, button, input, label')) {
      return
    }
    boxDrag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      mode: 'pending',
      previous: selection,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onKfBoxPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = boxDrag.current
    if (!drag || e.pointerId !== drag.pointerId) return
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
    if (drag.mode === 'pending') {
      if (dist < DRAG_THRESHOLD_PX) return
      drag.mode = 'box'
    }
    setKfBox(boxFromClient(drag.startX, drag.startY, e.clientX, e.clientY))
    applyBoxPick(drag.startX, drag.startY, e.clientX, e.clientY, drag.additive, drag.previous)
  }

  const onKfBoxPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = boxDrag.current
    if (!drag || e.pointerId !== drag.pointerId) return
    boxDrag.current = null
    setKfBox(null)
    if (drag.mode === 'box') {
      applyBoxPick(drag.startX, drag.startY, e.clientX, e.clientY, drag.additive, drag.previous)
      return
    }
    // pending click: seek + 片段 / 关键帧高亮收回所属节点（含底部空白）
    setFrame(snap(frameFromClientX(drag.startX)))
    if (!drag.additive) {
      const collapsed = collapseTimelineItemSelection(doc, selection)
      if (collapsed !== selection) select(collapsed)
    }
  }

  const onKfBoxKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !boxDrag.current) return
    e.preventDefault()
    e.stopPropagation()
    const prev = boxDrag.current.previous
    boxDrag.current = null
    setKfBox(null)
    select(prev)
  }


  return { kfBox, onKfBoxPointerDown, onKfBoxPointerMove, onKfBoxPointerUp, onKfBoxKeyDown }
}

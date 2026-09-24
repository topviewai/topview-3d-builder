import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { TrackProp } from '../../../evaluate/curves/KeyframeTrack'
import { KEY_MOVE_COMMIT_PX } from '../constants'
import type { KeyframeDragItem } from '../utils'
import type { SnapFrameFn } from './useSnapFrame'

export type { KeyframeDragItem } from '../utils'
export { selectedKeyframeDragItems } from '../utils'

export type KeyframeDragPreview = {
  df: number
  keyIds: ReadonlySet<string>
}

type PreviewBag = {
  preview: KeyframeDragPreview | null
  setPreview: Dispatch<SetStateAction<KeyframeDragPreview | null>>
}

const KeyframeDragPreviewContext = createContext<PreviewBag | null>(null)

/**
 * 把 previewDf 提升到整条时间轴：总关键帧与位移 / 旋转 / 缩放行共用一份拖拽预览，
 * 避免各 TrackRow 各自一份 useState 导致子钻要等 pointerup 才跳到新位置。
 */
export function KeyframeDragPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<KeyframeDragPreview | null>(null)
  const value = useMemo(() => ({ preview, setPreview }), [preview])
  return createElement(KeyframeDragPreviewContext.Provider, { value }, children)
}

/**
 * Canvas 对齐：pointermove 只更新 previewDf（UI 位移），pointerup 且水平位移 > KEY_MOVE_COMMIT_PX 才写回。
 * 有 Provider 时读写共享预览；没有则退回实例内状态（单测 / 孤立渲染）。
 */
export function useKeyframeDrag(
  pxPerFrame: number,
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void,
  snap?: SnapFrameFn,
) {
  const shared = useContext(KeyframeDragPreviewContext)
  const [localPreview, setLocalPreview] = useState<KeyframeDragPreview | null>(null)
  const preview = shared ? shared.preview : localPreview
  const setPreview = shared ? shared.setPreview : setLocalPreview
  const drag = useRef<{
    pointerId: number
    startX: number
    items: KeyframeDragItem[]
  } | null>(null)

  /** 整组按第一颗键吸附，保持组内相对间距；拖动中的键自身不当锚点。 */
  const snapDelta = (df: number, items: KeyframeDragItem[]) => {
    const lead = items[0]
    if (!snap || !lead) return df
    const keyIds = new Set(items.map((item) => item.keyId))
    return snap(lead.origFrame + df, { keyIds }) - lead.origFrame
  }

  const begin = (e: PointerEvent<HTMLElement>, items: KeyframeDragItem[]) => {
    if (e.button !== 0 || items.length === 0) return
    drag.current = { pointerId: e.pointerId, startX: e.clientX, items }
    setPreview({ df: 0, keyIds: new Set(items.map((item) => item.keyId)) })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const move = (e: PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== e.pointerId) return
    setPreview({
      df: snapDelta((e.clientX - state.startX) / pxPerFrame, state.items),
      keyIds: new Set(state.items.map((item) => item.keyId)),
    })
  }

  const end = (e: PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== e.pointerId) return
    const dx = e.clientX - state.startX
    const df = snapDelta(dx / pxPerFrame, state.items)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
    setPreview(null)
    if (Math.abs(dx) <= KEY_MOVE_COMMIT_PX) return
    if (Math.abs(df) < 1 / pxPerFrame) return
    onMoveKeyframes(
      state.items.map((item) => ({
        nodeId: item.nodeId,
        prop: item.prop,
        keyId: item.keyId,
        newFrame: item.origFrame + df,
      })),
    )
  }

  const cancel = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
    setPreview(null)
  }

  return {
    begin,
    move,
    end,
    cancel,
    previewDf: preview?.df ?? null,
    draggingKeyIds: preview?.keyIds ?? null,
  }
}

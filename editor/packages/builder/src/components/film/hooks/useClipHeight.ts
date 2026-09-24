import { useEffect, useState, type RefObject } from 'react'
import { CLIP_MAX_PX, CLIP_MIN_PX } from '../constants'

/**
 * 轨道拉高时片段跟着长满（封顶后垂直居中），缩略图按实际显示高度重渲，
 * 下方不再留一条死白带。
 */
export function useClipHeight(track: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(CLIP_MIN_PX)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      // 不超过轨道内容盒，避免片段比轨道高而被父级裁掉
      const available = Math.round(entry.contentRect.height)
      setHeight(Math.min(CLIP_MAX_PX, Math.max(1, available)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [track])
  return height
}

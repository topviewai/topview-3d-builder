import { useEffect, useRef, useState } from 'react'
import { HOVER_DELAY_MS } from '../constants'
import type { HoverDiagram, HoverTarget } from '../types'

export function useHoverPreview(): {
  preview: HoverTarget | null
  onEnter: (el: HTMLElement, assetKey: string | undefined, alt: string, diagram?: HoverDiagram) => void
  onLeave: () => void
} {
  const [preview, setPreview] = useState<HoverTarget | null>(null)
  const timer = useRef(0)

  const onLeave = () => {
    window.clearTimeout(timer.current)
    setPreview(null)
  }

  const onEnter = (el: HTMLElement, assetKey: string | undefined, alt: string, diagram?: HoverDiagram) => {
    window.clearTimeout(timer.current)
    if (!assetKey && !diagram) {
      setPreview(null)
      return
    }
    timer.current = window.setTimeout(() => {
      const rail = el.closest('.t3d-leftrail')
      const panelRight = rail?.getBoundingClientRect().right ?? el.getBoundingClientRect().right
      const cardTop = el.getBoundingClientRect().top
      setPreview({ assetKey, diagram, alt, panelRight, top: cardTop })
    }, HOVER_DELAY_MS)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { preview, onEnter, onLeave }
}


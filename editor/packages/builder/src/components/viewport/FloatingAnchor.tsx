import { useEffect, useRef, type ReactNode } from 'react'

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface StageAnchor {
  projectNodeScreenRect(container: HTMLElement, nodeId: string): ScreenRect | null
  projectCharacterLabelScreenRect?(container: HTMLElement, nodeId: string): ScreenRect | null
}

export function FloatingAnchor({
  stage,
  nodeId,
  placement,
  children,
}: {
  stage: StageAnchor
  nodeId: string
  placement: 'above' | 'below' | 'above-label'
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const wrap = el?.offsetParent instanceof HTMLElement ? el.offsetParent : el?.parentElement
    if (!el || !wrap) return
    let raf = 0
    const tick = () => {
      const labelRect = placement === 'above-label'
        ? stage.projectCharacterLabelScreenRect?.(wrap, nodeId) ?? null
        : null
      const rect = labelRect ?? stage.projectNodeScreenRect(wrap, nodeId)
      if (!rect || rect.width < 1 && rect.height < 1) {
        el.style.visibility = 'hidden'
      } else {
        const above = placement !== 'below'
        const x = rect.left + rect.width / 2
        const y = above ? rect.top - 8 : rect.top + rect.height + 10
        el.style.visibility = 'visible'
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${above ? '-100%' : '0'})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stage, nodeId, placement])

  return (
    <div
      ref={ref}
      className="t3d-viewport-float-anchor"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

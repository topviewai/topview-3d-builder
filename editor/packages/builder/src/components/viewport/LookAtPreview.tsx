import { useEffect, useRef } from 'react'

interface StageLookAtPreview {
  getNodeSnapshot(nodeId: string): { position: number[] } | null
  projectWorldToContainer(
    container: HTMLElement,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; visible: boolean } | null
  projectNodeWireframe(
    container: HTMLElement,
    nodeId: string,
  ): { x1: number; y1: number; x2: number; y2: number }[]
}

export function LookAtPreview({
  stage,
  cameraId,
  hoverId,
}: {
  stage: StageLookAtPreview
  cameraId: string
  hoverId: string | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const hoverRef = useRef(hoverId)
  hoverRef.current = hoverId

  useEffect(() => {
    const canvas = ref.current
    const wrap = canvas?.parentElement
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const onMove = (e: PointerEvent) => {
      pointerRef.current = e.target instanceof HTMLCanvasElement
        ? { x: e.clientX, y: e.clientY }
        : null
    }
    const onLeave = () => {
      pointerRef.current = null
    }
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerleave', onLeave)

    let raf = 0
    const draw = (time: number) => {
      const bounds = wrap.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(bounds.width * ratio)
      const height = Math.round(bounds.height * ratio)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, bounds.width, bounds.height)
      const pointer = pointerRef.current
      const origin = stage.getNodeSnapshot(cameraId)
      const start = origin
        ? stage.projectWorldToContainer(wrap, origin.position[0], origin.position[1], origin.position[2])
        : null
      const color = getComputedStyle(canvas).color
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1.5
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
      ctx.shadowBlur = 3
      if (start?.visible && pointer) {
        const endX = pointer.x - bounds.left
        const endY = pointer.y - bounds.top
        ctx.setLineDash([7, 5])
        ctx.lineDashOffset = -time / 35
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(endX, endY)
        ctx.stroke()
        ctx.setLineDash([])
        const angle = Math.atan2(endY - start.y, endX - start.x)
        ctx.beginPath()
        ctx.moveTo(endX, endY)
        ctx.lineTo(endX - 10 * Math.cos(angle - 0.4), endY - 10 * Math.sin(angle - 0.4))
        ctx.moveTo(endX, endY)
        ctx.lineTo(endX - 10 * Math.cos(angle + 0.4), endY - 10 * Math.sin(angle + 0.4))
        ctx.stroke()
      }
      const targetId = hoverRef.current
      const edges = targetId ? stage.projectNodeWireframe(wrap, targetId) : []
      if (edges.length) {
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.beginPath()
        for (const edge of edges) {
          ctx.moveTo(edge.x1, edge.y1)
          ctx.lineTo(edge.x2, edge.y2)
        }
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerleave', onLeave)
    }
  }, [stage, cameraId])

  return <canvas ref={ref} className="t3d-look-at-preview" aria-hidden />
}

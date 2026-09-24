import { useEffect, useState } from 'react'
import { useEngine } from '../../bridge/useEngine'

export function useViewportAspect(trackResize: boolean): number {
  const engine = useEngine()
  const [aspect, setAspect] = useState(() => engine.viewportAspect())

  useEffect(() => {
    const sync = () => setAspect(engine.viewportAspect())
    sync()
    if (!trackResize) return
    const canvas = engine.mainCanvas()
    if (!canvas) return
    const observer = new ResizeObserver(sync)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [engine, trackResize])

  return aspect
}

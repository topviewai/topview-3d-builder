import { useEffect, type RefObject } from 'react'
import { useDirector } from './DirectorContext'

export function useViewportAttach(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const { stage } = useDirector()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    stage.attachViewport('main', canvas)
    return () => {
      stage.detachViewport('main')
    }
  }, [canvasRef, stage])

  return {
    stage,
    ndcFromClient: stage.ndcFromClient.bind(stage),
  }
}

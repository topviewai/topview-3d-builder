import { useEffect, useRef, useState, type RefObject } from 'react'
import type { DirectorEngine } from '../../../bridge/useEngine'
import type { StudioView } from '../../../stores/types'

const PREVIEW_HEIGHT = 360

type StudioStore = { getState: () => StudioView }

export function useExportPreview(input: {
  engine: DirectorEngine
  useStore: StudioStore
  cameraId: string
  label: string
  output: 'image' | 'video'
  imageFrame: number
  start: number
  end: number
  fps: number
  previewWidth: number
  enabled: boolean
  exporting: boolean
}): { previewUrl: string; previewLoading: boolean; previewCanvasRef: RefObject<HTMLCanvasElement> } {
  const { previewUrl, previewLoading } = useExportStillPreview({
    engine: input.engine,
    useStore: input.useStore,
    cameraId: input.cameraId,
    label: input.label,
    frame: input.imageFrame,
    previewWidth: input.previewWidth,
    enabled: input.enabled && input.output === 'image',
  })
  const previewCanvasRef = useExportLivePreview({
    engine: input.engine,
    useStore: input.useStore,
    cameraId: input.cameraId,
    label: input.label,
    start: input.start,
    end: input.end,
    fps: input.fps,
    previewWidth: input.previewWidth,
    enabled: input.enabled && input.output === 'video' && !input.exporting,
  })
  return { previewUrl, previewLoading, previewCanvasRef }
}

function useExportStillPreview(input: {
  engine: DirectorEngine
  useStore: StudioStore
  cameraId: string
  label: string
  frame: number
  previewWidth: number
  enabled: boolean
}): { previewUrl: string; previewLoading: boolean } {
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewLoading, setPreviewLoading] = useState(input.enabled)
  useEffect(() => {
    if (!input.enabled) {
      setPreviewUrl('')
      setPreviewLoading(false)
      return
    }
    setPreviewLoading(true)
    return watchExportPreview(input, (url) => {
      setPreviewUrl(url)
      setPreviewLoading(false)
    })
  }, [input.cameraId, input.enabled, input.engine, input.frame, input.label, input.previewWidth, input.useStore])
  return { previewUrl, previewLoading }
}

function watchExportPreview(
  input: {
    engine: DirectorEngine
    useStore: StudioStore
    cameraId: string
    label: string
    frame: number
    previewWidth: number
  },
  setPreviewUrl: (url: string) => void,
): () => void {
  let cancelled = false
  let objectUrl = ''
  const s = input.useStore.getState()
  void input.engine
    .previewFrame({
      cameraId: input.cameraId,
      label: input.label,
      frame: input.frame,
      width: input.previewWidth,
      height: PREVIEW_HEIGHT,
      userKeys: s.userKeys,
      userKeysEnabled: s.userKeysEnabled,
      chainCameraMotion: s.chainCameraMotion,
    })
    .then((blob) => {
      const next = URL.createObjectURL(blob)
      if (cancelled) {
        URL.revokeObjectURL(next)
        return
      }
      objectUrl = next
      setPreviewUrl(next)
    })
    .catch(() => {
      if (!cancelled) setPreviewUrl('')
    })
    .finally(() => {
      if (!cancelled) input.engine.seek(input.useStore.getState().frame)
    })
  return () => {
    cancelled = true
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function useExportLivePreview(input: {
  engine: DirectorEngine
  useStore: StudioStore
  cameraId: string
  label: string
  start: number
  end: number
  fps: number
  previewWidth: number
  enabled: boolean
}): RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!input.enabled || !canvas) return
    const start = Math.min(input.start, input.end)
    const end = Math.max(input.start, input.end)
    const span = Math.max(1, end - start + 1)
    const fps = Math.max(1, input.fps)
    const durationMs = (span / fps) * 1000
    let elapsed = 0
    let last = performance.now()
    let drawn = -1
    let raf = 0

    const draw = (frame: number) => {
      if (frame === drawn) return
      drawn = frame
      const s = input.useStore.getState()
      input.engine.previewFrameToCanvas({
        cameraId: input.cameraId,
        label: input.label,
        frame,
        width: input.previewWidth,
        height: PREVIEW_HEIGHT,
        canvas,
        userKeys: s.userKeys,
        userKeysEnabled: s.userKeysEnabled,
        chainCameraMotion: s.chainCameraMotion,
      })
    }

    draw(start)
    const tick = (now: number) => {
      elapsed = (elapsed + (now - last)) % durationMs
      last = now
      draw(start + Math.min(span - 1, Math.floor((elapsed / durationMs) * span)))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      input.engine.releaseExportPreview()
      input.engine.seek(input.useStore.getState().frame)
    }
  }, [
    input.cameraId,
    input.enabled,
    input.end,
    input.engine,
    input.fps,
    input.label,
    input.previewWidth,
    input.start,
    input.useStore,
  ])

  return canvasRef
}

export { PREVIEW_HEIGHT }

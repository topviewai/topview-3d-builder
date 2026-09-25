import { localizeMessage } from '../../../locale/messages'
import { useEffect, useRef, useState } from 'react'
import {
  ASPECT_RATIO_MENU_ORDER,
  DEFAULT_ASPECT_RATIO,
  isAutoAspectRatio,
  resolveAspectRatio,
  widthFromAspectHeight,
} from '../../../contract/aspectRatio'
import { defaultVideoExportEndFrame } from '../../../evaluate'
import { clampFrame } from '../../common/rangeSliderUtils'
import { useViewportAspect } from '../../hooks/useViewportAspect'
import { nodesOfType } from '../../../contract/parser'
import { useDirector } from '../../../bridge/DirectorContext'
import { EDITOR_EXPORT_CAMERA_ID, useEngine, type DirectorEngine } from '../../../bridge/useEngine'
import { useT, type TranslateFn } from '../../../locale'
import type { ExportMeta, HostAdapter } from '../../../host/types'
import type { StudioView } from '../../../stores/types'
import { resolveDefaultExportCameraId } from '../utils'
import { PREVIEW_HEIGHT, useExportPreview } from './useExportPreview'

type StudioStore = { getState: () => StudioView }

export type ExportOutputKind = 'image' | 'video'

const EXPORT_HEIGHT = 1080

function exportLabel(cameraId: string, name: string | undefined): string {
  const raw = cameraId === EDITOR_EXPORT_CAMERA_ID ? 'editor' : name || cameraId
  return raw.replace(/[\\/:*?"<>|\s]+/g, '_')
}

export function useExportDialog() {
  const t = useT()
  const { useStore, adapter } = useDirector()
  const engine = useEngine()
  const doc = useStore((s) => s.doc)
  const frame = useStore((s) => s.frame)
  const exporting = useStore((s) => s.exporting)
  const activeCameraId = useStore((s) => s.activeCameraId)
  const tl = doc?.content.timeline
  const cameras = doc ? nodesOfType(doc, 'camera') : []
  const fs = tl?.frameStart ?? 0
  const fe = tl?.frameEnd ?? 0
  const [output, setOutput] = useState<ExportOutputKind>('image')
  const [cameraId, setCameraId] = useState(() =>
    resolveDefaultExportCameraId(cameras, activeCameraId, EDITOR_EXPORT_CAMERA_ID),
  )
  const [currentFrame, setCurrentFrame] = useState(() => clampFrame(frame, fs, fe))
  const [start, setStart] = useState(tl?.frameStart ?? 0)
  const motionClips = doc?.content.timeline.animation.cameraMotionClips ?? []
  const defaultEnd = defaultVideoExportEndFrame(
    motionClips,
    cameraId === EDITOR_EXPORT_CAMERA_ID ? null : cameraId,
    fe,
  )
  const [end, setEnd] = useState(defaultEnd)
  const [aspectRatio, setAspectRatio] = useState(doc?.content.aspectRatio ?? DEFAULT_ASPECT_RATIO)
  useEffect(() => {
    setEnd(clampFrame(defaultEnd, fs, fe))
  }, [cameraId, defaultEnd, fs, fe])
  const viewportAspect = useViewportAspect(isAutoAspectRatio(aspectRatio))
  const numericAspect = resolveAspectRatio(aspectRatio, viewportAspect)
  const width = widthFromAspectHeight(EXPORT_HEIGHT, numericAspect)
  const previewWidth = widthFromAspectHeight(PREVIEW_HEIGHT, numericAspect)
  const label = exportLabel(cameraId, cameras.find((c) => c.id === cameraId)?.name)
  const { previewUrl, previewLoading, previewCanvasRef } = useExportPreview({
    engine,
    useStore,
    cameraId,
    label,
    output,
    imageFrame: currentFrame,
    start,
    end,
    fps: tl?.fps ?? 30,
    previewWidth,
    enabled: Boolean(doc),
    exporting,
  })
  const actions = useExportActions({ t, engine, adapter, useStore, cameraId, label, width, currentFrame, start, end, fps: tl?.fps })

  return {
    t,
    doc,
    tl,
    cameras,
    exporting,
    output,
    setOutput,
    cameraId,
    setCameraId,
    currentFrame,
    setCurrentFrame: (value: number) => {
      const next = clampFrame(value, fs, fe)
      setCurrentFrame(next)
      useStore.getState().setFrame(next)
    },
    start,
    setStart: (value: number) => setStart(clampFrame(value, fs, end)),
    end,
    setEnd: (value: number) => setEnd(clampFrame(value, start, fe)),
    aspectRatio,
    setAspectRatio,
    aspectOptions: ASPECT_RATIO_MENU_ORDER,
    previewUrl,
    previewLoading,
    previewCanvasRef,
    ...actions,
    adapter,
    supportsTopviewCanvas: Boolean(adapter.listTopviewCanvases && adapter.uploadToTopviewCanvas),
    editorCameraId: EDITOR_EXPORT_CAMERA_ID,
    frameStart: fs,
    frameEnd: fe,
  }
}

function useExportActions(input: {
  t: TranslateFn
  engine: DirectorEngine
  adapter: HostAdapter
  useStore: StudioStore
  cameraId: string
  label: string
  width: number
  currentFrame: number
  start: number
  end: number
  fps?: number
}) {
  const [progress, setProgress] = useState<{ frame: number; index: number; total: number } | null>(null)
  const [status, setStatus] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const common = (localDownload: boolean, upload?: (blob: Blob, meta: ExportMeta) => Promise<void>) => {
    const s = input.useStore.getState()
    return {
      onExport: localDownload ? undefined : upload ?? input.adapter.onExport?.bind(input.adapter),
      cameraId: input.cameraId,
      label: input.label,
      width: input.width,
      height: EXPORT_HEIGHT,
      userKeys: s.userKeys,
      userKeysEnabled: s.userKeysEnabled,
      chainCameraMotion: s.chainCameraMotion,
    }
  }

  const beginExport = () => {
    const s = input.useStore.getState()
    if (s.playing) s.togglePlay()
    s.setExporting(true)
    setStatus('')
  }

  const endExport = () => {
    const s = input.useStore.getState()
    s.setExporting(false)
    input.engine.seek(s.frame)
  }

  const runImage = async (localDownload: boolean, upload?: (blob: Blob, meta: ExportMeta) => Promise<void>) => {
    beginExport()
    try {
      await input.engine.captureFrame({ ...common(localDownload, upload), frame: input.currentFrame })
      setStatus(input.t(upload ? 'export.sentToCanvas' : 'export.pngDone', { frame: Math.round(input.currentFrame) }))
    } catch (e) {
      setStatus(input.t('export.failed', { error: localizeMessage(input.t, e) }))
    } finally {
      endExport()
    }
  }

  const runVideo = async (localDownload: boolean, upload?: (blob: Blob, meta: ExportMeta) => Promise<void>) => {
    if (input.fps == null) return
    beginExport()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await input.engine.recordRange({
        ...common(localDownload, upload),
        frameStart: input.start,
        frameEnd: input.end,
        fps: input.fps,
        signal: ac.signal,
        onProgress: (p) => setProgress(p),
      })
      setStatus(res.cancelled ? input.t('export.cancelled') : input.t(upload ? 'export.sentToCanvas' : 'export.videoDone', { frames: res.frames }))
    } catch (e) {
      setStatus(input.t('export.failed', { error: localizeMessage(input.t, e) }))
    } finally {
      abortRef.current = null
      setProgress(null)
      endExport()
    }
  }

  return {
    progress,
    status,
    abort: () => abortRef.current?.abort(),
    onExportImage: () => runImage(false),
    onDownloadImage: () => runImage(true),
    onExportVideo: () => runVideo(false),
    onDownloadVideo: () => runVideo(true),
    sendToCanvas: (canvasId: string, kind: ExportOutputKind) => {
      const upload = (blob: Blob, meta: ExportMeta) => {
        if (!input.adapter.uploadToTopviewCanvas) throw new Error('Topview Canvas 上传不可用')
        return input.adapter.uploadToTopviewCanvas(canvasId, blob, meta)
      }
      return kind === 'image' ? runImage(false, upload) : runVideo(false, upload)
    },
  }
}

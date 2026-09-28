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
import type { TopviewCanvasSent } from './useTopviewCanvasSend'

type StudioStore = { getState: () => StudioView }

export type ExportOutputKind = 'image' | 'video'

export type ExportListItem = {
  id: string
  kind: ExportOutputKind
  cameraId: string
  aspectRatio: string
  label: string
  width: number
  frame: number
  start: number
  end: number
}

type ExportJob = Omit<ExportListItem, 'id' | 'aspectRatio'>

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
  const [list, setList] = useState<ExportListItem[]>([])
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
    list,
    addToList: () => {
      setList((prev) => [
        ...prev,
        {
          id: `${Date.now().toString(36)}-${prev.length}`,
          kind: output,
          cameraId,
          aspectRatio,
          label,
          width,
          frame: currentFrame,
          start,
          end,
        },
      ])
    },
    removeFromList: (id: string) => setList((prev) => prev.filter((item) => item.id !== id)),
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
  const [listProgress, setListProgress] = useState<{ index: number; total: number } | null>(null)
  const [status, setStatus] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const currentJob = (): ExportJob => ({
    kind: 'image',
    cameraId: input.cameraId,
    label: input.label,
    width: input.width,
    frame: input.currentFrame,
    start: input.start,
    end: input.end,
  })

  const payload = (job: ExportJob, localDownload: boolean, upload?: (blob: Blob, meta: ExportMeta) => Promise<void>) => {
    const s = input.useStore.getState()
    return {
      onExport: localDownload ? undefined : upload ?? input.adapter.onExport?.bind(input.adapter),
      cameraId: job.cameraId,
      label: job.label,
      width: job.width,
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

  const failStatus = (ac: AbortController | undefined, error: unknown) => {
    setStatus(ac?.signal.aborted ? input.t('export.cancelled') : input.t('export.failed', { error: localizeMessage(input.t, error) }))
  }

  const renderImage = async (
    job: ExportJob,
    localDownload: boolean,
    upload: ((blob: Blob, meta: ExportMeta) => Promise<void>) | undefined,
    ac: AbortController | undefined,
    lifecycle: boolean,
  ): Promise<boolean> => {
    if (lifecycle) beginExport()
    try {
      await input.engine.captureFrame({ ...payload(job, localDownload, upload), frame: job.frame })
      if (lifecycle) setStatus(input.t(upload ? 'export.sentToCanvas' : 'export.pngDone', { frame: Math.round(job.frame) }))
      return true
    } catch (e) {
      failStatus(ac, e)
      return false
    } finally {
      if (lifecycle) {
        if (abortRef.current === ac) abortRef.current = null
        endExport()
      }
    }
  }

  const renderVideo = async (
    job: ExportJob,
    localDownload: boolean,
    upload: ((blob: Blob, meta: ExportMeta) => Promise<void>) | undefined,
    ac: AbortController,
    lifecycle: boolean,
  ): Promise<boolean> => {
    if (input.fps == null) return false
    if (lifecycle) {
      beginExport()
      abortRef.current = ac
    }
    try {
      const res = await input.engine.recordRange({
        ...payload(job, localDownload, upload),
        frameStart: job.start,
        frameEnd: job.end,
        fps: input.fps,
        signal: ac.signal,
        onProgress: (p) => setProgress(p),
      })
      if (res.cancelled) {
        setStatus(input.t('export.cancelled'))
        return false
      }
      if (lifecycle) setStatus(input.t(upload ? 'export.sentToCanvas' : 'export.videoDone', { frames: res.frames }))
      return true
    } catch (e) {
      failStatus(ac, e)
      return false
    } finally {
      setProgress(null)
      if (lifecycle) {
        if (abortRef.current === ac) abortRef.current = null
        endExport()
      }
    }
  }

  const renderCurrent = (kind: ExportOutputKind, localDownload: boolean) => {
    const job = { ...currentJob(), kind }
    return kind === 'image' ? renderImage(job, localDownload, undefined, undefined, true) : renderVideo(job, localDownload, undefined, new AbortController(), true)
  }

  const uploadTo = (canvasId: string, ac: AbortController, canvasUrl: { value: string }) => {
    return async (blob: Blob, meta: ExportMeta) => {
      if (!input.adapter.uploadToTopviewCanvas) throw new Error('Topview Canvas upload is unavailable')
      const res = await input.adapter.uploadToTopviewCanvas(canvasId, blob, meta, ac.signal)
      if (res?.canvasUrl) canvasUrl.value = res.canvasUrl
    }
  }

  return {
    progress,
    listProgress,
    status,
    abort: () => abortRef.current?.abort(),
    onExportImage: () => renderCurrent('image', false),
    onDownloadImage: () => renderCurrent('image', true),
    onExportVideo: () => renderCurrent('video', false),
    onDownloadVideo: () => renderCurrent('video', true),
    sendToCanvas: async (canvasId: string, kind: ExportOutputKind): Promise<TopviewCanvasSent | null> => {
      const ac = new AbortController()
      abortRef.current = ac
      const canvasUrl = { value: '' }
      const upload = uploadTo(canvasId, ac, canvasUrl)
      const job = { ...currentJob(), kind }
      const ok = kind === 'image' ? await renderImage(job, false, upload, ac, true) : await renderVideo(job, false, upload, ac, true)
      return ok ? { canvasUrl: canvasUrl.value } : null
    },
    sendListToCanvas: async (canvasId: string, items: ExportListItem[]): Promise<TopviewCanvasSent | null> => {
      if (items.length === 0) return null
      if (input.fps == null && items.some((item) => item.kind === 'video')) return null
      const ac = new AbortController()
      abortRef.current = ac
      const canvasUrl = { value: '' }
      beginExport()
      try {
        for (let index = 0; index < items.length; index += 1) {
          if (ac.signal.aborted) {
            setStatus(input.t('export.cancelled'))
            return null
          }
          const item = items[index]
          setListProgress({ index: index + 1, total: items.length })
          const job: ExportJob = { ...item, label: `${item.label}_${index + 1}` }
          const upload = uploadTo(canvasId, ac, canvasUrl)
          const ok = item.kind === 'image'
            ? await renderImage(job, false, upload, ac, false)
            : await renderVideo(job, false, upload, ac, false)
          if (!ok) return null
        }
        setStatus(input.t('export.sentList', { count: items.length }))
        return { canvasUrl: canvasUrl.value }
      } finally {
        setListProgress(null)
        setProgress(null)
        if (abortRef.current === ac) abortRef.current = null
        endExport()
      }
    },
  }
}

import { localizeMessage } from '../../../locale/messages'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import { useEngine, type DirectorEngine } from '../../../bridge/useEngine'
import {
  ASPECT_RATIO_MENU_ORDER,
  DEFAULT_ASPECT_RATIO,
  isAutoAspectRatio,
  resolveAspectRatio,
  widthFromAspectHeight,
} from '../../../contract/aspectRatio'
import type { HostAdapter } from '../../../host/types'
import type { StudioView } from '../../../stores/types'
import {
  getEditSequence,
  getEditSequenceDurationFrames,
  playbackIssues,
  resolveEditSequenceFrame,
} from '../../../evaluate'
import { useT } from '../../../locale'
import { useViewportAspect } from '../../hooks/useViewportAspect'

const PREVIEW_HEIGHT = 360
const DEFAULT_EXPORT_HEIGHT = 1080
const EXPORT_RESOLUTIONS = [
  { height: 720, label: '720p' },
  { height: 1080, label: '1080p' },
  { height: 1440, label: '1440p' },
] as const

function isExportHeight(value: number): value is (typeof EXPORT_RESOLUTIONS)[number]['height'] {
  return EXPORT_RESOLUTIONS.some((item) => item.height === value)
}

interface FilmExportRunInput {
  t: ReturnType<typeof useT>
  engine: DirectorEngine
  useStore: { getState: () => StudioView }
  adapter: HostAdapter
  session: { playback: { getSnapshot: () => { sequenceFrame: number } } }
  sequenceId: string
  fileName: string
  fallbackName: string
  width: number
  height: number
  fps: number
  abortRef: MutableRefObject<AbortController | null>
  setError: (value: string) => void
  setProgress: (value: { index: number; total: number; sourceFrame: number } | null) => void
  setExporting: (value: boolean) => void
  onClose: () => void
  localDownload: boolean
}

async function runFilmExport(input: FilmExportRunInput): Promise<void> {
  input.setError('')
  input.setExporting(true)
  const ac = new AbortController()
  input.abortRef.current = ac
  const store = input.useStore.getState()
  try {
    const result = await input.engine.recordSequence({
      sequenceId: input.sequenceId,
      label: sanitizeExportName(input.fileName, input.fallbackName),
      width: input.width,
      height: input.height,
      fps: input.fps,
      userKeys: store.userKeys,
      userKeysEnabled: store.userKeysEnabled,
      chainCameraMotion: store.chainCameraMotion,
      signal: ac.signal,
      onProgress: (item) => input.setProgress({
        index: item.index,
        total: item.total,
        sourceFrame: item.sourceFrame,
      }),
      onExport: input.localDownload ? undefined : input.adapter.onExport?.bind(input.adapter),
    })
    if (!result.cancelled && !input.localDownload) input.onClose()
  } catch (err) {
    input.setError(localizeMessage(input.t, err))
  } finally {
    if (input.abortRef.current === ac) input.abortRef.current = null
    input.setProgress(null)
    input.setExporting(false)
    if (input.useStore.getState().workspaceMode !== 'film') return
    input.engine.beginProgramPreview()
    input.useStore.getState().seekFilmSequence(input.session.playback.getSnapshot().sequenceFrame)
  }
}

export function useFilmExportDialog(sequenceId: string, onClose: () => void) {
  const t = useT()
  const engine = useEngine()
  const { useStore, adapter, session } = useDirector()
  const doc = useStore((s) => s.doc)
  const exporting = useStore((s) => s.exporting)
  const setExporting = useStore((s) => s.setExporting)
  const sequence = doc ? getEditSequence(doc, sequenceId) : null
  const duration = sequence ? getEditSequenceDurationFrames(sequence.clips) : 0
  const issues = doc ? playbackIssues(doc, sequenceId) : []
  const fps = doc?.content.timeline.fps ?? 1
  const [aspectRatio, setAspectRatio] = useState(doc?.content.aspectRatio ?? DEFAULT_ASPECT_RATIO)
  const [exportHeight, setExportHeight] = useState(DEFAULT_EXPORT_HEIGHT)
  const [fileName, setFileName] = useState(sequence?.name?.trim() ?? '')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{
    index: number
    total: number
    sourceFrame: number
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const viewportAspect = useViewportAspect(isAutoAspectRatio(aspectRatio))
  const numericAspect = resolveAspectRatio(aspectRatio, viewportAspect)
  const width = widthFromAspectHeight(exportHeight, numericAspect)
  const previewWidth = widthFromAspectHeight(PREVIEW_HEIGHT, numericAspect)
  const previewHead = sequence ? resolveEditSequenceFrame(sequence.clips, 0) : null
  const { previewUrl, previewLoading } = useFilmExportPreview({
    enabled: Boolean(doc) && Boolean(previewHead) && issues.length === 0 && !exporting,
    cameraId: previewHead?.cameraNodeId ?? '',
    sourceFrame: previewHead?.sourceFrame ?? 0,
    previewWidth,
  })

  useEffect(() => () => abortRef.current?.abort(), [])

  const versionName = sequence?.name?.trim() || t('film.untitledVersion')

  const start = (localDownload = false) => {
    if (!sequence || issues.length > 0) return
    void runFilmExport({
      t,
      engine,
      useStore,
      adapter,
      session,
      sequenceId,
      fileName,
      fallbackName: versionName,
      width,
      height: exportHeight,
      fps,
      abortRef,
      setError,
      setProgress,
      setExporting,
      onClose,
      localDownload,
    })
  }

  return {
    t,
    sequence,
    duration,
    issues,
    width,
    height: exportHeight,
    fileName,
    setFileName,
    aspectRatio,
    setAspectRatio,
    aspectOptions: ASPECT_RATIO_MENU_ORDER,
    resolutionOptions: EXPORT_RESOLUTIONS.map((item) => ({
      value: String(item.height),
      label: `${item.label} · ${widthFromAspectHeight(item.height, numericAspect)} × ${item.height}`,
    })),
    setExportHeight: (value: string) => {
      const next = Number(value)
      if (isExportHeight(next)) setExportHeight(next)
    },
    previewAspect: numericAspect,
    previewUrl,
    previewLoading,
    progress,
    error,
    exporting,
    abort: () => abortRef.current?.abort(),
    start,
    versionName,
    durationLabel: t('film.durationSeconds', { seconds: Number((duration / fps).toFixed(2)) }),
    canExport: !exporting && issues.length === 0 && duration > 0,
  }
}

function sanitizeExportName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, '').trim()
  return cleaned || fallback.replace(/[\\/:*?"<>|]+/g, '').trim() || 'film'
}

function useFilmExportPreview(input: {
  enabled: boolean
  cameraId: string
  sourceFrame: number
  previewWidth: number
}): { previewUrl: string; previewLoading: boolean } {
  const engine = useEngine()
  const { useStore, session } = useDirector()
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewLoading, setPreviewLoading] = useState(input.enabled && Boolean(input.cameraId))
  const heldUrl = useRef('')

  const adopt = (next: string) => {
    if (heldUrl.current && heldUrl.current !== next) URL.revokeObjectURL(heldUrl.current)
    heldUrl.current = next
    setPreviewUrl(next)
  }

  useEffect(() => () => {
    if (heldUrl.current) URL.revokeObjectURL(heldUrl.current)
    heldUrl.current = ''
  }, [])

  useEffect(() => {
    if (!input.cameraId) {
      adopt('')
      setPreviewLoading(false)
      return
    }
    // 导出占用渲染器时不再重拍，但留着上一帧，避免预览掉成空白。
    if (!input.enabled) {
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    setPreviewLoading(!heldUrl.current)
    const store = useStore.getState()
    void engine
      .previewFrame({
        cameraId: input.cameraId,
        label: 'film-export-preview',
        frame: input.sourceFrame,
        width: input.previewWidth,
        height: PREVIEW_HEIGHT,
        userKeys: store.userKeys,
        userKeysEnabled: store.userKeysEnabled,
        chainCameraMotion: store.chainCameraMotion,
      })
      .then((blob) => {
        const next = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        adopt(next)
        setPreviewLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        if (!heldUrl.current) adopt('')
        setPreviewLoading(false)
      })
      .finally(() => {
        if (cancelled || useStore.getState().workspaceMode !== 'film') return
        engine.beginProgramPreview()
        useStore.getState().seekFilmSequence(session.playback.getSnapshot().sequenceFrame)
      })
    return () => {
      cancelled = true
    }
  }, [
    engine,
    input.cameraId,
    input.enabled,
    input.previewWidth,
    input.sourceFrame,
    session.playback,
    useStore,
  ])

  return { previewUrl, previewLoading }
}

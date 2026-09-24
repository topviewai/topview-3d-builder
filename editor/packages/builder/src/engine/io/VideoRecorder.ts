import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny'
import type { PerspectiveCamera, WebGLRenderer } from 'three'
import type { DirectorDocument } from '../../contract/types'
import {
  getEditSequence,
  getEditSequenceDurationFrames,
  resolveEditSequenceFrame,
} from '../../evaluate/editSequence'
import { playbackIssues } from '../../evaluate/editSequenceOps'
import type { RecordSequenceInput } from '../DirectorEngine'
import { blitRenderTargetToCanvas, renderExportFrameToTarget } from './exportGpu'
import {
  deliverBlob,
  makeOffscreenRenderer,
  renderExportFrame,
  type ExportCommonOptions,
  type ExportProgress,
  type ExportTarget,
} from './exportShared'
import { evenExportSize, exportBitrate, exportFps } from './exportTiming'

export interface VideoExportOptions extends ExportCommonOptions {
  frameStart: number
  frameEnd: number
  fps: number
  signal?: AbortSignal
  onProgress?: (p: ExportProgress) => void
}

export interface SequenceExportOptions extends Omit<RecordSequenceInput, 'onExport' | 'onProgress'> {
  stage: ExportCommonOptions['stage']
  document: DirectorDocument
  onProgress?: RecordSequenceInput['onProgress']
  onExport?: ExportCommonOptions['onExport']
}

export interface ExportResult {
  cancelled: boolean
  frames: number
}

type ExportCodec = 'avc' | 'vp9'

interface ExportProfile {
  codec: ExportCodec
  mimeType: string
  extension: string
  quality: Quality
}

const KEY_FRAME_INTERVAL_SEC = 2
const UNSUPPORTED_ENCODE_MESSAGE =
  '当前浏览器不支持离线视频编码（需要 WebCodecs 的 H.264 或 VP9）。请改用最新版 Chrome 或 Edge。'

function finishGpu(renderer: WebGLRenderer): void {
  const gl = renderer.getContext()
  if (typeof gl.finish === 'function') gl.finish()
}

async function pickExportProfile(width: number, height: number, bitrate: number): Promise<ExportProfile> {
  const quality = new Quality({ bitrate, bitrateMode: 'variable' })
  if (await canEncodeVideo('avc', { width, height, quality })) {
    return { codec: 'avc', mimeType: 'video/mp4', extension: 'mp4', quality }
  }
  if (await canEncodeVideo('vp9', { width, height, quality })) {
    return { codec: 'vp9', mimeType: 'video/webm', extension: 'webm', quality }
  }
  throw new Error(UNSUPPORTED_ENCODE_MESSAGE)
}

interface ExportSurface {
  canvas: HTMLCanvasElement
  draw: (opts: ExportCommonOptions, frame: number, cam: PerspectiveCamera) => void
  finish: () => void
  dispose: () => void
}

function createExportSurface(stage: ExportTarget, width: number, height: number): ExportSurface {
  const gpu = stage.acquireExportGpu?.(width, height)
  if (gpu) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas unavailable')
    return {
      canvas,
      draw(opts, frame, cam) {
        renderExportFrameToTarget(opts, frame, cam, gpu.renderer, gpu.target)
        blitRenderTargetToCanvas(gpu.renderer, gpu.target, ctx, width, height)
      },
      finish() {
        finishGpu(gpu.renderer)
      },
      dispose() {
        stage.restoreAfterExport?.()
      },
    }
  }
  const offscreen = makeOffscreenRenderer(width, height)
  return {
    canvas: offscreen.canvas,
    draw(opts, frame, cam) {
      renderExportFrame(opts, frame, cam, offscreen.renderer)
    },
    finish() {
      finishGpu(offscreen.renderer)
    },
    dispose() {
      offscreen.renderer.dispose()
      stage.restoreAfterExport?.()
    },
  }
}

async function withEncoder(
  stage: ExportTarget,
  rawWidth: number,
  rawHeight: number,
  rawFps: number,
  signal: AbortSignal | undefined,
  run: (input: {
    draw: ExportSurface['draw']
    width: number
    height: number
    fps: number
    extension: string
    capture: (index: number) => Promise<boolean>
  }) => Promise<{ cancelled: boolean; frames: number; filename?: string }>,
  onExport?: ExportCommonOptions['onExport'],
): Promise<ExportResult> {
  const width = evenExportSize(rawWidth)
  const height = evenExportSize(rawHeight)
  const fps = exportFps(rawFps)
  const profile = await pickExportProfile(width, height, exportBitrate(width, height, fps))
  const surface = createExportSurface(stage, width, height)
  const target = new BufferTarget()
  const format =
    profile.codec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat()
  const output = new Output({ format, target })
  const source = new CanvasSource(surface.canvas, {
    codec: profile.codec,
    quality: profile.quality,
    keyFrameInterval: KEY_FRAME_INTERVAL_SEC,
  })
  output.addVideoTrack(source, { frameRate: fps })

  const capture = async (index: number): Promise<boolean> => {
    if (signal?.aborted) return false
    surface.finish()
    await source.add(index / fps, 1 / fps)
    return !signal?.aborted
  }

  let started = false
  try {
    if (signal?.aborted) return { cancelled: true, frames: 0 }
    await output.start()
    started = true
    const result = await run({
      draw: surface.draw,
      width,
      height,
      fps,
      extension: profile.extension,
      capture,
    })
    if (result.cancelled || signal?.aborted) {
      await output.cancel()
      return { cancelled: true, frames: result.frames }
    }
    source.close()
    await output.finalize()
    if (!target.buffer) throw new Error('导出封装失败：没有生成视频数据')
    if (result.frames > 0 && result.filename) {
      await deliverBlob(
        new Blob([new Uint8Array(target.buffer)], { type: profile.mimeType }),
        result.filename,
        profile.mimeType,
        onExport,
      )
    }
    return { cancelled: false, frames: result.frames }
  } catch (error) {
    if (started && output.state !== 'canceled' && output.state !== 'finalized') {
      await output.cancel().catch(() => undefined)
    }
    throw error
  } finally {
    surface.dispose()
  }
}

export async function exportVideo(opts: VideoExportOptions): Promise<ExportResult> {
  const cam = opts.stage.getCameraForExport(opts.cameraId)
  if (!cam) throw new Error(`找不到相机 ${opts.cameraId}`)
  return withEncoder(opts.stage, opts.width, opts.height, opts.fps, opts.signal, async ({ draw, width, height, extension, capture }) => {
    let cancelled = false
    let frames = 0
    const total = opts.frameEnd - opts.frameStart + 1
    const frameOpts = { ...opts, width, height }
    for (let f = opts.frameStart; f <= opts.frameEnd; f++) {
      if (opts.signal?.aborted) {
        cancelled = true
        break
      }
      draw(frameOpts, f, cam)
      if (!(await capture(frames))) {
        cancelled = true
        break
      }
      frames++
      opts.onProgress?.({ frame: f, index: frames, total })
    }
    return {
      cancelled,
      frames,
      filename: `${opts.label}_${opts.frameStart}-${opts.frameEnd}_${width}x${height}.${extension}`,
    }
  }, opts.onExport)
}

export async function exportSequence(opts: SequenceExportOptions): Promise<ExportResult> {
  const issues = playbackIssues(opts.document, opts.sequenceId)
  if (issues.length > 0) throw new Error(issues[0].message)
  const sequence = getEditSequence(opts.document, opts.sequenceId)
  if (!sequence) throw new Error(`找不到成片 ${opts.sequenceId}`)
  const total = getEditSequenceDurationFrames(sequence.clips)
  if (total <= 0) return { cancelled: false, frames: 0 }
  return withEncoder(opts.stage, opts.width, opts.height, opts.fps, opts.signal, async ({ draw, width, height, extension, capture }) => {
    let cancelled = false
    let frames = 0
    const frameOpts = {
      stage: opts.stage,
      cameraId: '',
      label: opts.label,
      width,
      height,
      userKeys: opts.userKeys,
      userKeysEnabled: opts.userKeysEnabled,
      chainCameraMotion: opts.chainCameraMotion,
    }
    for (let sequenceFrame = 0; sequenceFrame < total; sequenceFrame++) {
      if (opts.signal?.aborted) {
        cancelled = true
        break
      }
      const resolved = resolveEditSequenceFrame(sequence.clips, sequenceFrame)
      if (!resolved) throw new Error(`无法解析成片帧 ${sequenceFrame}`)
      const cam = opts.stage.getCameraForExport(resolved.cameraNodeId)
      if (!cam) throw new Error(`找不到相机 ${resolved.cameraNodeId}`)
      frameOpts.cameraId = resolved.cameraNodeId
      draw(frameOpts, resolved.sourceFrame, cam)
      if (!(await capture(frames))) {
        cancelled = true
        break
      }
      frames++
      opts.onProgress?.({
        frame: sequenceFrame,
        index: frames,
        total,
        clipId: resolved.clipId,
        sourceFrame: resolved.sourceFrame,
        cameraNodeId: resolved.cameraNodeId,
      })
    }
    return {
      cancelled,
      frames,
      filename: `${opts.label}.${extension}`,
    }
  }, opts.onExport)
}

/** @deprecated 使用 exportVideo；保留旧名避免外部调用方一时跟不上 */
export const exportVideoWebm = exportVideo
/** @deprecated 使用 exportSequence */
export const exportSequenceWebm = exportSequence

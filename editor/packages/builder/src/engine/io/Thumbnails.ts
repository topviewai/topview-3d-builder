import * as THREE from 'three'
import type { UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { blitRenderTargetToCanvas, renderExportFrameToTarget } from './exportGpu'
import { withExportCameraLayers, type ExportCommonOptions, type ExportTarget } from './exportShared'

export interface ThumbnailRequest {
  cameraId: string
  frame: number
}

export interface ThumbnailBatchInput {
  stage: ExportTarget
  requests: ThumbnailRequest[]
  width: number
  height: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  /** 批次结束后把场景恢复到调用前的求值状态，避免污染主视口。 */
  restore: () => void
}

/**
 * 缩略图渲染器是常驻单例：WebGL context 创建昂贵且浏览器有并发上限，
 * 每张缩略图新建 renderer 会在几十个 clip 的轨道上直接打爆上下文配额。
 */
class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private canvas: HTMLCanvasElement | null = null

  acquire(width: number, height: number): { canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer } {
    if (!this.renderer || !this.canvas) {
      const canvas = document.createElement('canvas')
      this.canvas = canvas
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
      this.renderer.setPixelRatio(1)
    }
    this.renderer.setSize(width, height, false)
    return { canvas: this.canvas, renderer: this.renderer }
  }

  dispose(): void {
    this.renderer?.dispose()
    this.renderer = null
    this.canvas = null
  }
}

const renderers = new WeakMap<ExportTarget, ThumbnailRenderer>()

export function disposeThumbnailRenderer(stage: ExportTarget): void {
  renderers.get(stage)?.dispose()
  renderers.delete(stage)
}

function rendererFor(stage: ExportTarget): ThumbnailRenderer {
  let renderer = renderers.get(stage)
  if (!renderer) {
    renderer = new ThumbnailRenderer()
    renderers.set(stage, renderer)
  }
  return renderer
}

/**
 * 一批请求共用一次场景恢复：evaluate 会改动共享场景图，
 * 逐张恢复会让求值成本翻倍。
 */
export function renderThumbnailBatch(input: ThumbnailBatchInput): (string | null)[] {
  const gpu = input.stage.acquireExportGpu?.(input.width, input.height)
  const scratch = gpu ? document.createElement('canvas') : null
  const ctx = scratch?.getContext('2d') ?? null
  if (scratch) {
    scratch.width = input.width
    scratch.height = input.height
  }
  const fallback = gpu && ctx ? null : rendererFor(input.stage).acquire(input.width, input.height)
  const common: Omit<ExportCommonOptions, 'cameraId' | 'onExport'> = {
    stage: input.stage,
    label: 'thumb',
    width: input.width,
    height: input.height,
    userKeys: input.userKeys,
    userKeysEnabled: input.userKeysEnabled,
    chainCameraMotion: input.chainCameraMotion,
  }
  const out: (string | null)[] = []
  try {
    for (const request of input.requests) {
      const cam = input.stage.getCameraForExport(request.cameraId)
      if (!cam) {
        out.push(null)
        continue
      }
      if (gpu && ctx && scratch) {
        renderExportFrameToTarget({ ...common, cameraId: request.cameraId }, request.frame, cam, gpu.renderer, gpu.target)
        blitRenderTargetToCanvas(gpu.renderer, gpu.target, ctx, input.width, input.height)
        out.push(scratch.toDataURL('image/jpeg', 0.78))
        continue
      }
      const { canvas, renderer } = fallback!
      input.stage.evaluate(request.frame, input.userKeys, input.userKeysEnabled, input.chainCameraMotion)
      const prevAspect = cam.aspect
      cam.aspect = input.width / input.height
      cam.updateProjectionMatrix()
      withExportCameraLayers(cam, () => renderer.render(input.stage.scene, cam))
      cam.aspect = prevAspect
      cam.updateProjectionMatrix()
      out.push(canvas.toDataURL('image/jpeg', 0.78))
    }
  } finally {
    input.restore()
  }
  return out
}

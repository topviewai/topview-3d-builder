import type { DirectorDocument } from '../contract/types'
import { FCurveSet } from '../evaluate/curves/FCurveSet'
import {
  createFrameSnapshot,
  evaluateFrame,
  type FrameSnapshot,
} from '../evaluate/evaluateFrame'
import { sceneFromDocument } from '../evaluate/sceneFromDocument'
import { Stage } from '../engine/core/Stage'
import { makeOffscreenRenderer, renderExportFrame } from '../engine/io/exportShared'
import type { ResolveMediaUrl } from '../engine/io/mediaRefs'

export {
  isResolvableAssetKey,
  normalizeAssetKey,
  resolveMediaKey,
} from '../host/assetKeys'
export { LIBRARY_ASSET_PREFIX } from '../contract/assetKeyPrefixes'

export interface HeadlessRendererOptions {
  resolveMediaUrl: ResolveMediaUrl
  width?: number
  height?: number
  /** Headless / Docker: 同源 Draco decoder 目录，末尾可带或不带 / */
  dracoDecoderPath?: string
}

export interface HeadlessRenderFrameOptions {
  cameraId?: string
  userKeysEnabled?: boolean
  chainCameraMotion?: boolean
}

export interface HeadlessRenderer {
  load(doc: DirectorDocument, fcurves?: unknown): Promise<void>
  renderFrame(frame: number, opts?: HeadlessRenderFrameOptions): Promise<Blob>
  evaluate(frame: number): FrameSnapshot
  dispose(): void
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('canvas.toBlob 返回 null'))
      else resolve(blob)
    }, 'image/png')
  })
}

export function createHeadlessRenderer(options: HeadlessRendererOptions): HeadlessRenderer {
  const width = options.width ?? 1280
  const height = options.height ?? 720
  const stage = new Stage(options.resolveMediaUrl, {
    dracoDecoderPath: options.dracoDecoderPath,
  })
  const offscreen = makeOffscreenRenderer(width, height)
  const snapshot = createFrameSnapshot()

  return {
    async load(doc, fcurves) {
      await stage.load(doc)
      if (fcurves != null) stage.setFcurves(FCurveSet.parse(fcurves))
      else stage.setFcurves(null)
    },
    async renderFrame(frame, opts) {
      const doc = stage.doc
      if (!doc) throw new Error('headless renderer 尚未 load')
      const cameraId =
        opts?.cameraId ??
        doc.content.activeShotCameraNodeId ??
        doc.content.nodes.find((n) => n.type === 'camera')?.id
      if (!cameraId) throw new Error('文档没有可用相机')
      const cam = stage.getCameraForExport(cameraId)
      if (!cam) throw new Error(`找不到相机 ${cameraId}`)
      renderExportFrame(
        {
          stage,
          cameraId,
          label: 'headless',
          width,
          height,
          userKeys: {},
          userKeysEnabled: opts?.userKeysEnabled ?? false,
          chainCameraMotion: opts?.chainCameraMotion ?? false,
        },
        frame,
        cam,
        offscreen.renderer,
      )
      return canvasToPng(offscreen.canvas)
    },
    evaluate(frame) {
      const doc = stage.doc
      if (!doc) throw new Error('headless renderer 尚未 load')
      evaluateFrame(sceneFromDocument(doc, { fcurves: stage.fcurves }), frame, snapshot)
      return snapshot
    },
    dispose() {
      offscreen.renderer.dispose()
      stage.dispose()
    },
  }
}

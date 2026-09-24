import { renderExportFrameToTarget, renderTargetToPngBlob } from './exportGpu'
import { deliverBlob, makeOffscreenRenderer, renderExportFrame, type ExportCommonOptions } from './exportShared'

export async function renderFramePngBlob(opts: ExportCommonOptions & { frame: number }): Promise<Blob> {
  const cam = opts.stage.getCameraForExport(opts.cameraId)
  if (!cam) throw new Error(`找不到相机 ${opts.cameraId}`)
  const gpu = opts.stage.acquireExportGpu?.(opts.width, opts.height)
  try {
    if (gpu) {
      renderExportFrameToTarget(opts, opts.frame, cam, gpu.renderer, gpu.target)
      return await renderTargetToPngBlob(gpu.renderer, gpu.target, opts.width, opts.height)
    }
    const { canvas, renderer } = makeOffscreenRenderer(opts.width, opts.height)
    try {
      renderExportFrame(opts, opts.frame, cam, renderer)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('canvas.toBlob 返回 null')
      return blob
    } finally {
      renderer.dispose()
    }
  } finally {
    opts.stage.restoreAfterExport?.()
  }
}

export async function exportFramePng(opts: ExportCommonOptions & { frame: number }): Promise<void> {
  const blob = await renderFramePngBlob(opts)
  await deliverBlob(blob, `${opts.label}_${opts.frame}.png`, 'image/png', opts.onExport)
}

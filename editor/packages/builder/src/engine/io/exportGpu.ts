import * as THREE from 'three'
import { withExportCameraLayers, type ExportCommonOptions } from './exportShared'
import { flipRgbaRows } from './exportPixels'

const _viewport = new THREE.Vector4()
const _scissor = new THREE.Vector4()

export { flipRgbaRows }

export function renderExportFrameToTarget(
  opts: ExportCommonOptions,
  frame: number,
  cam: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
): void {
  opts.stage.evaluate(frame, opts.userKeys, opts.userKeysEnabled, opts.chainCameraMotion)
  const prevAspect = cam.aspect
  cam.aspect = opts.width / opts.height
  cam.updateProjectionMatrix()
  const prevTarget = renderer.getRenderTarget()
  renderer.getViewport(_viewport)
  renderer.getScissor(_scissor)
  const prevScissorTest = renderer.getScissorTest()
  try {
    renderer.setRenderTarget(target)
    // Render target viewport is already physical pixels. setViewport() would
    // multiply by renderer.pixelRatio and crop the frame on retina Chrome.
    renderer.setScissorTest(false)
    withExportCameraLayers(cam, () => renderer.render(opts.stage.scene, cam))
  } finally {
    renderer.setRenderTarget(prevTarget)
    renderer.setViewport(_viewport)
    renderer.setScissor(_scissor)
    renderer.setScissorTest(prevScissorTest)
    cam.aspect = prevAspect
    cam.updateProjectionMatrix()
  }
}

export function blitRenderTargetToCanvas(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  const image = ctx.createImageData(width, height)
  image.data.set(flipRgbaRows(pixels, width, height))
  ctx.putImageData(image, 0, 0)
}

export async function renderTargetToPngBlob(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  blitRenderTargetToCanvas(renderer, target, ctx, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('canvas.toBlob 返回 null')
  return blob
}

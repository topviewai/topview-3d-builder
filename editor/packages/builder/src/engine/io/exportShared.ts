import * as THREE from 'three'
import type { UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { exportCameraLayerMask } from '../core/Layers'

export interface ExportGpu {
  renderer: THREE.WebGLRenderer
  target: THREE.WebGLRenderTarget
}

export interface ExportTarget {
  scene: THREE.Scene
  evaluate(frame: number, userKeys: UserKeys, userKeysEnabled: boolean, chainCameraMotion?: boolean): void
  getCameraForExport(id: string): THREE.PerspectiveCamera | undefined
  /** 有主视口时复用它的 WebGL，避免再开上下文把主画布挤掉。 */
  acquireExportGpu?(width: number, height: number): ExportGpu | null
  restoreAfterExport?(): void
}

export interface ExportProgress {
  frame: number
  index: number
  total: number
}

export interface ExportCommonOptions {
  stage: ExportTarget
  cameraId: string
  label: string
  width: number
  height: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  onExport?: (blob: Blob, meta: { filename: string; mimeType: string }) => Promise<void>
}

export function makeOffscreenRenderer(width: number, height: number) {
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  return { canvas, renderer }
}

export async function deliverBlob(
  blob: Blob,
  filename: string,
  mimeType: string,
  onExport?: (blob: Blob, meta: { filename: string; mimeType: string }) => Promise<void>,
): Promise<void> {
  if (onExport) {
    await onExport(blob, { filename, mimeType })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function withExportCameraLayers(cam: THREE.Camera, render: () => void): void {
  const prev = cam.layers.mask
  cam.layers.mask = exportCameraLayerMask(prev)
  try {
    render()
  } finally {
    cam.layers.mask = prev
  }
}

export function renderExportFrame(
  opts: ExportCommonOptions,
  frame: number,
  cam: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): void {
  opts.stage.evaluate(frame, opts.userKeys, opts.userKeysEnabled, opts.chainCameraMotion)
  const prevAspect = cam.aspect
  cam.aspect = opts.width / opts.height
  cam.updateProjectionMatrix()
  withExportCameraLayers(cam, () => renderer.render(opts.stage.scene, cam))
  cam.aspect = prevAspect
  cam.updateProjectionMatrix()
}

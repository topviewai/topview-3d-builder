import * as THREE from 'three'

export function createCanvasRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  return renderer
}

export function fitRenderer(r: THREE.WebGLRenderer): boolean {
  const c = r.domElement
  const w = c.clientWidth
  const h = c.clientHeight
  if (w === 0 || h === 0) return false
  const pr = r.getPixelRatio()
  if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) {
    r.setSize(w, h, false)
  }
  return true
}

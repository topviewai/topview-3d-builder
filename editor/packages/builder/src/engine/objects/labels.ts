import * as THREE from 'three'

const FONT = '600 34px system-ui, sans-serif'
const BOX_H = 72
const PAD_X = 22
const RADIUS = 14
/** 文本绘制宽度上限（canvas px），超出就收尾省略号，不允许字形被硬裁 */
const MAX_TEXT_W = 300
const MIN_BOX_W = 96
/** canvas 像素 → 世界单位，沿用旧版 256×72 ≈ 1.5×0.42 的观感 */
const UNIT_PER_PX = 0.42 / BOX_H
/** 超采样倍率：斜视时文字不发虚 */
const SS = 2
const RENDER_ORDER = 900

export interface LabelMeta {
  /** 未截断的完整名称，悬浮气泡用 */
  fullText: string
  /** 实际绘制到贴图上的文本（可能带省略号） */
  displayText: string
  truncated: boolean
  /** 期望的世界尺寸，逐帧用来抵消父级缩放 */
  baseWidth: number
  baseHeight: number
}

const labels = new Set<THREE.Sprite>()
let measureCanvas: CanvasRenderingContext2D | null = null

function measurer(): CanvasRenderingContext2D {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas').getContext('2d')!
  }
  measureCanvas.font = FONT
  return measureCanvas
}

function ellipsize(text: string, maxWidth: number): { text: string; truncated: boolean } {
  const ctx = measurer()
  if (ctx.measureText(text).width <= maxWidth) return { text, truncated: false }
  // 按码点切，避免把 emoji / 代理对劈成半个字符
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const width = ctx.measureText(`${chars.slice(0, mid).join('')}…`).width
    if (width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return { text: `${chars.slice(0, lo).join('')}…`, truncated: true }
}

function tracePill(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, w, h, rr)
    return
  }
  ctx.moveTo(rr, 0)
  ctx.lineTo(w - rr, 0)
  ctx.quadraticCurveTo(w, 0, w, rr)
  ctx.lineTo(w, h - rr)
  ctx.quadraticCurveTo(w, h, w - rr, h)
  ctx.lineTo(rr, h)
  ctx.quadraticCurveTo(0, h, 0, h - rr)
  ctx.lineTo(0, rr)
  ctx.quadraticCurveTo(0, 0, rr, 0)
  ctx.closePath()
}

export function makeLabel(text: string, color: string, scale: number): THREE.Sprite {
  const fullText = text?.trim() ? text.trim() : '—'
  const shown = ellipsize(fullText, MAX_TEXT_W)
  const boxW = Math.max(MIN_BOX_W, Math.ceil(measurer().measureText(shown.text).width) + PAD_X * 2)

  const canvas = document.createElement('canvas')
  canvas.width = boxW * SS
  canvas.height = BOX_H * SS
  const ctx = canvas.getContext('2d')!
  ctx.scale(SS, SS)
  ctx.fillStyle = 'rgba(8,8,12,0.62)'
  ctx.beginPath()
  tracePill(ctx, boxW, BOX_H, RADIUS)
  ctx.fill()
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(shown.text, boxW / 2, BOX_H / 2 + 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      // 标签是标注层，不参与遮挡：关掉深度测试，杜绝被自身网格切掉半截
      depthTest: false,
    }),
  )
  sprite.renderOrder = RENDER_ORDER
  // 标签贴图很小，视锥剔除按锚点判定容易在边缘整块消失
  sprite.frustumCulled = false
  const meta: LabelMeta = {
    fullText,
    displayText: shown.text,
    truncated: shown.truncated,
    baseWidth: boxW * UNIT_PER_PX * scale,
    baseHeight: BOX_H * UNIT_PER_PX * scale,
  }
  sprite.userData.t3dLabel = meta
  sprite.scale.set(meta.baseWidth, meta.baseHeight, 1)
  labels.add(sprite)
  return sprite
}

export function labelMeta(obj: THREE.Object3D): LabelMeta | null {
  const meta = obj.userData?.t3dLabel
  return meta && typeof meta === 'object' ? (meta as LabelMeta) : null
}

/**
 * 对象包围盒顶部，换算到 parent 的本地 Y。
 *
 * 角色原点有的在脚底、有的在髋部，不能拿包围盒高度当本地 Y。
 * 蒙皮网格还要先 `updateMatrixWorld`：`SkeletonUtils.clone` 会按 GLTF 的
 * bindMatrix 重算 inverse，而渲染用的 inverse 是 `updateMatrixWorld` 写进
 * `bindMatrixInverse` 的。只调 `updateWorldMatrix` 时蒙皮等于没生效，骨架上
 * 那一截静置旋转会把包围盒放倒，标签就落在脚边。
 */
export function topYInParent(object: THREE.Object3D, parent: THREE.Object3D): number {
  parent.updateMatrixWorld(true)
  // precise=true 走当前蒙皮顶点；几何体绑定盒在旋转骨架下会回到脚边。
  const box = new THREE.Box3().setFromObject(object, true)
  if (box.isEmpty()) return 0
  const center = box.getCenter(new THREE.Vector3())
  center.y = box.max.y
  parent.worldToLocal(center)
  return center.y
}

function attached(obj: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = obj
  while (node) {
    if ((node as THREE.Scene).isScene) return true
    node = node.parent
  }
  return false
}

/**
 * 逐帧把标签摆正：Sprite 的着色器只吃自身世界矩阵的列长，父级（角色 / 组）的
 * 非等比缩放会直接压扁文字。这里按父级列长反算本地缩放，让世界尺寸恒等于
 * baseWidth × baseHeight，任何机位、任何父级缩放下文本都保持水平且不变形。
 */
export function syncLabelTransforms(): void {
  for (const sprite of labels) {
    if (!attached(sprite)) {
      labels.delete(sprite)
      continue
    }
    const meta = labelMeta(sprite)
    if (!meta) continue
    const parent = sprite.parent
    let kx = 1
    let ky = 1
    if (parent) {
      parent.updateWorldMatrix(true, false)
      const e = parent.matrixWorld.elements
      kx = Math.hypot(e[0], e[1], e[2]) || 1
      ky = Math.hypot(e[4], e[5], e[6]) || 1
    }
    sprite.scale.set(meta.baseWidth / kx, meta.baseHeight / ky, 1)
    const mat = sprite.material as THREE.SpriteMaterial
    if (mat.rotation !== 0) mat.rotation = 0
  }
}

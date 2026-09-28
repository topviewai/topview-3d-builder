// 图片和视频各占一行：同行向右排，新的一行放在已有内容下面。卡片之间留 32，换行留 150。

const GAP = 32
const ROW_GAP = 150
const ORIGIN = 40
const MAX_SHIFT = 50
const MEDIA_W = 480
const MEDIA_H = 270

export type CanvasBox = { type: string; x: number; y: number; w: number; h: number }

type Point = { x: number; y: number }
type Size = { w: number; h: number }

function overlaps(a: CanvasBox, b: CanvasBox): boolean {
  return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y
}

function avoidRight(start: Point, size: Size, obstacles: CanvasBox[]): Point {
  const pos = { ...start }
  for (let attempt = 0; attempt < MAX_SHIFT; attempt += 1) {
    const candidate = { type: '', ...pos, ...size }
    const hits = obstacles.filter((node) => overlaps(candidate, node))
    if (hits.length === 0) return pos
    pos.x = Math.max(...hits.map((node) => node.x + node.w)) + GAP
  }
  return pos
}

function avoidDown(start: Point, size: Size, obstacles: CanvasBox[]): Point {
  const pos = { ...start }
  for (let attempt = 0; attempt < MAX_SHIFT; attempt += 1) {
    const candidate = { type: '', ...pos, ...size }
    const hits = obstacles.filter((node) => overlaps(candidate, node))
    if (hits.length === 0) return pos
    pos.y = Math.max(...hits.map((node) => node.y + node.h)) + GAP
  }
  return pos
}

/** 图片接到图片行右边，视频接到视频行右边；这一类还不存在时，在所有内容下方新开一行。 */
export function placeMediaNode(kind: 'image' | 'video', obstacles: CanvasBox[]): Point {
  const size = { w: MEDIA_W, h: MEDIA_H }
  const same = obstacles.filter((node) => node.type === kind)
  if (same.length === 0) {
    if (obstacles.length === 0) return { x: ORIGIN, y: ORIGIN }
    const minX = Math.min(...obstacles.map((node) => node.x))
    const maxBottom = Math.max(...obstacles.map((node) => node.y + node.h))
    return avoidDown({ x: minX, y: maxBottom + ROW_GAP }, size, obstacles)
  }
  const anchor = same.reduce((best, node) => (node.x + node.w > best.x + best.w ? node : best))
  return avoidRight({ x: anchor.x + anchor.w + GAP, y: anchor.y }, size, obstacles)
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function boxFrom(value: unknown): CanvasBox | null {
  const node = recordOf(value)
  if (!node || node.parentId) return null
  const type = typeof node.type === 'string' ? node.type.toLowerCase() : ''
  const geometry = recordOf(node.geometry) ?? node
  const x = numberOf(geometry.x)
  const y = numberOf(geometry.y)
  if (x == null || y == null) return null
  const media = type === 'image' || type === 'video'
  const w = numberOf(geometry.width) ?? numberOf(geometry.w) ?? (media ? MEDIA_W : 240)
  const h = numberOf(geometry.height) ?? numberOf(geometry.h) ?? (media ? MEDIA_H : 240)
  return { type, x, y, w, h }
}

export function boxesFromCanvasState(structured: unknown): CanvasBox[] {
  const root = recordOf(structured)
  const nodes = root && Array.isArray(root.nodes) ? root.nodes : []
  return nodes.flatMap((node) => {
    const box = boxFrom(node)
    return box ? [box] : []
  })
}

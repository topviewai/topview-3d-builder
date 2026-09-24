import type { DirectorDocument } from './types'

/** 地面透明时透出的默认底色：RGB 30, 30, 30。 */
export const DEFAULT_SKY_COLOR = '#1e1e1e'
/** 旧包默认底色。加载时换成当前默认，已改过的颜色不动。 */
const LEGACY_DEFAULT_SKY_COLOR = '#060608'

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX3 = /^#[0-9a-fA-F]{3}$/

function expandHex3(raw: string): string {
  const r = raw[1]
  const g = raw[2]
  const b = raw[3]
  return `#${r}${r}${g}${g}${b}${b}`
}

export function normalizeSkyHex(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (HEX6.test(raw)) return raw
  if (HEX3.test(raw)) return expandHex3(raw)
  return null
}

export function isLeakedBrowserSkyColor(value: string): boolean {
  const raw = value.trim().toLowerCase()
  return raw === '#0000ff' || raw === '#00f' || raw === 'blue'
}

export function isEmptyDirectorGenesis(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return true
  return nodes.length <= 1
}

export function resolveSkyColor(value: string | undefined, emptyGenesis: boolean): string {
  const normalized = normalizeSkyHex(value)
  if (!normalized || normalized.toLowerCase() === LEGACY_DEFAULT_SKY_COLOR) return DEFAULT_SKY_COLOR
  if (emptyGenesis && isLeakedBrowserSkyColor(value ?? '')) return DEFAULT_SKY_COLOR
  return normalized
}

export function hydrateSkyColor(doc: DirectorDocument): DirectorDocument {
  const background = doc.content.environment?.background
  if (!background) return doc
  const next = resolveSkyColor(background.skyColor, isEmptyDirectorGenesis(doc.content.nodes))
  if (background.skyColor === next) return doc
  background.skyColor = next
  return doc
}

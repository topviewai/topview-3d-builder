export const AUTO_ASPECT_RATIO = 'auto'

export const ASPECT_RATIO_PRESETS = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'] as const

export type AspectRatioPreset = (typeof ASPECT_RATIO_PRESETS)[number]

export const ASPECT_RATIO_MENU_ORDER: readonly (typeof AUTO_ASPECT_RATIO | AspectRatioPreset)[] = [
  AUTO_ASPECT_RATIO,
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]

export const DEFAULT_ASPECT_RATIO = AUTO_ASPECT_RATIO

export const FALLBACK_ASPECT_RATIO: AspectRatioPreset = '21:9'

export const FALLBACK_ASPECT = 21 / 9

export function isAutoAspectRatio(value: string | null | undefined): boolean {
  return (value?.trim().toLowerCase() ?? '') === AUTO_ASPECT_RATIO
}

export function parseAspectRatio(value: string | null | undefined): number {
  const text = value?.trim() ?? ''
  if (!text || isAutoAspectRatio(text)) return FALLBACK_ASPECT
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (!match) return FALLBACK_ASPECT
  const w = Number(match[1])
  const h = Number(match[2])
  if (!(w > 0) || !(h > 0)) return FALLBACK_ASPECT
  return w / h
}

export function resolveAspectRatio(value: string | null | undefined, viewportAspect: number): number {
  if (isAutoAspectRatio(value) || !(value?.trim())) {
    return viewportAspect > 0 ? viewportAspect : FALLBACK_ASPECT
  }
  return parseAspectRatio(value)
}

export function normalizeAspectRatio(value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  if (isAutoAspectRatio(text)) return AUTO_ASPECT_RATIO
  const preset = ASPECT_RATIO_PRESETS.find((item) => item === text)
  if (preset) return preset
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (!match) return DEFAULT_ASPECT_RATIO
  const w = Number(match[1])
  const h = Number(match[2])
  if (!(w > 0) || !(h > 0)) return DEFAULT_ASPECT_RATIO
  return `${trimRatioPart(w)}:${trimRatioPart(h)}`
}

export function isAspectRatioPreset(value: string): value is AspectRatioPreset {
  return (ASPECT_RATIO_PRESETS as readonly string[]).includes(value)
}

export function isAspectRatioMenuItem(value: string): boolean {
  return isAutoAspectRatio(value) || isAspectRatioPreset(value)
}

export function aspectRatioLabel(value: string, autoLabel: string): string {
  return isAutoAspectRatio(value) ? autoLabel : value
}

export function widthFromAspectHeight(height: number, aspect: number): number {
  return Math.round(height * aspect)
}

function trimRatioPart(n: number): string {
  return String(Number(n.toFixed(4)))
}

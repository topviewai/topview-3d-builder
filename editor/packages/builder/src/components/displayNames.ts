import type { CameraMotionClip, DraftNode } from '../contract/types'
import { CAMERA_PRESETS } from '../data/cameraLibrary'
import type { TranslateFn } from '../locale/types'
import { cameraMotionLabel } from '../locale/labels'

const PATH_INDEX_RE = /^轨迹(\d+)$/
const MAIN_CAMERA_NAMES = new Set(['主相机', 'Main Camera'])

function translated(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

function splitIndexedSuffix(name: string): { base: string; suffix: string } {
  const match = name.match(/^(.*)_(\d+)$/)
  if (!match) return { base: name, suffix: '' }
  return { base: match[1], suffix: `_${match[2]}` }
}

export function displayCameraName(t: TranslateFn, persistName: string): string {
  if (MAIN_CAMERA_NAMES.has(persistName)) {
    return translated(t, 'viewport.mainCamera', persistName)
  }
  const { base, suffix } = splitIndexedSuffix(persistName)
  const preset = CAMERA_PRESETS.find((item) => item.name === base)
  if (!preset) return persistName
  return `${translated(t, `cameraPreset.${preset.id}`, base)}${suffix}`
}

export function displayPathName(t: TranslateFn, persistName: string): string {
  const match = persistName.match(PATH_INDEX_RE)
  if (!match) return persistName
  return t('viewport.pathIndexed', { n: match[1] })
}

export function displayCameraMotionName(t: TranslateFn, clip: Pick<CameraMotionClip, 'motion'>): string {
  return cameraMotionLabel(t, clip.motion.presetId, clip.motion.label)
}

export function displayNodeName(t: TranslateFn, node: Pick<DraftNode, 'type' | 'name'>): string {
  if (node.type === 'camera') return displayCameraName(t, node.name)
  if (node.type === 'path') return displayPathName(t, node.name)
  return node.name
}

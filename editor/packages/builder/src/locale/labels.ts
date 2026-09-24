import { CAMERA_MOTIONS } from '../data/cameraLibrary'
import type { TranslateFn } from './types'

/** Translate built-in motion names at display time, preserving custom clip labels. */
export function cameraMotionLabel(t: TranslateFn, presetId: string, label: string): string {
  const preset = CAMERA_MOTIONS.find((item) => item.id === presetId)
  return preset && preset.name === label ? t(`cameraMotion.${presetId}.name`) : label
}

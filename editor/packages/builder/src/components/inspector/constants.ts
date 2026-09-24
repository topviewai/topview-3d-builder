export const PARAM_LABEL: Record<string, string> = {
  durationMs: 'inspector.durationMs',
  distance: 'inspector.distance',
  fovDelta: 'inspector.fovDelta',
  height: 'inspector.height',
  keyframeCount: 'inspector.keyframeCount',
  shakeAmplitude: 'inspector.shakeAmplitude',
}

export const EXTRA_PARAM_RANGE: Record<string, { min: number; max: number; step: number }> = {
  distance: { min: 0.1, max: 3, step: 0.1 },
  fovDelta: { min: -40, max: 40, step: 1 },
  height: { min: -2, max: 2, step: 0.1 },
  keyframeCount: { min: 2, max: 24, step: 1 },
  shakeAmplitude: { min: 0, max: 0.2, step: 0.005 },
}

export { EASINGS, type EasingKind } from '../common/EasingCurveCards'

export const NODE_DELETE_LABEL: Record<string, string> = {
  prop: 'inspector.deleteProp',
  group: 'inspector.deleteGroup',
}

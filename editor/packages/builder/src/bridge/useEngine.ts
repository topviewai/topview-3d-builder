import type { DirectorEngine } from '../engine/DirectorEngine'
import { useDirector } from './DirectorContext'

export { EDITOR_EXPORT_CAMERA_ID } from '../engine/DirectorEngine'
export type { DirectorEngine } from '../engine/DirectorEngine'

export function useEngine(): DirectorEngine {
  return useDirector().stage
}

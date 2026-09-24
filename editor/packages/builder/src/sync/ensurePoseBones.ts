import type { PoseLibraryBank } from '../data/poseLibraryBank'
import type { HostAdapter } from '../host/types'

export { collectUsedPoseIds } from '../data/collectPoseLibrary'

export async function ensurePoseBones(
  adapter: HostAdapter,
  ids: readonly string[],
  bank: PoseLibraryBank,
): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))]
  await Promise.all(
    unique.map(async (id) => {
      const pose = bank.get(id)
      if (pose?.bonesLoaded) return
      const payload = pose?.modelUrl && adapter.loadPoseAsset
        ? await adapter.loadPoseAsset(pose.modelUrl)
        : adapter.loadPoseById
          ? await adapter.loadPoseById(id)
          : null
      if (!payload) return
      bank.applyBones(id, payload.hips, payload.bones)
    }),
  )
}

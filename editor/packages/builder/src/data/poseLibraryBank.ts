/**
 * 姿势库运行时表。数据只来自宿主 `searchAssets({ kind: 'pose' })`，
 * 包内不再烘焙 generated / 图集。
 *
 * - `bones` 是 mixamorig 名 → 世界系四元数增量 `W_posed * W_rest⁻¹`（xyzw）
 * - `hips` 是髋骨世界位移（米，相对该 clip 的 FBX rest）
 * - 旧旋钮预设仍走 `posePresets.ts`
 */

/** 已知分类的展示顺序；页签本身只来自目录数据，不再预置 common。 */
export const POSE_LIBRARY_TAG_ORDER = ['stand', 'sit', 'lie', 'move', 'action'] as const

export type PoseLibraryTag = string

export type PoseLibraryQuat = readonly [number, number, number, number]

export interface PoseLibraryRecord {
  id: string
  name: string
  nameZh: string
  tag: PoseLibraryTag
  tags: string[]
  rank: number
  coverUrl?: string
  modelUrl?: string
  hips: readonly [number, number, number]
  bones: Record<string, PoseLibraryQuat>
  bonesLoaded: boolean
}

function normalizePoseTag(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectPoseTags(tag: string, tags: readonly string[]): string[] {
  const next = tags.filter((item) => item && item !== tag)
  return tag ? [tag, ...next] : next
}

/** 每个 Stage 一份；默认实例仅用于独立 evaluate API 的向后兼容。 */
export class PoseLibraryBank {
  private poses: PoseLibraryRecord[] = []
  private byId: Record<string, PoseLibraryRecord> = {}

  set(items: readonly PoseLibraryRecord[]): void {
    const previous = this.byId
    this.poses = [...items]
      .map((item) => {
        const old = previous[item.id]
        if (old?.bonesLoaded) {
          return {
            ...item,
            hips: old.hips,
            bones: old.bones,
            bonesLoaded: true,
            modelUrl: item.modelUrl || old.modelUrl,
          }
        }
        return item
      })
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    this.byId = Object.fromEntries(this.poses.map((pose) => [pose.id, pose]))
  }

  applyBones(
    id: string,
    hips: readonly [number, number, number],
    bones: Record<string, PoseLibraryQuat>,
  ): PoseLibraryRecord | undefined {
    const current = this.byId[id]
    const next: PoseLibraryRecord = current
      ? { ...current, hips, bones, bonesLoaded: true }
      : {
          id,
          name: id,
          nameZh: id,
          tag: '',
          tags: [],
          rank: 100,
          hips,
          bones,
          bonesLoaded: true,
        }
    this.byId[id] = next
    this.poses = current
      ? this.poses.map((pose) => (pose.id === id ? next : pose))
      : [...this.poses, next].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    return next
  }

  get(id: string | undefined): PoseLibraryRecord | undefined {
    if (!id) return undefined
    return this.byId[id]
  }

  has(id: string | undefined): boolean {
    return !!this.get(id)
  }

  list(tag?: PoseLibraryTag | 'all'): PoseLibraryRecord[] {
    if (!tag || tag === 'all') return [...this.poses]
    return this.poses.filter((pose) => pose.tag === tag || pose.tags.includes(tag))
  }

  listTags(): string[] {
    const seen = new Set<string>()
    for (const pose of this.poses) {
      if (pose.tag) seen.add(pose.tag)
      for (const item of pose.tags) {
        if (item) seen.add(item)
      }
    }
    const known = POSE_LIBRARY_TAG_ORDER.filter((item) => seen.has(item))
    const rest = [...seen].filter((item) => !(POSE_LIBRARY_TAG_ORDER as readonly string[]).includes(item)).sort()
    return [...known, ...rest]
  }

  defaultId(): string | undefined {
    return this.poses[0]?.id
  }

  rootOffset(poseId: string): { x: number; y: number; z: number } | null {
    const pose = this.get(poseId)
    if (!pose || !pose.bonesLoaded) return null
    const baseId = this.defaultId()
    const basePose = baseId ? this.get(baseId) : undefined
    const base = basePose?.bonesLoaded ? basePose.hips : [0, 0, 0]
    return {
      x: pose.hips[0] - base[0],
      y: pose.hips[1] - base[1],
      z: pose.hips[2] - base[2],
    }
  }
}

export const defaultPoseLibraryBank = new PoseLibraryBank()

export function setPoseLibraryBank(items: readonly PoseLibraryRecord[]): void {
  defaultPoseLibraryBank.set(items)
}

export function applyPoseBones(
  id: string,
  hips: readonly [number, number, number],
  bones: Record<string, PoseLibraryQuat>,
): PoseLibraryRecord | undefined {
  return defaultPoseLibraryBank.applyBones(id, hips, bones)
}

export function getPoseLibraryPose(id: string | undefined): PoseLibraryRecord | undefined {
  return defaultPoseLibraryBank.get(id)
}

export function isPoseLibraryPoseId(id: string | undefined): boolean {
  return defaultPoseLibraryBank.has(id)
}

export function isPoseLibraryPoseSelected(currentId: string | undefined, poseId: string): boolean {
  return currentId === poseId
}

export function listPoseLibraryPoses(tag?: PoseLibraryTag | 'all'): PoseLibraryRecord[] {
  return defaultPoseLibraryBank.list(tag)
}

export function listPoseLibraryTags(): string[] {
  return defaultPoseLibraryBank.listTags()
}

export function defaultPoseLibraryPoseId(): string | undefined {
  return defaultPoseLibraryBank.defaultId()
}

export function poseLibraryRootOffset(poseId: string): { x: number; y: number; z: number } | null {
  return defaultPoseLibraryBank.rootOffset(poseId)
}

export function poseRecordFromLibrary(item: {
  id: string
  name: string
  nameZh?: string
  tag?: string
  tags?: string[]
  rank?: number
  coverUrl?: string
  modelUrl?: string
  hips?: readonly [number, number, number]
  bones?: Record<string, PoseLibraryQuat>
  bonesLoaded?: boolean
}): PoseLibraryRecord | null {
  if (!item.id) return null
  const hasPayload = !!item.hips && !!item.bones
  const tags = (item.tags ?? []).map(normalizePoseTag).filter(Boolean)
  const tag = normalizePoseTag(item.tag) || tags[0] || ''
  return {
    id: item.id,
    name: item.name,
    nameZh: item.nameZh || item.name,
    tag,
    tags: collectPoseTags(tag, tags),
    rank: item.rank ?? 100,
    coverUrl: item.coverUrl,
    modelUrl: item.modelUrl,
    hips: item.hips ?? [0, 0, 0],
    bones: item.bones ?? {},
    bonesLoaded: item.bonesLoaded ?? hasPayload,
  }
}

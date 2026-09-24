// 新建文档的统一形态：空场景骨架 + 原点上的默认角色。宿主只决定何时新建、存到哪，
// 「默认场景长什么样」由包定义，避免各宿主各写一份而彼此分叉。
import { makeEmptyDraft, type EmptyDraftCamera } from '../contract/emptyDraft'
import type { DirectorDocument } from '../contract/types'
import {
  DEFAULT_CHARACTER,
  INITIAL_DRAFT_SEED,
  type DefaultCharacterPreset,
} from '../data/defaultCharacter'
import type {
  CharacterLibEntry,
  HostAdapter,
  MotionLibEntry,
  PoseLibEntry,
  PropLibEntry,
} from '../host/types'
import { applyPoseInPlace, buildCharacterNode } from './studioIntents'

/** 角色库总量很小，一页拉满即可，不做翻页循环。 */
const CHARACTER_PAGE_SIZE = 100

type LibEntry = CharacterLibEntry | PropLibEntry | MotionLibEntry | PoseLibEntry

export interface InitialDraftInput {
  name: string
  fps: number
  totalFrames: number
  camera?: EmptyDraftCamera
  character?: DefaultCharacterPreset
}

/** 名称对不上时退回第一条：默认角色是摆设，不该因为库改名就让新稿空着。 */
export function pickDefaultCharacter(
  items: readonly LibEntry[],
  preset: DefaultCharacterPreset = DEFAULT_CHARACTER,
): CharacterLibEntry | null {
  const characters = items.filter(
    (item): item is CharacterLibEntry =>
      'file' in item && typeof item.file === 'string' && item.file.length > 0,
  )
  const wanted = preset.name.trim().toLowerCase()
  return characters.find((item) => item.name.trim().toLowerCase() === wanted)
    ?? characters[0]
    ?? null
}

export function seedDefaultCharacterInPlace(
  doc: DirectorDocument,
  entry: CharacterLibEntry,
  preset: DefaultCharacterPreset = DEFAULT_CHARACTER,
): string {
  const node = buildCharacterNode(doc, {
    type: 'add-character',
    libraryId: entry.id,
    name: entry.name,
    modelUrl: entry.file,
    rig: entry.rig,
  })
  node.transform.position = { x: 0, y: 0, z: 0 }
  if (node.character) {
    node.character.gender = preset.gender
    node.character.appearance.color = preset.color
  }
  doc.content.nodes.push(node)
  applyPoseInPlace(doc, { type: 'apply-pose', nodeId: node.id, presetId: preset.posePresetId })
  doc.extra = {
    ...(typeof doc.extra === 'object' && doc.extra !== null ? doc.extra : {}),
    initialSeed: INITIAL_DRAFT_SEED,
  }
  return node.id
}

/** 只在宿主确认是「新建」时调用；打开既有文档不要再种，否则用户删掉的人会被加回来。 */
export async function createInitialDraft(
  adapter: Pick<HostAdapter, 'searchAssets'>,
  input: InitialDraftInput,
): Promise<DirectorDocument> {
  const preset = input.character ?? DEFAULT_CHARACTER
  const doc = makeEmptyDraft(input.name, input.fps, input.totalFrames, input.camera)
  let items: readonly LibEntry[]
  try {
    const page = await adapter.searchAssets({
      kind: 'character',
      pageNo: 1,
      pageSize: CHARACTER_PAGE_SIZE,
    })
    items = page.items
  } catch {
    return doc
  }
  const entry = pickDefaultCharacter(items, preset)
  if (entry) seedDefaultCharacterInPlace(doc, entry, preset)
  return doc
}

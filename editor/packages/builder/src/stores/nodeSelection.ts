import type { DraftNode } from '../contract/types'
import { isDerivedTransformPath } from '../evaluate/path/deriveWalk'
import type { Selection } from './types'

export function nodeIdsOf(selection: Selection | null): string[] {
  if (selection?.kind !== 'node') return []
  if (selection.nodeIds?.length) return [...selection.nodeIds]
  return selection.nodeId ? [selection.nodeId] : []
}

export function buildNodeSelection(ids: readonly string[]): Selection | null {
  const unique = [...new Set(ids.filter((id) => id.length > 0))]
  if (unique.length === 0) return null
  return { kind: 'node', nodeId: unique[unique.length - 1], nodeIds: unique }
}

/** Viewport picking never adds locked nodes to the editable selection. */
export function unlockedNodeIds(
  nodes: readonly Pick<DraftNode, 'id' | 'locked'>[],
  ids: readonly string[],
): string[] {
  return [...new Set(ids)].filter((id) => nodes.some((node) => node.id === id && !node.locked))
}

export function toggleNodeIds(
  current: string[] | undefined,
  primary: string | undefined,
  id: string,
): string[] {
  const ids = current?.length ? [...current] : primary ? [primary] : []
  const index = ids.indexOf(id)
  if (index >= 0) ids.splice(index, 1)
  else ids.push(id)
  return ids
}

export function isLookAtPickTarget(
  node: (Pick<DraftNode, 'id' | 'type' | 'visible'> & { locked?: boolean }) | undefined,
  cameraId: string,
): boolean {
  if (!node || node.id === cameraId || node.visible === false || node.locked) return false
  return node.type === 'character' || node.type === 'prop' || node.type === 'primitive'
}

/** 手绘轨迹可以绑到这些节点上：角色、机位、道具、基础形状。 */
export function isPathApplyTarget(node: Pick<DraftNode, 'type'> | undefined): boolean {
  if (!node) return false
  return (
    node.type === 'character'
    || node.type === 'camera'
    || node.type === 'prop'
    || node.type === 'primitive'
  )
}

/** 视口点选绑定：可见、未锁定，且不是轨迹自身。 */
export function isPathApplyPickTarget(
  node: (Pick<DraftNode, 'id' | 'type' | 'visible'> & { locked?: boolean }) | undefined,
  pathId: string,
): boolean {
  if (!node || node.id === pathId || node.visible === false || node.locked) return false
  return isPathApplyTarget(node)
}

export function isPathEditTarget(node: DraftNode | undefined): node is DraftNode {
  return Boolean(
    node
    && node.type === 'path'
    && node.path
    && node.path.points.length > 0
    && !isDerivedTransformPath(node),
  )
}

export function cameraPilotEligibleId(
  nodes: readonly Pick<DraftNode, 'id' | 'type' | 'visible' | 'locked'>[],
  selection: Selection | null,
): string | null {
  const ids = nodeIdsOf(selection)
  if (ids.length !== 1) return null
  const node = nodes.find((item) => item.id === ids[0])
  if (!node || node.type !== 'camera' || node.visible === false || node.locked) return null
  return node.id
}

export function poseEditEligibleId(
  nodes: readonly Pick<DraftNode, 'id' | 'type' | 'visible' | 'locked'>[],
  selection: Selection | null,
): string | null {
  const ids = nodeIdsOf(selection)
  if (ids.length !== 1) return null
  const node = nodes.find((item) => item.id === ids[0])
  if (!node || node.type !== 'character' || node.visible === false || node.locked) return null
  return node.id
}

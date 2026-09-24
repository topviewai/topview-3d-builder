import * as THREE from 'three'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import type { DraftNode } from '../../contract/types'
import { EDITOR_LAYER, GRID_LAYER } from '../core/Layers'
import { Ual1Retargeter } from '../rig/applyRetarget'
import { measureLegLength } from '../rig/poseRootScale'
import { applyTransform } from './transform'
import { CHARACTER_LABEL_KIND } from './environment'
import { makeLabel, topYInParent } from './labels'
import { CharacterAnimator } from './MotionPlayer'
import { isCentimeterMixamorig } from '../rig/mixamorigBind'
import { CENTIMETER_MIXAMORIG_SCALE } from '../rig/standBasePose'
import type { StageGraph } from './graph'
import type { CharInstance } from './types'
import { clearSkinnedRaycastBounds } from './skinnedBounds'
import { markTemplateShared } from './templateShared'

function resolveCharacterRig(metadata: unknown): CharInstance['rig'] {
  if (!metadata || typeof metadata !== 'object') return 'mixamorig'
  const meta = metadata as Record<string, unknown>
  if (meta.rig === 'ual1' || meta.rig === 'mixamorig') return meta.rig
  if (meta.assetSource === 'user') return 'ual1'
  return 'mixamorig'
}

export function buildCharacterInstance(
  graph: StageGraph,
  n: DraftNode,
  template: THREE.Object3D,
  labelsVisible: boolean,
): void {
  const rig = resolveCharacterRig(n.metadata)
  const root = new THREE.Group()
  root.name = n.id
  root.userData.isRiggedCharacter = true
  const inner = skeletonClone(template)
  markTemplateShared(inner)
  const color = new THREE.Color(n.character?.appearance.color ?? '#cccccc')
  inner.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (rig === 'ual1') {
      const raw = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const mat = raw as THREE.MeshStandardMaterial
      const cloned = mat.clone()
      if (cloned.color && cloned.color.getHex() === 0xffffff) {
        cloned.color.copy(color)
        mesh.userData.t3dTint = true
      }
      mesh.material = cloned
    } else {
      mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 })
      mesh.userData.t3dTint = true
    }
    mesh.frustumCulled = false
  })
  root.userData.isRiggedCharacter = true
  root.add(inner)
  // 只有厘米绑定的官方 mixamorig 才乘皮皮特归一化；米制 Child 已经是米，再乘会缩错。
  if (rig === 'mixamorig' && isCentimeterMixamorig(inner)) inner.scale.setScalar(CENTIMETER_MIXAMORIG_SCALE)
  applyTransform(root, n.transform)
  clearSkinnedRaycastBounds(inner)
  const labelCfg = n.character?.label
  const sprite = makeLabel(n.name, n.character?.appearance.color ?? '#ffffff', labelCfg?.scale || 1)
  sprite.userData.t3dKind = CHARACTER_LABEL_KIND
  sprite.visible = labelsVisible && labelCfg?.showLabel !== false
  sprite.position.set(0, topYInParent(inner, root) + 0.18 + (labelCfg?.yOffset ?? 0), 0)
  sprite.traverse((o) => {
    o.layers.set(EDITOR_LAYER)
    o.layers.enable(GRID_LAYER)
  })
  root.add(sprite)
  const prev = graph.characters.get(n.id)
  if (prev) graph.scene.remove(prev.root)
  for (const child of [...graph.scene.children]) {
    if (child.name === n.id && child !== prev?.root) graph.scene.remove(child)
  }
  graph.scene.add(root)
  const restPose = new Map<string, THREE.Quaternion>()
  const restPos = new Map<string, THREE.Vector3>()
  inner.traverse((obj) => {
    if (!obj.name) return
    restPose.set(obj.name, obj.quaternion.clone())
    restPos.set(obj.name, obj.position.clone())
  })
  graph.characters.set(n.id, {
    node: n,
    root,
    inner,
    rig,
    animator: new CharacterAnimator(inner),
    retargeter: rig === 'ual1' ? new Ual1Retargeter(inner) : null,
    restPose,
    restPos,
    legLength: measureLegLength(root, inner),
  })
}

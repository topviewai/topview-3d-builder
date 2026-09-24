import * as THREE from 'three'
import { isEmptyDirectorGenesis, resolveSkyColor } from '../../contract/skyColor'
import type { DirectorDocument } from '../../contract/types'
import { EDITOR_LAYER, GRID_LAYER } from '../core/Layers'
import { GROUND_GRID_SIZE, createGroundGrid } from './groundGrid'
import type { StageGraph } from './graph'
import { makeLabel, topYInParent } from './labels'
import { clearSkinnedRaycastBounds } from './skinnedBounds'
import type { CharInstance } from './types'
import { isTemplateShared } from './templateShared'

export const GROUND_NAME = 't3d-ground'
export const GRID_NAME = 't3d-grid'
export const CHARACTER_LABEL_KIND = 'characterLabel'
export const OBJECT_LABEL_KIND = 'objectLabel'
/** 可见地面边长（米）。与地面网格外沿重合，路径绘制的有效范围必须与它一致。 */
export const GROUND_SIZE = GROUND_GRID_SIZE
/** 地面固有色 RGB 30, 30, 30。透明地面透出的也是同一档亮度。 */
const GROUND_COLOR = 0x1e1e1e

export function addEnvironment(scene: THREE.Scene, doc: DirectorDocument): void {
  applySkyColor(scene, doc)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.0))
  const dir = new THREE.DirectionalLight(0xffffff, 1.8)
  dir.position.set(5, 10, 7)
  scene.add(dir)
  scene.add(new THREE.AmbientLight(0xffffff, 0.3))

  const grid = createGroundGrid()
  grid.name = GRID_NAME
  scene.add(grid)
  ensureGround(scene, doc)
}

export function applyEnvironment(graph: StageGraph): void {
  const doc = graph.doc
  if (!doc) return
  applySkyColor(graph.scene, doc)
  ensureGround(graph.scene, doc)
  applyCharacterLook(graph)
  applyPropAndPrimitiveLook(graph)
}

function applyCharacterLook(graph: StageGraph): void {
  const doc = graph.doc
  if (!doc) return
  const sceneLabels = doc.content.environment.display?.characterLabelsVisible !== false
  for (const [id, ch] of graph.characters) {
    const node = doc.content.nodes.find((n) => n.id === id)
    const colorHex = node?.character?.appearance.color ?? '#cccccc'
    const showLabel = node?.character?.label?.showLabel !== false
    const name = node?.name ?? id
    const labelScale = (node?.character?.label?.scale || 1) * 0.7
    const yOffset = node?.character?.label?.yOffset ?? 0
    const labelVisible = sceneLabels && showLabel
    const sig = `${colorHex}|${labelVisible}|${name}|${labelScale}|${yOffset}`
    if (ch.root.userData.t3dLook === sig) continue
    const prev = typeof ch.root.userData.t3dLook === 'string' ? ch.root.userData.t3dLook : ''
    ch.root.userData.t3dLook = sig
    if (!prev || prev.split('|')[0] !== colorHex) tintCharacter(ch, colorHex)
    syncCharacterLabel(ch, name, colorHex, labelVisible, labelScale, yOffset)
  }
}

function tintCharacter(ch: CharInstance, colorHex: string): void {
  const color = new THREE.Color(colorHex)
  ch.inner.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData.t3dTint) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const item of list) {
      const std = item as THREE.MeshStandardMaterial
      if (std.color) std.color.copy(color)
    }
  })
}

function syncCharacterLabel(
  ch: CharInstance,
  name: string,
  colorHex: string,
  visible: boolean,
  scale: number,
  yOffset: number,
): void {
  let sprite: THREE.Sprite | undefined
  for (const child of ch.root.children) {
    if (child.userData.t3dKind === CHARACTER_LABEL_KIND) {
      sprite = child as THREE.Sprite
      break
    }
  }
  if (!sprite) {
    clearSkinnedRaycastBounds(ch.inner)
    sprite = makeLabel(name, colorHex, scale)
    sprite.userData.t3dKind = CHARACTER_LABEL_KIND
    sprite.position.set(0, topYInParent(ch.inner, ch.root) + 0.18 + yOffset, 0)
    sprite.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    ch.root.add(sprite)
  } else if (sprite.userData.t3dLabelSig !== `${name}|${colorHex}|${scale}`) {
    const next = makeLabel(name, colorHex, scale)
    next.userData.t3dKind = CHARACTER_LABEL_KIND
    next.position.copy(sprite.position)
    next.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    ch.root.remove(sprite)
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map?.dispose()
    mat.dispose()
    ch.root.add(next)
    sprite = next
  }
  sprite.userData.t3dLabelSig = `${name}|${colorHex}|${scale}`
  sprite.visible = visible
}


function applyPropAndPrimitiveLook(graph: StageGraph): void {
  const doc = graph.doc
  if (!doc) return
  for (const [id, root] of graph.props) {
    const node = doc.content.nodes.find((n) => n.id === id)
    const colorHex = node?.prop?.appearance?.color ?? '#cccccc'
    syncObjectLabel(root, node?.name ?? id, colorHex, node?.prop?.label?.showLabel === true)
    const prev = typeof root.userData.t3dLook === 'string' ? root.userData.t3dLook : ''
    if (prev === colorHex) continue
    root.userData.t3dLook = colorHex
    tintObjectTree(root, colorHex)
  }
  for (const [id, mesh] of graph.primitives) {
    const node = doc.content.nodes.find((n) => n.id === id)
    const parent = node?.parentId ? doc.content.nodes.find((n) => n.id === node.parentId) : undefined
    const colorHex =
      node?.primitive?.appearance?.color ?? parent?.group?.appearance.color ?? '#cccccc'
    syncObjectLabel(mesh, node?.name ?? id, colorHex, node?.primitive?.label?.showLabel === true)
    const prev = typeof mesh.userData.t3dLook === 'string' ? mesh.userData.t3dLook : ''
    if (prev === colorHex) continue
    mesh.userData.t3dLook = colorHex
    tintObjectTree(mesh, colorHex)
  }
}

function syncObjectLabel(object: THREE.Object3D, name: string, colorHex: string, visible: boolean): void {
  let sprite = object.children.find((child) => child.userData.t3dKind === OBJECT_LABEL_KIND) as THREE.Sprite | undefined
  if (!sprite && !visible) return
  const signature = `${name}|${colorHex}`
  if (!sprite) {
    sprite = makeLabel(name, colorHex, 0.7)
    sprite.userData.t3dKind = OBJECT_LABEL_KIND
    sprite.userData.t3dLabelSig = signature
    sprite.position.set(0, topYInParent(object, object) + 0.18, 0)
    sprite.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    object.add(sprite)
  } else if (sprite.userData.t3dLabelSig !== signature) {
    const next = makeLabel(name, colorHex, 0.7)
    next.userData.t3dKind = OBJECT_LABEL_KIND
    next.userData.t3dLabelSig = signature
    next.position.copy(sprite.position)
    next.traverse((o) => {
      o.layers.set(EDITOR_LAYER)
      o.layers.enable(GRID_LAYER)
    })
    object.remove(sprite)
    const mat = sprite.material as THREE.SpriteMaterial
    mat.map?.dispose()
    mat.dispose()
    object.add(next)
    sprite = next
  }
  sprite.visible = visible
}

function tintObjectTree(root: THREE.Object3D, colorHex: string): void {
  const color = new THREE.Color(colorHex)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.userData.t3dTint) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const item of list) {
      const std = item as THREE.MeshStandardMaterial
      if (std.color) std.color.copy(color)
    }
  })
}

function applySkyColor(scene: THREE.Scene, doc: DirectorDocument): void {
  const emptyGenesis = isEmptyDirectorGenesis(doc.content.nodes)
  scene.background = new THREE.Color(
    resolveSkyColor(doc.content.environment.background?.skyColor, emptyGenesis),
  )
}

function ensureGround(scene: THREE.Scene, doc: DirectorDocument): void {
  const display = doc.content.environment.display
  const visible = display?.groundVisible !== false
  let ground = scene.getObjectByName(GROUND_NAME) as THREE.Mesh | undefined
  if (!ground) {
    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshBasicMaterial({
        color: GROUND_COLOR,
        toneMapped: false,
        // Let scene floors at groundHeight win depth testing without moving either surface.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        transparent: true,
        opacity: display?.groundOpacity ?? 1,
      }),
    )
    ground.name = GROUND_NAME
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
  }
  ground.visible = visible
  const grid = scene.getObjectByName(GRID_NAME)
  if (grid) grid.visible = visible
  ground.position.y = display?.groundHeight ?? 0
  const material = ground.material
  if (material && !Array.isArray(material)) {
    const std = material as THREE.MeshBasicMaterial
    std.color.setHex(GROUND_COLOR)
    std.toneMapped = false
    std.transparent = true
    std.opacity = display?.groundOpacity ?? 1
  }
}

export function disposeSceneChildren(scene: THREE.Scene): void {
  for (const child of [...scene.children]) {
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      const geometry = mesh.geometry
      if (geometry && !isTemplateShared(geometry)) geometry.dispose?.()
      const material = mesh.material
      if (!material) return
      const list = Array.isArray(material) ? material : [material]
      for (const item of list) {
        const std = item as THREE.MeshStandardMaterial
        // 模板自带的材质要留给模块级缓存复用；每实例新建/克隆的材质才由这里释放。
        if (isTemplateShared(std)) continue
        if (std.map && !isTemplateShared(std.map)) std.map.dispose?.()
        std.dispose?.()
      }
    })
    scene.remove(child)
  }
  scene.background = null
}

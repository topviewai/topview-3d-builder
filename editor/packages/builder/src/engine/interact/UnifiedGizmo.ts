import * as THREE from 'three'
import { EDITOR_LAYER } from '../core/Layers'
import {
  buildGumball,
  pickHandle,
  setGumballScaleVisible,
  setHandleHovered,
  GumballHandleType,
  type GumballBuildResult,
  type GumballHandleUserData,
} from './gumball/buildGumball'
import {
  createGhostClone,
  disposeGhostMesh,
  localTransformFromTRS,
  localTransformOf,
  type GizmoDuplicateItem,
} from './gumball/gumballGhost'
import {
  applyGumballMultiDelta,
  beginDrag,
  createRaycaster,
  updateDrag,
  type GumballDragSession,
  type GumballMultiStart,
} from './gumball/gumballInteraction'
import { resolveGizmoPivotWorld, resolveMultiSelectionPivotWorld } from './gumball/gizmoPivot'
import { trackStageAltModifier } from './stageAltModifier'

export type { GizmoDuplicateItem }

type Mode = 'translate' | 'rotate' | 'scale'
type GizmoListener = (event: { type: string; value?: boolean }) => void

const GIZMO_TARGET_PX = 120
const identitySnap = (value: number) => value

function handleHitName(handle: GumballHandleUserData): string {
  if (handle.handleType === GumballHandleType.SCALE && handle.axis === 'uniform') return 'UNIFORM'
  return handle.axis.toUpperCase()
}

function modeOf(handle: GumballHandleUserData): Mode {
  if (handle.handleType === GumballHandleType.ROTATE) return 'rotate'
  if (handle.handleType === GumballHandleType.SCALE) return 'scale'
  return 'translate'
}

/**
 * Rhino 风格世界 Gumball。拖拽数学与 canvas `gumballInteraction` / `useStageGizmo` 对齐，
 * 不再经 TransformControls。
 */
export class UnifiedGizmo {
  readonly visual: THREE.Group
  readonly pivot = new THREE.Group()
  dragging = false
  axis: string | null = null
  enabled = true

  private readonly targets = new Map<string, THREE.Object3D>()
  private readonly pickers: THREE.Mesh[]
  private readonly originRing: THREE.Object3D
  private readonly build: GumballBuildResult
  private readonly listeners = new Map<string, Set<GizmoListener>>()
  private readonly alt = trackStageAltModifier()
  private dragMode: Mode = 'translate'
  private session: GumballDragSession | null = null
  private rotateDrag = false
  private duplicating = false
  private duplicateConsumed = false
  private readonly multiStarts = new Map<string, GumballMultiStart>()
  private readonly ghosts = new Map<string, THREE.Object3D>()
  private ghostGroup: THREE.Object3D | null = null
  private ghostPivotOffset = new THREE.Vector3()
  private onDuplicate: ((items: GizmoDuplicateItem[]) => void) | null = null
  private readonly ndc = new THREE.Vector2()

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const build = buildGumball()
    this.build = build
    this.visual = build.group
    this.visual.name = 'StageGumball'
    this.pickers = build.interactiveMeshes
    this.originRing = build.originRing
    this.pivot.name = 'stage-gizmo-virtual-pivot'
    this.canvas.addEventListener('pointerdown', this.onPointerDown, true)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
  }

  addEventListener(type: string, fn: GizmoListener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn)
  }

  removeEventListener(type: string, fn: GizmoListener): void {
    this.listeners.get(type)?.delete(fn)
  }

  setDuplicateHandler(fn: ((items: GizmoDuplicateItem[]) => void) | null): void {
    this.onDuplicate = fn
  }

  isDuplicating(): boolean {
    return this.duplicating
  }

  consumeDuplicateDrag(): boolean {
    const value = this.duplicateConsumed
    this.duplicateConsumed = false
    return value
  }

  interactionProp(): 'position' | 'rotation' | 'scale' {
    if (this.dragMode === 'rotate') return 'rotation'
    if (this.dragMode === 'scale') return 'scale'
    return 'position'
  }

  ids(): string[] { return [...this.targets.keys()] }
  object(id: string): THREE.Object3D | undefined { return this.targets.get(id) }

  setScaleVisible(visible: boolean): void {
    setGumballScaleVisible(this.build, visible)
  }

  attach(scene: THREE.Scene, targets: Map<string, THREE.Object3D>): void {
    if (this.dragging) return
    if (this.pivot.parent !== scene) scene.add(this.pivot)
    if (this.visual.parent !== scene) scene.add(this.visual)
    const sameSelection = targets.size === this.targets.size
      && [...targets.keys()].every((id) => this.targets.get(id) === targets.get(id))
    this.targets.clear()
    for (const [id, target] of targets) this.targets.set(id, target)
    if (!targets.size) {
      this.visual.visible = false
      this.axis = null
      setHandleHovered(null, this.pickers)
      return
    }
    this.resetVirtualPivot()
    this.visual.visible = true
    if (!sameSelection) {
      this.axis = null
      setHandleHovered(null, this.pickers)
    }
    this.update()
  }

  update(): void {
    if (!this.targets.size) {
      this.visual.visible = false
      return
    }
    this.visual.visible = true
    this.visual.quaternion.identity()
    if (this.session && this.rotateDrag) {
      this.pivot.position.copy(this.session.origin)
    } else if (this.duplicating && !this.isMulti()) {
      const preview = this.ghosts.values().next().value
      if (preview) {
        this.pivot.position.set(
          preview.position.x + this.ghostPivotOffset.x,
          preview.position.y + this.ghostPivotOffset.y,
          preview.position.z + this.ghostPivotOffset.z,
        )
      }
    } else if (!this.dragging || this.targets.size === 1) {
      this.refreshPivotFromTargets()
    }
    this.visual.position.copy(this.pivot.position)
    const distance = this.camera.position.distanceTo(this.pivot.position)
    const worldPerViewport = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.visual.scale.setScalar(worldPerViewport * GIZMO_TARGET_PX / Math.max(1, this.canvas.clientHeight))
    this.originRing.quaternion.copy(this.camera.quaternion)
    this.visual.updateMatrixWorld(true)
  }

  hit(x: number, y: number): { name: string; dist: number } | null {
    const handle = this.pick(x, y)
    return handle ? { name: handleHitName(handle), dist: 0 } : null
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.clearGhosts()
    this.alt.dispose()
    this.listeners.clear()
    this.visual.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material && !Array.isArray(mesh.material)) mesh.material.dispose()
    })
    this.visual.removeFromParent()
    this.pivot.removeFromParent()
  }

  private emit(type: string, value?: boolean): void {
    const event = { type, value }
    this.listeners.get(type)?.forEach((fn) => fn(event))
  }

  private toNdc(event: PointerEvent): THREE.Vector2 | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    return this.ndc
  }

  private pick(ndcX: number, ndcY: number): GumballHandleUserData | null {
    if (!this.targets.size || !this.visual.visible) return null
    this.update()
    const ray = createRaycaster(new THREE.Vector2(ndcX, ndcY), this.camera)
    ray.layers.set(EDITOR_LAYER)
    return pickHandle(ray, this.pickers)
  }

  private refreshPivotFromTargets(): void {
    const meshes = [...this.targets.values()]
    const center = meshes.length > 1
      ? resolveMultiSelectionPivotWorld(meshes)
      : meshes[0] ? resolveGizmoPivotWorld(meshes[0]) : null
    if (!center) return
    this.pivot.position.set(center.x, center.y, center.z)
    this.pivot.quaternion.identity()
    this.pivot.scale.setScalar(1)
    this.pivot.updateMatrixWorld(true)
  }

  private resetVirtualPivot(): void {
    this.refreshPivotFromTargets()
    this.pivot.quaternion.identity()
    this.pivot.scale.setScalar(1)
  }

  private isMulti(): boolean {
    return this.targets.size > 1
  }

  private dragMesh(): THREE.Object3D | null {
    if (this.isMulti()) return this.pivot
    return this.targets.values().next().value ?? null
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) {
      if (!this.dragging) {
        this.axis = null
        this.canvas.style.cursor = ''
      }
      return
    }
    const ndc = this.toNdc(event)
    if (!ndc) return
    const session = this.session
    if (session) {
      const mesh = this.dragMesh()
      if (!mesh) return
      const ray = createRaycaster(ndc, this.camera)
      ray.layers.set(EDITOR_LAYER)
      if (this.duplicating && this.isMulti() && this.ghosts.size) {
        updateDrag(session, mesh, ray, identitySnap)
        applyGumballMultiDelta(session, this.pivot, this.multiStarts, (id) => this.targets.get(id))
        this.syncGhostsFromTargets()
        this.restoreTargetsFromStarts()
        if (
          session.handle.handleType === GumballHandleType.TRANSLATE
          || session.handle.handleType === GumballHandleType.PLANE
        ) {
          this.pivot.position.copy(mesh.position)
        }
      } else if (this.duplicating) {
        const ghost = this.ghosts.values().next().value
        if (!ghost) return
        updateDrag(session, mesh, ray, identitySnap)
        ghost.position.copy(mesh.position)
        ghost.quaternion.copy(mesh.quaternion)
        ghost.scale.copy(mesh.scale)
        mesh.position.copy(session.startPosition)
        mesh.quaternion.copy(session.startQuaternion)
        mesh.scale.copy(session.startScale)
      } else if (this.isMulti()) {
        updateDrag(session, mesh, ray, identitySnap)
        applyGumballMultiDelta(session, this.pivot, this.multiStarts, (id) => this.targets.get(id))
        if (
          session.handle.handleType === GumballHandleType.TRANSLATE
          || session.handle.handleType === GumballHandleType.PLANE
        ) {
          this.pivot.position.copy(mesh.position)
        }
        this.emit('objectChange')
      } else {
        updateDrag(session, mesh, ray, identitySnap)
        this.emit('objectChange')
      }
      this.emit('change')
      event.stopPropagation()
      return
    }

    if (!this.visual.visible || !this.targets.size) {
      this.axis = null
      this.canvas.style.cursor = ''
      return
    }
    const handle = this.pick(ndc.x, ndc.y)
    setHandleHovered(handle, this.pickers)
    this.axis = handle?.key ?? null
    if (handle) this.dragMode = modeOf(handle)
    this.canvas.style.cursor = handle ? 'pointer' : ''
    this.emit('change')
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return
    if (event.ctrlKey || event.metaKey) return
    if (!this.visual.visible || !this.targets.size) return
    const ndc = this.toNdc(event)
    if (!ndc) return
    this.update()
    const ray = createRaycaster(ndc, this.camera)
    ray.layers.set(EDITOR_LAYER)
    const handle = pickHandle(ray, this.pickers)
    if (!handle) return

    this.dragMode = modeOf(handle)
    this.rotateDrag = handle.handleType === GumballHandleType.ROTATE
    this.resetVirtualPivot()
    const pivot = this.pivot.position.clone()
    const mesh = this.dragMesh()
    if (!mesh) return

    this.duplicating = this.alt.isPressed(event) && Boolean(this.onDuplicate)
    this.multiStarts.clear()
    if (this.isMulti()) {
      for (const [id, target] of this.targets) {
        this.multiStarts.set(id, {
          position: target.position.clone(),
          quaternion: target.quaternion.clone(),
          scale: target.scale.clone(),
        })
      }
      this.pivot.position.copy(pivot)
      this.pivot.quaternion.identity()
      this.pivot.scale.setScalar(1)
    }

    if (this.duplicating) this.beginGhosts()

    const session = beginDrag(handle, mesh, ray, pivot)
    if (!session) {
      this.clearGhosts()
      this.duplicating = false
      return
    }
    this.session = session
    this.dragging = true
    this.axis = handle.key
    setHandleHovered(handle, this.pickers)
    this.emit('dragging-changed', true)
    this.emit('change')
    try {
      this.canvas.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.session) return
    const wasDuplicate = this.duplicating
    const dragSession = this.session
    this.rotateDrag = false
    this.session = null
    this.dragging = false
    this.emit('dragging-changed', false)

    if (this.isMulti() && this.multiStarts.size > 0) {
      if (wasDuplicate) {
        const items = this.collectDuplicateItems(dragSession)
        this.restoreTargetsFromStarts()
        if (items.length) this.onDuplicate?.(items)
      }
      this.multiStarts.clear()
    } else if (wasDuplicate) {
      const items = this.collectDuplicateItems(dragSession)
      if (items.length) this.onDuplicate?.(items)
    }

    this.refreshPivotFromTargets()
    this.clearGhosts()
    this.duplicating = false
    this.duplicateConsumed = wasDuplicate
    setHandleHovered(null, this.pickers)
    this.axis = null
    this.canvas.style.cursor = ''
    try {
      this.canvas.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    this.emit('change')
    event.stopPropagation()
  }

  private beginGhosts(): void {
    this.clearGhosts()
    if (this.isMulti()) {
      const group = new THREE.Group()
      for (const [id, target] of this.targets) {
        const ghost = createGhostClone(target)
        ghost.position.copy(target.position)
        ghost.quaternion.copy(target.quaternion)
        ghost.scale.copy(target.scale)
        group.add(ghost)
        this.ghosts.set(id, ghost)
      }
      if (this.ghosts.size === 0) {
        this.duplicating = false
        return
      }
      ;(this.visual.parent ?? this.pivot.parent)?.add(group)
      this.ghostGroup = group
      return
    }
    const target = this.targets.values().next().value
    if (!target) {
      this.duplicating = false
      return
    }
    const ghost = createGhostClone(target)
    ghost.position.copy(target.position)
    ghost.quaternion.copy(target.quaternion)
    ghost.scale.copy(target.scale)
    ;(target.parent ?? this.pivot.parent)?.add(ghost)
    this.ghosts.set(this.targets.keys().next().value ?? 'ghost', ghost)
    this.ghostPivotOffset.set(
      this.pivot.position.x - target.position.x,
      this.pivot.position.y - target.position.y,
      this.pivot.position.z - target.position.z,
    )
  }

  private syncGhostsFromTargets(): void {
    for (const [id, target] of this.targets) {
      const ghost = this.ghosts.get(id)
      if (!ghost) continue
      ghost.position.copy(target.position)
      ghost.quaternion.copy(target.quaternion)
      ghost.scale.copy(target.scale)
    }
  }

  private restoreTargetsFromStarts(): void {
    for (const [id, target] of this.targets) {
      const start = this.multiStarts.get(id)
      if (!start) continue
      target.position.copy(start.position)
      target.quaternion.copy(start.quaternion)
      target.scale.copy(start.scale)
      target.updateMatrixWorld(true)
    }
  }

  private collectDuplicateItems(session: GumballDragSession): GizmoDuplicateItem[] {
    const items: GizmoDuplicateItem[] = []
    if (this.isMulti()) {
      for (const [id, start] of this.multiStarts) {
        const preview = this.ghosts.get(id) ?? this.targets.get(id)
        if (!preview) continue
        items.push({
          id,
          ...localTransformOf(preview),
          from: localTransformFromTRS(start.position, start.quaternion, start.scale),
        })
      }
      return items
    }
    const from = localTransformFromTRS(
      session.startPosition,
      session.startQuaternion,
      session.startScale,
    )
    for (const [id, ghost] of this.ghosts) {
      items.push({ id, ...localTransformOf(ghost), from })
    }
    return items
  }

  private clearGhosts(): void {
    if (this.ghostGroup) {
      this.ghostGroup.removeFromParent()
      disposeGhostMesh(this.ghostGroup)
      this.ghostGroup = null
      this.ghosts.clear()
      return
    }
    for (const ghost of this.ghosts.values()) {
      ghost.removeFromParent()
      disposeGhostMesh(ghost)
    }
    this.ghosts.clear()
  }
}

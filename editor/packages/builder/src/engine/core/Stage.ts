import * as THREE from 'three'
import { resolveAspectRatio } from '../../contract/aspectRatio'
import type { DirectorDocument, DraftNode } from '../../contract/types'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import type { UserKeys } from '../../evaluate/curves/KeyframeTrack'
import {
  createFrameSnapshot,
  evaluateFrame,
  type FrameSnapshot,
} from '../../evaluate/evaluateFrame'
import {
  mergeStagedTransform,
  overlayStagedTransform,
  type StagedTransform,
} from '../../evaluate/stagedTransform'
import { ensureTransform } from '../../evaluate/FrameSnapshot'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import { pathControlCentroid } from '../../evaluate/path/samplePath'
import { PoseLibraryBank } from '../../data/poseLibraryBank'
import { sceneFromDocument } from '../../evaluate/sceneFromDocument'
import {
  EDITOR_EXPORT_CAMERA_ID,
  type CaptureFrameInput,
  type CaptureThumbnailsInput,
  type DirectorEngine,
  type EditorViewPose,
  type EvalContext,
  type NodeSnapshot,
  type RecordRangeInput,
  type RecordSequenceInput,
  type ViewportRole,
} from '../DirectorEngine'
import { EngineEvents, type EngineEventName, type EngineEventMap } from './EventBus'
import { exportFramePng, renderFramePngBlob } from '../io/Screenshot'
import { blitRenderTargetToCanvas, renderExportFrameToTarget } from '../io/exportGpu'
import type { ExportGpu } from '../io/exportShared'
import { disposeThumbnailRenderer, renderThumbnailBatch } from '../io/Thumbnails'
import { exportSequence, exportVideo } from '../io/VideoRecorder'
import { AssetLoader } from '../io/AssetLoader'
import type { ResolveMediaUrl } from '../io/mediaRefs'
import { Picker, ndcFromClient } from '../interact/Picker'
import {
  pickObjectIdsInContainerRect,
  projectObjectToContainerRect,
  projectObjectWireframe,
  projectWorldToContainer,
  type ContainerScreenRect,
} from '../interact/selectionBox'
import type { ViewportNavPickHandlers } from '../interact/ViewportNavigation'
import type { GizmoDuplicateItem } from '../interact/UnifiedGizmo'
import { unionWorldBounds } from '../interact/frameSelection'
import { beginJointDrag, updateJointDrag, type JointDrag } from '../interact/joints/jointDrag'
import { JointHandleLayer } from '../interact/joints/JointHandleLayer'
import {
  applyRelativeJoint,
  JOINT_HANDLE_SPECS,
  relativeToAbsoluteEuler,
} from '../interact/joints/jointPosing'
import { MIXAMORIG_TO_UAL1 } from '../../evaluate/retarget/RetargetMap'
import { findCanonicalBones } from '../rig/applyPose'
import { MotionPlayer } from '../objects/MotionPlayer'
import { applyFrameSnapshot, writeInspectorSnapshot } from '../objects/applySnapshot'
import {
  meshSupportHits as computeMeshSupportHits,
  worldAabb as computeWorldAabb,
  worldAimPoint as computeWorldAimPoint,
  worldContactPoint as computeWorldContactPoint,
  worldContactY as computeWorldContactY,
} from '../objects/groundContact'
import { applyNodeVisibility } from '../objects/visibility'
import { addRuntimeNode, hasNode, removeNode } from '../objects/ObjectFactory'
import { clearGraph, loadDocument } from '../objects/SceneLoader'
import { CHARACTER_LABEL_KIND, disposeSceneChildren } from '../objects/environment'
import { syncLabelTransforms } from '../objects/labels'
import type { CamInstance, CharInstance } from '../objects/types'
import { PlaybackClock } from './Clock'
import { EDITOR_LAYER } from './Layers'
import { RenderLoop } from './RenderLoop'
import { DEFAULT_EDITOR_CAMERA, DualViewport, type GizmoMode } from './Viewport'
import {
  applyLivePathStroke,
  applyLivePathTransform,
  buildDrawPreview,
  buildPathInstance,
  disposeDrawPreview,
  isDrawPointOnGround,
  pathPointObject,
  pickPathPointIndicesInScreenRect,
  pickPathHit,
  pickPathPointHit,
  removePathNode,
  setPathEditAppearance,
  syncPathNodes,
  syncPathSelection,
  type PathViewHost,
} from '../objects/PathObject'
import { clearCameraMotionGuide, syncCameraMotionGuide as applyCameraMotionGuide } from '../objects/CameraMotionGuide'

export const FRAME_THROTTLE_MS = 100
export type { EvalContext, NodeSnapshot } from '../DirectorEngine'
export type { ResolveMediaUrl } from '../io/mediaRefs'
export { EDITOR_LAYER, GRID_LAYER } from './Layers'
export type { GizmoMode }

function ual1PoseName(mixamorigRaw: string): string | undefined {
  return MIXAMORIG_TO_UAL1[THREE.PropertyBinding.sanitizeNodeName(mixamorigRaw)]
}

export class Stage implements DirectorEngine, PathViewHost {
  readonly scene = new THREE.Scene()
  readonly editorCamera: THREE.PerspectiveCamera
  readonly motionPlayer = new MotionPlayer()
  readonly poseBank = new PoseLibraryBank()
  readonly resolveMediaUrl: ResolveMediaUrl
  readonly nodeById = new Map<string, DraftNode>()
  readonly characters = new Map<string, CharInstance>()
  readonly cameras = new Map<string, CamInstance>()
  readonly props = new Map<string, THREE.Object3D>()
  readonly groups = new Map<string, THREE.Group>()
  readonly primitives = new Map<string, THREE.Mesh>()
  readonly pathNodes = new Map<string, DraftNode>()
  readonly pathViews = new Map<string, THREE.Group>()
  readonly pathPickTargets = new Map<string, THREE.Object3D>()
  readonly pathMaterials = new Map<string, import('../objects/PathObject').PathMaterials>()
  selectedPathId: string | null = null
  pathEditingId: string | null = null
  pathEditPointIndex: number | null = null
  readonly visiblePathIds = new Set<string>()
  readonly snapshot = new Map<string, NodeSnapshot>()

  ready = false
  currentFrame = 0
  playing = false
  activeCameraId: string | null = null
  readonly stats = { renderFrames: 0, clockFrames: 0, throttled: 0 }
  fcurves: FCurveSet | null = null
  doc: DirectorDocument | null = null

  private evalUserKeys: UserKeys = {}
  private evalUserKeysEnabled = true
  private stagedTransforms = new Map<string, StagedTransform>()
  private evalChainCameraMotion = false
  private readonly events = new EngineEvents()
  private readonly clock = new PlaybackClock()
  private readonly renderLoop = new RenderLoop(() => this.forceRender())
  private readonly loader: AssetLoader
  private readonly viewport: DualViewport
  private readonly picker: Picker
  private lastThrottleAt = 0
  private readonly frameOut = createFrameSnapshot()
  private drawPreview: THREE.Group | null = null
  /** 整条路径的 gizmo 附着体：无几何，位姿映射 node.transform（原点挪到控制点质心）。 */
  private readonly pathGizmoProxy = new THREE.Object3D()
  private gizmoNodeId: string | null = null
  private gizmoNodeIds: string[] | undefined
  private gizmoMode: GizmoMode = 'translate'
  private gizmoSuspended = false
  private highlightPathId: string | null = null
  private loadToken = 0
  private readonly joints = new JointHandleLayer()
  private jointDrag: JointDrag | null = null
  private jointDragNodeId: string | null = null
  private poseEditingId: string | null = null
  private programCameraId: string | null = null
  private programSourceFrame: number | null = null
  programPreviewActive = false
  private exportTarget: THREE.WebGLRenderTarget | null = null

  constructor(resolveMediaUrl: ResolveMediaUrl, options?: { dracoDecoderPath?: string }) {
    this.resolveMediaUrl = resolveMediaUrl
    this.loader = new AssetLoader(resolveMediaUrl, options)
    this.editorCamera = new THREE.PerspectiveCamera(DEFAULT_EDITOR_CAMERA.fov, 16 / 9, 0.1, 2000)
    this.editorCamera.rotation.order = 'YXZ'
    this.editorCamera.position.set(...DEFAULT_EDITOR_CAMERA.position)
    this.editorCamera.lookAt(...DEFAULT_EDITOR_CAMERA.target)
    this.editorCamera.layers.enable(EDITOR_LAYER)
    this.picker = new Picker(this.editorCamera)
    this.joints.attach(this.scene)
    this.viewport = new DualViewport(this.editorCamera, {
      onInvalidate: () => this.invalidate(),
      onEditorCameraChange: () => {
        this.events.emit('camera:change', this.readEditorCameraRotation())
      },
      onContextLostChange: (lost) => {
        this.renderLoop.webGLContextLost = lost
        if (lost) this.clock.stop()
      },
      onContextRestored: () => {
        if (this.renderLoop.webGLContextLost) return
        if (this.playing) this.clock.start(this.onClockTick)
        this.invalidate()
      },
      getSceneMeshes: () => this.collectSceneMeshes(),
      getOrbitPivot: () => this.orbitPivot(),
    })
  }

  attachViewport(role: ViewportRole, canvas: HTMLCanvasElement): void {
    if (role === 'main') {
      this.viewport.attachMain(canvas)
      this.viewport.attachTcHelper(this.scene)
    } else this.viewport.attachPreview(canvas)
  }

  detachViewport(role: ViewportRole): void {
    if (role === 'main') this.viewport.detachMain()
    else this.viewport.detachPreview()
  }

  async load(doc: DirectorDocument, onProgress?: (msg: string) => void): Promise<void> {
    const token = ++this.loadToken
    await loadDocument(this, this.loader, doc, onProgress, () => this.loadToken !== token)
    if (this.loadToken !== token) return
    this.ready = true
    onProgress?.('就绪')
    this.invalidate()
  }

  on<E extends EngineEventName>(event: E, fn: (payload: EngineEventMap[E]) => void): () => void {
    return this.events.on(event, fn)
  }

  invalidate(): void {
    this.renderLoop.invalidate()
  }

  mainCanvas(): HTMLCanvasElement | null {
    return this.viewport.mainCanvas()
  }

  viewportAspect(): number {
    return this.viewport.mainAspect()
  }

  resolvedAspect(): number {
    return resolveAspectRatio(this.doc?.content.aspectRatio, this.viewport.mainAspect())
  }

  setFcurves(fcurves: FCurveSet | null): void {
    if (fcurves === this.fcurves) return
    this.fcurves = fcurves
    // fcurves 整体换引用（undo/redo 恢复、加载官方曲线）后必须重算，
    // 否则运行时对象停留在旧曲线求值结果上（undo 看起来"没反应"）。
    if (!this.ready) return
    this.evaluateCurrent()
    this.invalidate()
  }

  applyNodeVisibility(): void {
    applyNodeVisibility(this)
    this.invalidate()
  }

  resetEditorView(): void {
    this.viewport.resetEditorView()
  }

  focusNode(nodeId: string): void {
    this.focusNodes([nodeId])
  }

  focusNodes(nodeIds: string[]): void {
    const objects: THREE.Object3D[] = []
    for (const id of nodeIds) {
      const object = this.objectForFocus(id)
      if (object) objects.push(object)
    }
    const box = unionWorldBounds(objects)
    if (box) this.viewport.focusBounds(box)
  }

  poseJointHit(nodeId: string, ndcX: number, ndcY: number): { specId: string } | null {
    if (this.jointDrag || !this.characters.has(nodeId)) return null
    const spec = this.joints.pick(this.editorCamera, ndcX, ndcY)
    return spec ? { specId: spec.id } : null
  }

  poseJointBegin(nodeId: string, specId: string, ndcX: number, ndcY: number): boolean {
    const ch = this.characters.get(nodeId)
    const spec = JOINT_HANDLE_SPECS.find((item) => item.id === specId)
    if (!ch || !spec) return false
    const canonical = findCanonicalBones(ch.root, ch.rig === 'ual1' ? ual1PoseName : undefined)
    const forward = new THREE.Vector3(0, 0, spec.id.startsWith('wrist') ? -1 : 1)
      .applyQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()))
    const drag = beginJointDrag(
      nodeId,
      spec,
      canonical,
      ch.restPose,
      this.editorCamera,
      new THREE.Vector2(ndcX, ndcY),
      forward,
    )
    if (!drag) return false
    this.jointDrag = drag
    this.jointDragNodeId = nodeId
    this.viewport.jointBusy = true
    this.joints.hover(spec.id)
    return true
  }

  poseJointDrag(ndcX: number, ndcY: number): Record<string, { x: number; y: number; z: number }> | null {
    const drag = this.jointDrag
    const ch = drag ? this.characters.get(drag.objectId) : undefined
    if (!drag || !ch) return null
    const canonical = findCanonicalBones(ch.root, ch.rig === 'ual1' ? ual1PoseName : undefined)
    const pose = updateJointDrag(drag, canonical, ch.restPose, this.editorCamera, new THREE.Vector2(ndcX, ndcY))
    if (!pose) return null
    drag.latestPose = pose
    const written: Record<string, { x: number; y: number; z: number }> = {}
    for (const [name, rot] of Object.entries(pose)) {
      const rest = ch.restPose.get(name)
      const bone = ch.root.getObjectByName(name)
      if (!rest || !bone) continue
      applyRelativeJoint(bone as THREE.Bone, rest, rot)
      written[name] = relativeToAbsoluteEuler(rest, rot)
    }
    ch.root.updateMatrixWorld(true)
    this.invalidate()
    return written
  }

  poseJointHover(ndcX: number, ndcY: number): void {
    if (this.jointDrag) return
    const spec = this.joints.pick(this.editorCamera, ndcX, ndcY)
    this.joints.hover(spec?.id ?? null)
  }

  poseJointEnd(): void {
    this.clearJointDrag()
  }

  poseJointCancel(): void {
    this.clearJointDrag()
  }

  poseJointBusy(): boolean {
    return !!this.jointDrag
  }

  setPoseEditingId(id: string | null): void {
    if (this.poseEditingId === id) return
    this.poseEditingId = id
    this.invalidate()
  }

  projectNodeScreenRect(container: HTMLElement, nodeId: string): ContainerScreenRect | null {
    const object = this.objectForFocus(nodeId)
    if (!object) return null
    return projectObjectToContainerRect(object, this.editorCamera, container)
  }

  /** 角色名标签的屏幕矩形。标签未显示时返回 null，调用方再退回节点包围盒。 */
  projectCharacterLabelScreenRect(container: HTMLElement, nodeId: string): ContainerScreenRect | null {
    const root = this.characters.get(nodeId)?.root
    if (!root) return null
    const sprite = root.children.find((child) => child.userData.t3dKind === CHARACTER_LABEL_KIND)
    if (!sprite?.visible) return null
    return projectObjectToContainerRect(sprite, this.editorCamera, container)
  }

  projectNodeWireframe(container: HTMLElement, nodeId: string) {
    const object = this.objectForFocus(nodeId)
    return object ? projectObjectWireframe(object, this.editorCamera, container) : []
  }

  projectWorldToContainer(
    container: HTMLElement,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; visible: boolean } | null {
    return projectWorldToContainer(this.editorCamera, container, new THREE.Vector3(x, y, z))
  }

  poseJointNodeId(): string | null {
    return this.jointDragNodeId
  }

  setNavPickHandlers(handlers: ViewportNavPickHandlers | null): void {
    this.viewport.setNavPickHandlers(handlers)
  }

  setGizmoDuplicateHandler(fn: ((items: GizmoDuplicateItem[]) => void) | null): void {
    this.viewport.setGizmoDuplicateHandler(fn)
  }

  gizmoIsDuplicating(): boolean {
    return this.viewport.gizmoIsDuplicating()
  }

  consumeGizmoDuplicateDrag(): boolean {
    return this.viewport.consumeGizmoDuplicateDrag()
  }

  pickIdsInScreenRect(container: HTMLElement, rect: ContainerScreenRect): string[] {
    return pickObjectIdsInContainerRect(this.editorCamera, container, this.collectPickableMap(), rect)
  }

  pickPathPointIndicesInScreenRect(
    container: HTMLElement,
    rect: ContainerScreenRect,
    pathId: string,
  ): number[] {
    return pickPathPointIndicesInScreenRect(this, container, rect, pathId)
  }

  private collectSceneMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = []
    for (const ch of this.characters.values()) if (ch.root.visible) meshes.push(ch.root)
    for (const prop of this.props.values()) if (prop.visible) meshes.push(prop)
    for (const prim of this.primitives.values()) if (prim.visible) meshes.push(prim)
    return meshes
  }

  private collectPickableMap(): Map<string, THREE.Object3D> {
    const map = new Map<string, THREE.Object3D>()
    for (const [id, ch] of this.characters) if (ch.root.visible) map.set(id, ch.root)
    for (const [id, prop] of this.props) if (prop.visible) map.set(id, prop)
    for (const [id, prim] of this.primitives) {
      if (prim.visible && !this.nodeById.get(id)?.parentId) map.set(id, prim)
    }
    for (const [id, cam] of this.cameras) {
      if (cam.gizmo.group.visible) map.set(id, cam.gizmo.group)
    }
    for (const [id, path] of this.pathPickTargets) {
      if (isDerivedTransformPath(this.nodeById.get(id))) continue
      map.set(id, path)
    }
    return map
  }

  private orbitPivot(): { x: number; y: number; z: number } {
    return this.viewport.viewCenterPivot()
  }

  private objectForFocus(nodeId: string): THREE.Object3D | null {
    return this.characters.get(nodeId)?.root
      ?? this.props.get(nodeId)
      ?? this.primitives.get(nodeId)
      ?? this.groups.get(nodeId)
      ?? this.cameras.get(nodeId)?.gizmo.group
      ?? null
  }

  private clearJointDrag(): void {
    this.jointDrag = null
    this.jointDragNodeId = null
    this.viewport.jointBusy = false
    this.joints.hover(null)
  }

  private syncJointHandles(): void {
    this.joints.attach(this.scene)
    const ch = this.poseEditingId ? this.characters.get(this.poseEditingId) : undefined
    this.joints.sync(
      this.editorCamera,
      this.viewport.mainCanvas()?.clientHeight ?? 600,
      ch ? findCanonicalBones(ch.root, ch.rig === 'ual1' ? ual1PoseName : undefined) : null,
      ch?.restPose ?? null,
      ch?.root ?? null,
    )
  }

  readEditorCameraRotation(): { x: number; y: number; z: number } {
    const euler = new THREE.Euler().setFromQuaternion(this.editorCamera.quaternion, 'YXZ')
    return {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    }
  }

  captureEditorView(): EditorViewPose | null {
    const lookAt = this.viewport.orbitLookAt()
    if (!lookAt) return null
    const cam = this.editorCamera
    return {
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      rotation: this.readEditorCameraRotation(),
      lookAt: { x: lookAt.x, y: lookAt.y, z: lookAt.z },
      fov: cam.fov,
    }
  }

  getNodeSnapshot(nodeId: string): NodeSnapshot | null {
    return this.snapshot.get(nodeId) ?? null
  }

  worldContactY(nodeId: string): number | null {
    return computeWorldContactY(this, nodeId)
  }

  worldContactPoint(nodeId: string): { x: number; y: number; z: number } | null {
    return computeWorldContactPoint(this, nodeId)
  }

  worldAabb(nodeId: string) {
    return computeWorldAabb(this, nodeId)
  }

  meshSupportHits(nodeId: string): { x: number; y: number; z: number }[] | null {
    return computeMeshSupportHits(this, nodeId)
  }

  worldAimPoint(nodeId: string): { x: number; y: number; z: number } | null {
    return computeWorldAimPoint(this, nodeId)
  }

  pickAt(x: number, y: number): string | null {
    return this.picker.pickNodeHit(this, x, y)?.id ?? null
  }

  pickNodeHit(x: number, y: number): { id: string; dist: number } | null {
    return this.picker.pickNodeHit(this, x, y)
  }

  pickCameraHit(x: number, y: number): { id: string; dist: number } | null {
    return this.picker.pickCameraHit(this, x, y)
  }

  pickPathHit(x: number, y: number): { id: string; dist: number } | null {
    return pickPathHit(this, this.picker.raycaster, x, y, this.editorCamera)
  }

  pickPathPointHit(
    x: number,
    y: number,
    pathId?: string | null,
  ): { id: string; index: number; dist: number } | null {
    return pickPathPointHit(this, this.picker.raycaster, x, y, this.editorCamera, pathId)
  }

  setPathEditing(pathId: string | null, pointIndex: number | null): void {
    if (this.pathEditingId === pathId && this.pathEditPointIndex === pointIndex) return
    const previousId = this.pathEditingId
    setPathEditAppearance(this, pathId, pointIndex)
    if (previousId && previousId !== pathId) {
      // Drop the point-edit preview and detach its mesh before the next gesture.
      this.refreshPathNode(previousId)
      this.syncPathSelection(this.highlightPathId)
    }
    this.syncGizmo(this.gizmoNodeId, this.gizmoMode, this.gizmoSuspended, this.gizmoNodeIds)
    this.invalidate()
  }

  applyLivePathStroke(pathId: string): void {
    applyLivePathStroke(this, pathId)
    this.invalidate()
  }

  applyLivePathTransform(pathId: string): void {
    const transform = this.readPathGizmoTransform(pathId)
    if (!transform) return
    applyLivePathTransform(this, pathId, transform)
    this.invalidate()
  }

  /** gizmo 代理位姿 → node.transform（代理原点带着质心偏移，写回时要减掉）。 */
  readPathGizmoTransform(pathId: string): DraftNode['transform'] | null {
    const node = this.pathNodes.get(pathId)
    if (!node?.path) return null
    const center = pathControlCentroid(node)
    const proxy = this.pathGizmoProxy
    const R2D = 180 / Math.PI
    return {
      position: {
        x: proxy.position.x - center.x,
        y: proxy.position.y - center.y,
        z: proxy.position.z - center.z,
      },
      rotation: {
        x: proxy.rotation.x * R2D,
        y: proxy.rotation.y * R2D,
        z: proxy.rotation.z * R2D,
      },
      scale: { x: proxy.scale.x, y: proxy.scale.y, z: proxy.scale.z },
    }
  }

  private syncPathGizmoProxy(node: DraftNode): THREE.Object3D {
    const center = pathControlCentroid(node)
    const { position, rotation, scale } = node.transform
    const D2R = Math.PI / 180
    const proxy = this.pathGizmoProxy
    proxy.position.set(center.x + position.x, center.y + position.y, center.z + position.z)
    proxy.rotation.set(rotation.x * D2R, rotation.y * D2R, rotation.z * D2R, 'ZYX')
    proxy.scale.set(scale.x, scale.y, scale.z)
    proxy.updateMatrixWorld(true)
    return proxy
  }

  ndcFromClient(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    return ndcFromClient(canvas, clientX, clientY)
  }

  captureFrame(opts: CaptureFrameInput): Promise<void> {
    return exportFramePng({ ...opts, stage: this })
  }

  previewFrame(opts: CaptureFrameInput): Promise<Blob> {
    return renderFramePngBlob({ ...opts, stage: this })
  }

  previewFrameToCanvas(opts: CaptureFrameInput & { canvas: HTMLCanvasElement }): void {
    const cam = this.getCameraForExport(opts.cameraId)
    const ctx = opts.canvas.getContext('2d')
    const gpu = this.acquireExportGpu(opts.width, opts.height)
    if (!this.ready || !cam || !ctx || !gpu) return
    opts.canvas.width = opts.width
    opts.canvas.height = opts.height
    renderExportFrameToTarget({ ...opts, stage: this }, opts.frame, cam, gpu.renderer, gpu.target)
    blitRenderTargetToCanvas(gpu.renderer, gpu.target, ctx, opts.width, opts.height)
    this.restoreAfterExport()
  }

  releaseExportPreview(): void {
    this.restoreAfterExport()
  }

  acquireExportGpu(width: number, height: number): ExportGpu | null {
    const renderer = this.viewport.rendererMain
    if (!renderer) return null
    if (renderer.getContext().isContextLost()) return null
    if (!this.exportTarget || this.exportTarget.width !== width || this.exportTarget.height !== height) {
      this.exportTarget?.dispose()
      this.exportTarget = new THREE.WebGLRenderTarget(width, height, {
        colorSpace: THREE.SRGBColorSpace,
      })
    }
    return { renderer, target: this.exportTarget }
  }

  restoreAfterExport(): void {
    if (!this.ready) {
      this.invalidate()
      return
    }
    if (this.programPreviewActive && this.programSourceFrame != null) {
      this.evaluate(
        this.programSourceFrame,
        this.evalUserKeys,
        this.evalUserKeysEnabled,
        this.evalChainCameraMotion,
      )
    } else {
      this.evaluateCurrent()
    }
    this.invalidate()
  }

  captureThumbnails(opts: CaptureThumbnailsInput): (string | null)[] {
    if (!this.ready || opts.requests.length === 0) return opts.requests.map(() => null)
    return renderThumbnailBatch({
      ...opts,
      stage: this,
      restore: () => {
        // 缩略图批次改过共享场景图，必须回到调用前那一帧，否则主视口会跳帧。
        if (this.programPreviewActive && this.programSourceFrame != null) {
          this.evaluate(
            this.programSourceFrame,
            this.evalUserKeys,
            this.evalUserKeysEnabled,
            this.evalChainCameraMotion,
          )
        } else {
          this.evaluateCurrent()
        }
        this.invalidate()
      },
    })
  }

  recordRange(opts: RecordRangeInput): Promise<{ cancelled: boolean; frames: number }> {
    return exportVideo({ ...opts, stage: this })
  }

  recordSequence(opts: RecordSequenceInput): Promise<{ cancelled: boolean; frames: number }> {
    const doc = this.doc
    if (!doc) return Promise.reject(new Error('no-document'))
    return exportSequence({ ...opts, stage: this, document: doc })
  }

  beginProgramPreview(): void {
    this.programPreviewActive = true
    if (!this.viewport.followMode) this.viewport.beginFollow()
    this.invalidate()
  }

  previewProgramFrame(sourceFrame: number, cameraId: string): void {
    if (!this.ready) return
    this.programCameraId = cameraId
    this.programSourceFrame = sourceFrame
    this.evaluate(sourceFrame, this.evalUserKeys, this.evalUserKeysEnabled, this.evalChainCameraMotion)
    this.invalidate()
  }

  endProgramPreview(): void {
    this.programCameraId = null
    this.programSourceFrame = null
    this.programPreviewActive = false
    if (this.ready) this.evaluateCurrent()
    this.viewport.endFollow()
    this.invalidate()
  }

  setEvalContext(ctx: EvalContext): void {
    this.evalUserKeys = ctx.userKeys
    this.evalUserKeysEnabled = ctx.userKeysEnabled
    this.evalChainCameraMotion = ctx.chainCameraMotion
    if (ctx.activeCameraId !== undefined) this.activeCameraId = ctx.activeCameraId
    if (!this.ready) return
    this.evaluateCurrent()
    this.invalidate()
  }

  seek(frame: number): void {
    const tl = this.doc?.content.timeline
    const next = Math.min(Math.max(frame, tl?.frameStart ?? 0), tl?.frameEnd ?? 0)
    if (Math.round(next) !== Math.round(this.currentFrame)) this.clearStagedTransforms()
    this.currentFrame = next
    if (this.ready) this.evaluateCurrent()
    this.emitFrame(performance.now(), true)
    this.invalidate()
  }

  play(_direction: 'forward' | 'reverse' = 'forward'): void {
    if (this.playing) return
    this.clearStagedTransforms()
    this.playing = true
    this.clock.start(this.onClockTick)
  }

  pause(): void {
    this.playing = false
    this.clock.stop()
    this.emitFrame(performance.now(), true)
  }

  reset(): void {
    this.loadToken += 1
    this.pause()
    this.stagedTransforms.clear()
    this.ready = false
    this.fcurves = null
    this.disposeExportGpu()
    this.poseEditingId = null
    this.pathEditingId = null
    this.pathEditPointIndex = null
    this.selectedPathId = null
    this.visiblePathIds.clear()
    this.highlightPathId = null
    clearCameraMotionGuide(this)
    disposeSceneChildren(this.scene)
    clearGraph(this)
    this.joints.attach(this.scene)
  }

  hasNode(nodeId: string): boolean {
    return hasNode(this, nodeId)
  }

  removeNode(nodeId: string): void {
    removeNode(this, nodeId)
  }

  async addRuntimeNode(node: DraftNode): Promise<boolean> {
    const added = await addRuntimeNode(this, this.loader, node)
    // 不变量「建完必跟一次求值」：undo 恢复被删节点时，content 恢复触发的求值发生在
    // 异步重建之前、结果被丢弃；不在这里补求值，角色会停在模板克隆的默认姿势上。
    if (added && this.ready) {
      this.evaluateCurrent()
      this.invalidate()
    }
    return added
  }

  async loadMotion(assetId: string, url: string): Promise<number> {
    const raw = await this.motionPlayer.load(assetId, url)
    return raw.clip.duration
  }

  evaluate(frame: number, userKeys: UserKeys, userKeysEnabled: boolean, chainCameraMotion = false): void {
    const doc = this.doc
    if (!doc || !this.ready) return
    this.refreshNodeRefs(doc)
    for (const node of doc.content.nodes) ensureTransform(this.frameOut, node.id)
    evaluateFrame(
      sceneFromDocument(doc, {
        fcurves: this.fcurves,
        userKeys,
        userKeysEnabled,
        chainCameraMotion,
      }),
      frame,
      this.frameOut,
    )
    if (!this.playing && this.stagedTransforms.size > 0) {
      for (const [id, staged] of this.stagedTransforms) {
        const xf = this.frameOut.transforms.get(id)
        if (xf) overlayStagedTransform(xf, staged)
      }
    }
    this.applySnapshot(this.frameOut)
    writeInspectorSnapshot(this)
    if (!this.playing) this.events.emit('node:snapshot', null)
  }

  // undo/redo 用 cloneJson 整体替换 content，节点对象全部换新；characters/cameras
  // 在建实例时捕获的旧 node 引用随之过期（applyPose 的姿势、相机 visible 都读它）。
  // 求值前把引用对齐到当前 content，保证读到的是最新数据。
  // 注意只能更新「已存在」的键：nodeById 的键集合代表引擎已建实例的节点
  // （hasNode 靠它判断），把未建实例的 id 塞进去会让 addRuntimeNode 跳过重建。
  // pathNodes 同理不能动：syncPathNodes 靠引用相等检测内容替换并重建路径视图。
  private refreshNodeRefs(doc: DirectorDocument): void {
    for (const node of doc.content.nodes) {
      if (this.nodeById.has(node.id)) this.nodeById.set(node.id, node)
      const ch = this.characters.get(node.id)
      if (ch && ch.node !== node) ch.node = node
      const cam = this.cameras.get(node.id)
      if (cam && cam.node !== node) cam.node = node
    }
  }

  applySnapshot(snapshot: FrameSnapshot): void {
    applyFrameSnapshot(this, snapshot)
  }

  getCameraForExport(id: string): THREE.PerspectiveCamera | undefined {
    if (id === EDITOR_EXPORT_CAMERA_ID) return this.editorCamera
    return this.cameras.get(id)?.camera
  }

  groundPoint(ndcX: number, ndcY: number, y: number): [number, number, number] | null {
    return this.picker.groundPoint(ndcX, ndcY, y)
  }

  groundDrawPoint(ndcX: number, ndcY: number): [number, number, number] | null {
    const y = this.doc?.content.environment.display?.groundHeight ?? 0
    const p = this.picker.groundPoint(ndcX, ndcY, y)
    return p && isDrawPointOnGround(p) ? p : null
  }

  applyLiveCameraPose(
    nodeId: string,
    position: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number } | null,
    rotation?: { x: number; y: number; z: number } | null,
  ): void {
    const inst = this.cameras.get(nodeId)
    if (!inst) return
    inst.camera.position.set(position.x, position.y, position.z)
    if (rotation) {
      const D2R = Math.PI / 180
      inst.camera.rotation.set(rotation.x * D2R, rotation.y * D2R, rotation.z * D2R)
      if (lookAt) inst.lookAt.set(lookAt.x, lookAt.y, lookAt.z)
    } else if (lookAt) {
      inst.lookAt.set(lookAt.x, lookAt.y, lookAt.z)
      inst.camera.lookAt(inst.lookAt)
    }
    inst.camera.updateMatrixWorld()
    if (!this.gizmoBusy() || !this.gizmoAttachedNodeIds().includes(nodeId)) {
      inst.gizmo.sync(inst.camera)
    }
    const R2D = 180 / Math.PI
    this.snapshot.set(nodeId, {
      position: [inst.camera.position.x, inst.camera.position.y, inst.camera.position.z],
      rotation: [inst.camera.rotation.x * R2D, inst.camera.rotation.y * R2D, inst.camera.rotation.z * R2D],
      scale: [1, 1, 1],
      lookAt: [inst.lookAt.x, inst.lookAt.y, inst.lookAt.z],
      fov: inst.camera.fov,
    })
    this.events.emit('node:snapshot', nodeId)
    this.invalidate()
  }

  applyLiveCameraFov(nodeId: string, fov: number): void {
    const inst = this.cameras.get(nodeId)
    if (!inst) return
    if (Math.abs(inst.camera.fov - fov) > 1e-4) {
      inst.camera.fov = fov
      inst.camera.updateProjectionMatrix()
    }
    const snap = this.snapshot.get(nodeId)
    if (snap) this.snapshot.set(nodeId, { ...snap, fov })
    this.events.emit('node:snapshot', nodeId)
    inst.gizmo.setFov(fov)
    this.invalidate()
  }

  applyLiveNodeTransform(
    nodeId: string,
    t: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ): void {
    const obj =
      this.characters.get(nodeId)?.root ??
      this.props.get(nodeId) ??
      this.groups.get(nodeId) ??
      this.primitives.get(nodeId) ??
      null
    if (!obj) return
    if (t.position) obj.position.set(t.position.x, t.position.y, t.position.z)
    if (t.rotation) {
      const D2R = Math.PI / 180
      obj.rotation.set(t.rotation.x * D2R, t.rotation.y * D2R, t.rotation.z * D2R)
    }
    if (t.scale) obj.scale.set(t.scale.x, t.scale.y, t.scale.z)
    obj.updateMatrixWorld()
    const snap = this.snapshot.get(nodeId)
    this.snapshot.set(nodeId, {
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [
        (obj.rotation.x * 180) / Math.PI,
        (obj.rotation.y * 180) / Math.PI,
        (obj.rotation.z * 180) / Math.PI,
      ],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      lookAt: snap?.lookAt,
      fov: snap?.fov,
    })
    this.invalidate()
  }

  setStagedTransform(
    nodeId: string,
    patch: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
      lookAt?: { x: number; y: number; z: number }
      fov?: number
    },
  ): void {
    this.stagedTransforms.set(nodeId, mergeStagedTransform(this.stagedTransforms.get(nodeId), patch))
  }

  clearStagedTransforms(nodeId?: string): void {
    if (nodeId) this.stagedTransforms.delete(nodeId)
    else this.stagedTransforms.clear()
  }

  hasStagedTransform(nodeId: string): boolean {
    return this.stagedTransforms.has(nodeId)
  }

  readAttachedCameraAim(lookDistance: number): { x: number; y: number; z: number } | null {
    return this.viewport.readAttachedCameraAim(lookDistance)
  }

  beginFollow(): void {
    this.viewport.beginFollow()
    this.invalidate()
  }

  endFollow(): void {
    this.viewport.endFollow()
    this.invalidate()
  }

  beginCameraPilot(nodeId: string): boolean {
    const cam = this.cameras.get(nodeId)
    if (!cam) return false
    const ok = this.viewport.beginCameraPilot(cam)
    this.invalidate()
    return ok
  }

  endCameraPilot(): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } | null {
    const pose = this.viewport.endCameraPilot()
    this.invalidate()
    return pose
  }

  syncGizmo(nodeId: string | null, mode: GizmoMode, suspended: boolean, nodeIds?: string[]): void {
    this.gizmoNodeId = nodeId
    this.gizmoNodeIds = nodeIds
    this.gizmoMode = mode
    this.gizmoSuspended = suspended
    if (
      this.pathEditingId
      && this.pathEditPointIndex != null
      && !this.gizmoBlocked(this.pathEditingId)
    ) {
      const mesh = pathPointObject(this, this.pathEditingId, this.pathEditPointIndex)
      if (mesh) {
        const targets = new Map<string, THREE.Object3D>([[this.pathEditingId, mesh]])
        this.viewport.unified?.setScaleVisible(false)
        this.viewport.syncTargets(this.scene, targets)
        return
      }
    }
    const wholePath = nodeId && (nodeIds?.length ?? 1) <= 1 ? this.pathNodes.get(nodeId) : undefined
    if (
      wholePath
      && !this.pathEditingId
      && !isDerivedTransformPath(wholePath)
      && !suspended
      && !this.gizmoBlocked(nodeId)
    ) {
      // 拖拽途中重挂会把代理拉回提交前的位姿，交由本次交互自己维护。
      const proxy = this.viewport.gizmoBusy()
        ? this.pathGizmoProxy
        : this.syncPathGizmoProxy(wholePath)
      this.viewport.unified?.setScaleVisible(true)
      this.viewport.syncTargets(this.scene, new Map<string, THREE.Object3D>([[wholePath.id, proxy]]))
      return
    }
    this.viewport.syncGizmo(
      this.scene,
      this.cameras,
      this.characters,
      this.props,
      nodeId,
      mode,
      suspended || this.gizmoBlocked(nodeId),
      nodeIds,
      this.primitives,
      this.groups,
    )
  }

  private gizmoBlocked(nodeId: string | null): boolean {
    if (!nodeId) return false
    const node = this.nodeById.get(nodeId) ?? this.doc?.content.nodes.find((n) => n.id === nodeId)
    return Boolean(node?.locked) || node?.visible === false
  }

  gizmoBusy(): boolean {
    return this.viewport.gizmoBusy()
  }

  gizmoAttachedNodeId(): string | null {
    return this.viewport.gizmoAttachedNodeId()
  }

  gizmoAttachedNodeIds(): string[] {
    return this.viewport.gizmoAttachedNodeIds()
  }

  gizmoHandleHit(ndcX: number, ndcY: number): { name: string; dist: number } | null {
    return this.viewport.gizmoHandleHit(ndcX, ndcY, this.picker.raycaster)
  }

  readAttachedTransform(prop: 'position' | 'rotation' | 'scale', nodeId?: string): number[] | null {
    return this.viewport.readAttachedTransform(prop, nodeId)
  }

  gizmoInteractionProp(): 'position' | 'rotation' | 'scale' {
    return this.viewport.gizmoInteractionProp()
  }

  onGizmoDraggingChanged(fn: (dragging: boolean) => void): () => void {
    const gizmo = this.viewport.unified
    if (!gizmo) return () => undefined
    const handler = (e: { value?: unknown }) => fn(Boolean(e.value))
    gizmo.addEventListener('dragging-changed', handler)
    return () => gizmo.removeEventListener('dragging-changed', handler)
  }

  onGizmoObjectChange(fn: () => void): () => void {
    const gizmo = this.viewport.unified
    if (!gizmo) return () => undefined
    gizmo.addEventListener('objectChange', fn)
    return () => gizmo.removeEventListener('objectChange', fn)
  }

  addPathNode(n: DraftNode): void {
    buildPathInstance(this, n)
    this.invalidate()
  }


  refreshPathNode(nodeId: string): void {
    const n = this.doc?.content.nodes.find((node) => node.id === nodeId && node.type === 'path')
    if (!n) return
    removePathNode(this, nodeId)
    buildPathInstance(this, n)
    this.invalidate()
  }

  syncPathNodes(): void {
    syncPathNodes(this)
    this.invalidate()
  }

  syncPathSelection(selectedNodeId: string | null, visiblePathIds: Iterable<string> = this.visiblePathIds): void {
    this.highlightPathId = selectedNodeId
    syncPathSelection(this, selectedNodeId, visiblePathIds)
    this.invalidate()
  }


  syncCameraMotionGuide(cameraId: string | null, chained = false): void {
    applyCameraMotionGuide(this, cameraId, chained)
  }

  updateDrawPreview(points: [number, number, number][]): void {
    this.clearDrawPreview()
    const g = buildDrawPreview(points)
    if (!g) return
    this.scene.add(g)
    this.drawPreview = g
    this.invalidate()
  }

  clearDrawPreview(): void {
    if (!this.drawPreview) return
    disposeDrawPreview(this.drawPreview)
    this.scene.remove(this.drawPreview)
    this.drawPreview = null
    this.invalidate()
  }

  nodePosition(id: string): [number, number, number] | null {
    const snap = this.snapshot.get(id)
    if (snap) return [snap.position[0], snap.position[1], snap.position[2]]
    const n = this.nodeById.get(id)
    return n ? [n.transform.position.x, n.transform.position.y, n.transform.position.z] : null
  }

  setOrbitEnabled(v: boolean): void {
    this.viewport.setOrbitEnabled(v)
  }

  setLeftPointerReserved(v: boolean): void {
    this.viewport.setLeftPointerReserved(v)
  }

  getActiveClipLabel(cameraNodeId: string, frame: number): string | null {
    const clip = this.doc?.content.timeline.animation.cameraMotionClips.find(
      (c) => c.target.nodeId === cameraNodeId && frame >= c.frameStart && frame <= c.frameEnd,
    )
    return clip ? clip.motion.label : null
  }

  getRetargetInfo(nodeId: string): { matched: number; unmatched: number; hipScale: number } | null {
    const ch = this.characters.get(nodeId)
    if (!ch?.retargeter) return null
    return {
      matched: ch.retargeter.matchedCount,
      unmatched: ch.retargeter.unmatchedCount,
      hipScale: ch.retargeter.hipScaleRatio,
    }
  }

  dispose(): void {
    this.renderLoop.disposed = true
    this.renderLoop.stop()
    this.pause()
    this.viewport.detachMain()
    this.viewport.detachPreview()
    this.events.clear()
    this.reset()
    this.joints.dispose()
    this.loader.clear()
    disposeThumbnailRenderer(this)
    this.disposeExportGpu()
  }

  private disposeExportGpu(): void {
    this.exportTarget?.dispose()
    this.exportTarget = null
  }

  private evaluateCurrent(): void {
    this.evaluate(this.currentFrame, this.evalUserKeys, this.evalUserKeysEnabled, this.evalChainCameraMotion)
  }

  private readonly onClockTick = (now: number): void => {
    const doc = this.doc
    if (!doc || !this.ready || this.renderLoop.webGLContextLost) return
    this.clock.acc += this.clock.dt(now) * doc.content.timeline.fps
    if (this.clock.acc < 1) return
    const adv = Math.floor(this.clock.acc)
    this.clock.acc -= adv
    const tl = doc.content.timeline
    let f = this.currentFrame + adv
    const span = tl.frameEnd - tl.frameStart + 1
    if (f > tl.frameEnd) f = tl.frameStart + ((f - tl.frameStart) % span)
    this.currentFrame = f
    this.stats.clockFrames += 1
    this.evaluateCurrent()
    this.emitFrame(now)
    this.invalidate()
  }

  private emitFrame(now: number, forceThrottle = false): void {
    this.events.emit('frame', this.currentFrame)
    if (!forceThrottle && now - this.lastThrottleAt < FRAME_THROTTLE_MS) return
    this.lastThrottleAt = now
    this.stats.throttled += 1
    this.events.emit('frame:throttled', this.currentFrame)
  }

  private forceRender(): void {
    if (!this.ready) return
    this.stats.renderFrames += 1
    const hideOverlays = this.programPreviewActive || this.viewport.followMode || this.viewport.cameraPilot
    this.syncGizmo(this.gizmoNodeId, this.gizmoMode, this.gizmoSuspended, this.gizmoNodeIds)
    syncPathSelection(
      this,
      hideOverlays ? null : this.highlightPathId,
      hideOverlays ? [] : this.visiblePathIds,
      hideOverlays,
    )
    const aspect = this.resolvedAspect()
    this.viewport.previewAspect = aspect
    for (const cam of this.cameras.values()) {
      cam.gizmo.setAspect(aspect)
      cam.gizmo.setFov(cam.camera.fov)
      if (Math.abs(cam.camera.aspect - aspect) > 1e-3) {
        cam.camera.aspect = aspect
        cam.camera.updateProjectionMatrix()
      }
    }
    this.syncJointHandles()
    syncLabelTransforms()
    const selectedIds = new Set(
      this.gizmoNodeIds?.length ? this.gizmoNodeIds : this.gizmoNodeId ? [this.gizmoNodeId] : [],
    )
    this.viewport.render(
      this.scene,
      this.cameras,
      this.programCameraId ?? this.activeCameraId,
      hideOverlays,
      selectedIds,
    )
  }
}

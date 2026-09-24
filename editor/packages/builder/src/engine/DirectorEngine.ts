import type { DirectorDocument, DraftNode } from '../contract/types'
import type { FCurveSet } from '../evaluate/curves/FCurveSet'
import type { UserKeys } from '../evaluate/curves/KeyframeTrack'
import type { EngineEventMap, EngineEventName } from './core/EventBus'
import type { ViewportNavPickHandlers } from './interact/ViewportNavigation'
import type { ContainerScreenRect } from './interact/selectionBox'
import type { GizmoDuplicateItem } from './interact/UnifiedGizmo'
import type { PoseLibraryBank } from '../data/poseLibraryBank'

export interface NodeSnapshot {
  position: number[]
  rotation: number[]
  scale: number[]
  lookAt?: number[]
  fov?: number
}

export interface EditorViewPose {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  lookAt: { x: number; y: number; z: number }
  fov: number
}

export interface EvalContext {
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  activeCameraId?: string | null
}

export type ViewportRole = 'main' | 'preview'

export const EDITOR_EXPORT_CAMERA_ID = '__editor__'
export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale'
export type PathDrawStyle = 'click' | 'draw'

export interface EngineStats {
  renderFrames: number
  clockFrames: number
  throttled: number
}

export interface CaptureFrameInput {
  cameraId: string
  label: string
  width: number
  height: number
  frame: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  onExport?: (blob: Blob, meta: { filename: string; mimeType: string }) => Promise<void>
}

export interface RecordRangeInput {
  cameraId: string
  label: string
  width: number
  height: number
  frameStart: number
  frameEnd: number
  fps: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  signal?: AbortSignal
  onProgress?: (p: { frame: number; index: number; total: number }) => void
  onExport?: (blob: Blob, meta: { filename: string; mimeType: string }) => Promise<void>
}

export interface CaptureThumbnailsInput {
  requests: { cameraId: string; frame: number }[]
  width: number
  height: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
}

export interface RecordSequenceInput {
  sequenceId: string
  label: string
  width: number
  height: number
  fps: number
  userKeys: UserKeys
  userKeysEnabled: boolean
  chainCameraMotion: boolean
  signal?: AbortSignal
  onProgress?: (p: {
    frame: number
    index: number
    total: number
    clipId: string
    sourceFrame: number
    cameraNodeId: string
  }) => void
  onExport?: (blob: Blob, meta: { filename: string; mimeType: string }) => Promise<void>
}

/**
 * UI 可见的引擎门面。实现类是 Stage，组件只拿得到这里的方法。
 * load / setEvalContext / 交互查询是现阶段 UI 仍需要的；§3.3 其余能力未落地的不假装有。
 */
export interface DirectorEngine {
  readonly poseBank: PoseLibraryBank
  dispose(): void

  attachViewport(role: ViewportRole, canvas: HTMLCanvasElement): void
  detachViewport(role: ViewportRole): void
  mainCanvas(): HTMLCanvasElement | null
  viewportAspect(): number
  resolvedAspect(): number

  seek(frame: number): void
  play(direction?: 'forward' | 'reverse'): void
  pause(): void
  invalidate(): void
  on<E extends EngineEventName>(event: E, fn: (payload: EngineEventMap[E]) => void): () => void

  load(doc: DirectorDocument, onProgress?: (msg: string) => void): Promise<void>
  reset(): void
  setEvalContext(ctx: EvalContext): void
  setFcurves(fcurves: FCurveSet | null): void
  hasNode(nodeId: string): boolean
  removeNode(nodeId: string): void
  addRuntimeNode(node: DraftNode): Promise<boolean>
  loadMotion(assetId: string, url: string): Promise<number>

  readonly currentFrame: number
  readonly playing: boolean
  readonly ready: boolean
  readonly stats: EngineStats

  getNodeSnapshot(nodeId: string): NodeSnapshot | null
  captureEditorView(): EditorViewPose | null
  readEditorCameraRotation(): { x: number; y: number; z: number }
  resetEditorView(): void
  focusNode(nodeId: string): void
  focusNodes(nodeIds: string[]): void
  poseJointHit(nodeId: string, ndcX: number, ndcY: number): { specId: string } | null
  poseJointBegin(nodeId: string, specId: string, ndcX: number, ndcY: number): boolean
  poseJointDrag(ndcX: number, ndcY: number): Record<string, { x: number; y: number; z: number }> | null
  poseJointHover(ndcX: number, ndcY: number): void
  poseJointEnd(): void
  poseJointCancel(): void
  poseJointBusy(): boolean
  setPoseEditingId(id: string | null): void
  projectNodeScreenRect(container: HTMLElement, nodeId: string): ContainerScreenRect | null
  projectNodeWireframe(container: HTMLElement, nodeId: string): { x1: number; y1: number; x2: number; y2: number }[]
  projectWorldToContainer(
    container: HTMLElement,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; visible: boolean } | null
  applyNodeVisibility(): void
  pickAt(x: number, y: number): string | null
  pickNodeHit(x: number, y: number): { id: string; dist: number } | null
  pickCameraHit(x: number, y: number): { id: string; dist: number } | null
  pickPathHit(x: number, y: number): { id: string; dist: number } | null
  pickPathPointHit?(
    x: number,
    y: number,
    pathId?: string | null,
  ): { id: string; index: number; dist: number } | null
  setPathEditing?(pathId: string | null, pointIndex: number | null): void
  applyLivePathStroke?(pathId: string): void
  applyLivePathTransform?(pathId: string): void
  ndcFromClient(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number }
  nodePosition(id: string): [number, number, number] | null
  groundPoint(ndcX: number, ndcY: number, y: number): [number, number, number] | null
  groundDrawPoint(ndcX: number, ndcY: number): [number, number, number] | null
  setOrbitEnabled(enabled: boolean): void
  /** 路径绘制占用左键时为 true。导航本身保持开启。 */
  setLeftPointerReserved(reserved: boolean): void
  setNavPickHandlers(handlers: ViewportNavPickHandlers | null): void
  pickIdsInScreenRect(container: HTMLElement, rect: ContainerScreenRect): string[]
  pickPathPointIndicesInScreenRect?(container: HTMLElement, rect: ContainerScreenRect, pathId: string): number[]
  setGizmoDuplicateHandler(fn: ((items: GizmoDuplicateItem[]) => void) | null): void
  gizmoIsDuplicating(): boolean
  consumeGizmoDuplicateDrag(): boolean
  getRetargetInfo(nodeId: string): { matched: number; unmatched: number; hipScale: number } | null
  /** 当前姿势下与地面的接触高度（世界 Y） */
  worldContactY(nodeId: string): number | null
  /** 当前姿势下与地面的接触点（人物脚底中点 / 网格底面中心） */
  worldContactPoint(nodeId: string): { x: number; y: number; z: number } | null
  /** 对承托网格向下射线采样得到的三角形命中（空数组表示尚无几何） */
  meshSupportHits(nodeId: string): { x: number; y: number; z: number }[] | null
  /** 可见网格的世界 AABB */
  worldAabb(nodeId: string): {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
    centerX: number
    centerY: number
    centerZ: number
  } | null
  /** 看向该节点时的瞄准点（人物胸口优先） */
  worldAimPoint(nodeId: string): { x: number; y: number; z: number } | null

  beginFollow(): void
  endFollow(): void
  beginCameraPilot(nodeId: string): boolean
  endCameraPilot(): { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } } | null
  applyLiveCameraPose(
    nodeId: string,
    position: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number } | null,
    rotation?: { x: number; y: number; z: number } | null,
  ): void
  applyLiveCameraFov(nodeId: string, fov: number): void
  applyLiveNodeTransform(
    nodeId: string,
    t: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ): void
  setStagedTransform(
    nodeId: string,
    patch: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
      lookAt?: { x: number; y: number; z: number }
      fov?: number
    },
  ): void
  clearStagedTransforms(nodeId?: string): void
  hasStagedTransform(nodeId: string): boolean
  readAttachedCameraAim(lookDistance: number): { x: number; y: number; z: number } | null
  syncGizmo(nodeId: string | null, mode: GizmoMode, suspended: boolean, nodeIds?: string[]): void
  gizmoBusy(): boolean
  gizmoAttachedNodeId(): string | null
  gizmoAttachedNodeIds(): string[]
  gizmoHandleHit(ndcX: number, ndcY: number): { name: string; dist: number } | null
  readAttachedTransform(prop: 'position' | 'rotation' | 'scale', nodeId?: string): number[] | null
  gizmoInteractionProp(): 'position' | 'rotation' | 'scale'
  onGizmoDraggingChanged(fn: (dragging: boolean) => void): () => void
  onGizmoObjectChange(fn: () => void): () => void
  addPathNode(node: DraftNode): void
  syncPathNodes(): void
  refreshPathNode?(nodeId: string): void
  syncPathSelection(selectedNodeId: string | null, visiblePathIds?: Iterable<string>): void
  syncCameraMotionGuide(cameraId: string | null, chained?: boolean): void
  updateDrawPreview(points: [number, number, number][]): void
  clearDrawPreview(): void

  captureFrame(opts: CaptureFrameInput): Promise<void>
  previewFrame(opts: CaptureFrameInput): Promise<Blob>
  previewFrameToCanvas(opts: CaptureFrameInput & { canvas: HTMLCanvasElement }): void
  releaseExportPreview(): void
  /** 批量离屏缩略图（jpeg data URL），顺序与 requests 对齐，取不到相机的位置为 null。 */
  captureThumbnails(opts: CaptureThumbnailsInput): (string | null)[]
  recordRange(opts: RecordRangeInput): Promise<{ cancelled: boolean; frames: number }>
  recordSequence(opts: RecordSequenceInput): Promise<{ cancelled: boolean; frames: number }>
  beginProgramPreview(): void
  previewProgramFrame(sourceFrame: number, cameraId: string): void
  endProgramPreview(): void
  readonly programPreviewActive: boolean
}

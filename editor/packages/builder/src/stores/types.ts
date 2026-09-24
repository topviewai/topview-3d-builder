import type { DirectorDocument, DraftNode, MotionClip } from '../contract/types'
import type { ClipMoveLayout } from '../document/clipMove'
import type { FCurveSet } from '../evaluate/curves/FCurveSet'
import type { Interpolation, TrackProp, UserKeys } from '../evaluate/curves/KeyframeTrack'
import type { CharacterLibEntry } from '../host/types'

export type DuplicateTransform = {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

export type DuplicateSelectionInput =
  | { kind: 'gizmo'; items: Array<{ id: string; from?: DuplicateTransform; to: DuplicateTransform }> }
  | {
      kind: 'offset'
      delta: {
        position?: [number, number, number]
        rotation?: [number, number, number]
        scale?: [number, number, number]
      }
    }

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale'
export type PathDrawStyle = 'click' | 'draw'
export type WorkspaceMode = 'scene' | 'film'
export type FilmClockMode = 'idle' | 'sequence' | 'source'

export interface FilmPlaybackSnapshot {
  mode: FilmClockMode
  sequenceFrame: number
  sourcePreviewFrame: number
}
export type FilmSelection = { kind: 'edit-clip'; clipId: string }

export interface FilmAddDraft {
  cameraNodeId: string
  sourceFrameStart: number
  sourceFrameEnd: number
}

export type FilmDragKind =
  | 'source-move'
  | 'source-trim-start'
  | 'source-trim-end'
  | 'sequence-reorder'
  | 'sequence-trim-start'
  | 'sequence-trim-end'

export interface FilmDragPreview {
  kind: FilmDragKind
  clipId: string
  cameraNodeId: string
  sourceFrameStart: number
  sourceFrameEnd: number
  toIndex?: number
}

export type KeyframeRef = {
  nodeId: string
  prop: TrackProp
  keyId: string
}

export type ClipRef = { clipType: 'camera' | 'motion' | 'path'; clipId: string }

export type Selection =
  | { kind: 'node'; nodeId: string; nodeIds?: string[] }
  | { kind: 'clip'; clipType: 'camera' | 'motion' | 'path'; clipId: string; clips?: ClipRef[] }
  | { kind: 'keyframe'; nodeId: string; prop: TrackProp; keyId: string; keys?: KeyframeRef[] }
  /** 时间轴框选：运镜/动作/路径片段与关键帧可混合选中。 */
  | { kind: 'timelineBox'; clips: ClipRef[]; keys: KeyframeRef[] }
  /** 「变换」轨道的组合关键帧：同一帧上变换子轨道的键集合 */
  | { kind: 'transformKeyframe'; nodeId: string; frame: number }

export function keyframeRefsOf(sel: Selection | null): KeyframeRef[] {
  if (sel?.kind === 'timelineBox') return sel.keys
  if (sel?.kind !== 'keyframe') return []
  return sel.keys?.length
    ? sel.keys
    : [{ nodeId: sel.nodeId, prop: sel.prop, keyId: sel.keyId }]
}

export function makeKeyframeSelection(refs: KeyframeRef[]): Selection | null {
  if (refs.length === 0) return null
  const last = refs[refs.length - 1]
  return {
    kind: 'keyframe',
    nodeId: last.nodeId,
    prop: last.prop,
    keyId: last.keyId,
    keys: refs.length > 1 ? refs : undefined,
  }
}

export function isKeyframeSelected(sel: Selection | null, keyId: string): boolean {
  return keyframeRefsOf(sel).some((item) => item.keyId === keyId)
}

export function clipRefsOf(sel: Selection | null): ClipRef[] {
  if (!sel) return []
  if (sel.kind === 'clip') {
    return sel.clips?.length
      ? sel.clips
      : [{ clipType: sel.clipType, clipId: sel.clipId }]
  }
  if (sel.kind === 'timelineBox') return sel.clips
  return []
}

export function makeClipSelection(refs: ClipRef[]): Selection | null {
  if (refs.length === 0) return null
  const last = refs[refs.length - 1]
  return {
    kind: 'clip',
    clipType: last.clipType,
    clipId: last.clipId,
    clips: refs.length > 1 ? refs : undefined,
  }
}

export function isClipSelected(sel: Selection | null, clipId: string): boolean {
  return clipRefsOf(sel).some((item) => item.clipId === clipId)
}

/** Preserve an existing group on press; modifiers toggle only the pressed clip. */
export function nextClipSelection(sel: Selection | null, ref: ClipRef, additive: boolean): Selection | null {
  const refs = clipRefsOf(sel)
  const includes = refs.some((item) => item.clipType === ref.clipType && item.clipId === ref.clipId)
  if (!additive) return includes ? sel : makeClipSelection([ref])
  return makeTimelineBoxSelection(
    includes ? refs.filter((item) => item.clipType !== ref.clipType || item.clipId !== ref.clipId) : [...refs, ref],
    keyframeRefsOf(sel),
  )
}

export function makeTimelineBoxSelection(clips: ClipRef[], keys: KeyframeRef[]): Selection | null {
  if (clips.length === 0 && keys.length === 0) return null
  if (clips.length === 0) return makeKeyframeSelection(keys)
  if (keys.length === 0) return makeClipSelection(clips)
  return { kind: 'timelineBox', clips, keys }
}

export type LibraryTab = 'object' | 'character' | 'prop' | 'motion' | 'camera' | 'cameraMotion'

/** 已有变换关键帧时，视口 / 面板改数先记在这里，确认后再打键。 */
export interface PendingKeyframe {
  nodeId: string
  frame: number
  position?: number[]
  rotation?: number[]
  scale?: number[]
  lookAt?: number[]
  fov?: number[]
}

export interface EnvironmentPatch {
  skyColor?: string
  characterLabelsVisible?: boolean
  groundVisible?: boolean
  groundHeight?: number
  groundOpacity?: number
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface SaveOptions {
  /** 默认 true；定时 autosave 传 false，避免按保存间隔做 WebGL readback */
  captureCover?: boolean
}

export interface ClipMovePreview extends ClipMoveLayout {
  clipType: 'camera' | 'motion' | 'path'
  clipId: string
  clips?: ClipRef[]
}

export interface ClipResizePreview {
  clipType: 'camera' | 'motion' | 'path'
  clipId: string
  frameStart: number
  frameEnd: number
  /** Same-track ripple layout (camera). Includes the resized clip + shifted neighbours. */
  positions?: Record<string, { frameStart: number; frameEnd: number }>
}

export interface StudioView {
  draftId: string
  doc: DirectorDocument | null
  clipMovePreview: ClipMovePreview | null
  clipResizePreview: ClipResizePreview | null
  loadStatus: string
  ready: boolean
  /** 为 true 时只阻止文档写入，浏览与导航仍可用。 */
  writeLocked: boolean
  /** 宿主只读会话，目前是 writeLocked 的唯一来源。 */
  hostReadOnly: boolean
  /** 非 observable：读引擎 currentFrame，播放时不触发 React 提交 */
  frame: number
  playing: boolean
  activeCameraId: string | null
  selection: Selection | null
  userKeys: UserKeys
  userKeysEnabled: boolean
  /** 改物体属性时是否在当前帧自动打关键帧；默认关。 */
  autoKeyframe: boolean
  /** 时间轴拖动是否吸附到关键帧 / 片段首尾 / 刻度；默认开。 */
  timelineSnap: boolean
  /** 已有变换关键帧的节点，当前帧尚未确认的候选值；有值时禁止挪播放头。 */
  pendingKeyframe: PendingKeyframe | null
  chainCameraMotion: boolean
  pxPerFrame: number
  fcurves: FCurveSet | null
  exporting: boolean
  libraryOpen: boolean
  libraryTab: LibraryTab
  libraryContentWidth: number
  inspectorOpen: boolean
  inspectorContentWidth: number
  timelineOpen: boolean
  /** 场景时间轴整块是否显示。false 时面板不占位，不是收起后的工具条。 */
  timelineVisible: boolean
  /** 本轮编辑里是否正在显示「展开时间轴播放」引导。 */
  timelinePlayHintVisible: boolean
  /** 引导开始淡出的时间戳；超时后不再弹出。 */
  timelinePlayHintUntil: number
  timelineHeight: number
  viewportFullscreen: boolean
  canUndo: boolean
  canRedo: boolean
  followMode: boolean
  /** 视口关节摆姿中的角色 id；null 表示未进入 Edit Pose */
  poseEditingId: string | null
  /** 第一人称操控中的相机 id；null 表示未进入 */
  cameraPilotId: string | null
  /** 轨迹锚点编辑中的路径 id；null 表示未进入编辑 */
  pathEditingId: string | null
  /** 当前激活的轨迹锚点下标 */
  pathEditPointIndex: number | null
  /** 机位 Look At 点选中的相机 id；点物体后写入 lookAtTarget */
  lookAtPickingId: string | null
  /** 轨迹点选绑定中的路径 id；点物体后生成 PathMotionClip */
  pathApplyPickingId: string | null
  cameraAimReleaseVersion: number
  /** 运镜片段内拖动机位位置被拦下后递增，驱动顶部 Toast。 */
  cameraMotionDragNoticeVersion: number
  notifyCameraMotionDragBlocked: () => void
  gizmoMode: GizmoMode
  pathDrawMode: boolean
  pathDrawStyle: PathDrawStyle
  pathDrawPoints: [number, number, number][]
  workspaceMode: WorkspaceMode
  filmSelection: FilmSelection | null
  filmAddDraft: FilmAddDraft | null
  filmBrowseCameraId: string | null
  filmDragPreview: FilmDragPreview | null
  filmTimelineHeight: number
  filmPxPerFrame: number
  filmTrackAligned: boolean
  filmClock: FilmClockMode
  filmExportOpen: boolean

  toggleLibrary: () => void
  setLibraryTab: (t: LibraryTab) => void
  setLibraryContentWidth: (w: number) => void
  toggleInspector: () => void
  setInspectorContentWidth: (w: number) => void
  toggleTimeline: () => void
  toggleTimelinePanel: () => void
  openTimeline: () => void
  requestTimelinePlayHint: () => void
  dismissTimelinePlayHint: () => void
  acceptTimelinePlayHint: () => void
  setTimelineHeight: (h: number) => void
  toggleViewportFullscreen: () => void
  setNodeFlags: (nodeId: string, flags: { visible?: boolean; locked?: boolean }) => string | null
  updateEnvironment: (patch: EnvironmentPatch) => void
  setDraft: (id: string) => void
  setDoc: (doc: DirectorDocument, fcurves?: unknown) => void
  setLoadStatus: (s: string) => void
  setReady: (b: boolean) => void
  setFrame: (f: number) => void
  togglePlay: () => void
  stepFrame: (delta: number) => void
  setActiveCamera: (id: string) => void
  setAspectRatio: (value: string) => void
  setTimelineRange: (frameStart: number, frameEnd: number) => void
  setTimelineFps: (fps: number) => void
  beginTimelineRangeEdit: () => void
  endTimelineRangeEdit: () => void
  select: (s: Selection | null) => void
  setPxPerFrame: (v: number) => void
  setFcurves: (f: FCurveSet | null) => void
  toggleUserKeys: () => void
  toggleAutoKeyframe: () => void
  toggleTimelineSnap: () => void
  addKeyframe: (nodeId: string, prop: TrackProp, value: number[]) => void
  addKeyframes: (nodeId: string, keys: { prop: TrackProp; value: number[] }[]) => void
  /** 多选打关键帧：按节点类型写整套变换通道（给了 props 就只写这些），一条 undo */
  addTransformKeyframes: (nodeIds: readonly string[], props?: readonly TrackProp[]) => void
  commitPendingKeyframe: () => void
  cancelPendingKeyframe: () => void
  moveKeyframe: (nodeId: string, prop: TrackProp, keyId: string, newFrame: number) => void
  moveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
  removeKeyframe: (nodeId: string, prop: TrackProp, keyId: string) => void
  removeKeyframes: (refs: KeyframeRef[]) => void
  removeFcurveKeyframe: (nodeId: string, propPath: string, frame: number) => void
  removeTransformKeysAtFrame: (nodeId: string, frame: number) => void
  setTransformKeysInterpAtFrame: (nodeId: string, frame: number, interp: Interpolation) => void
  setKeyframeInterp: (nodeId: string, prop: TrackProp, keyId: string, interp: Interpolation) => void
  setKeyframesInterp: (refs: KeyframeRef[], interp: Interpolation) => void
  setKeyframeValue: (nodeId: string, prop: TrackProp, keyId: string, value: number[]) => void
  upsertKeyframeAtFrame: (nodeId: string, prop: TrackProp, value: number[]) => void
  toggleChainCameraMotion: () => void
  setExporting: (b: boolean) => void
  applyCameraPreset: (presetId: string) => string | null
  /** 不给 cameraId 就改当前激活机位 */
  setCameraSubjectDistance: (distance: number, cameraId?: string) => string | null
  clearCameraSubject: (cameraId?: string) => string | null
  setCameraFollow: (follow: boolean, cameraId?: string, subjectId?: string) => string | null
  setCameraLookAtTarget: (cameraId: string, nodeId: string | null) => string | null
  setPoseEditingId: (id: string | null) => void
  /** 进入或退出第一人称操控相机。传 null 时写回机位并恢复进入前的编辑视角。 */
  setCameraPilot: (id: string | null) => void
  setPathEditingId: (id: string | null) => void
  setPathEditPointIndex: (index: number | null) => void
  commitPathPoint: (
    pathId: string,
    index: number,
    world: { x: number; y: number; z: number },
  ) => string | null
  commitPathTransform: (
    pathId: string,
    gizmo: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ) => string | null
  beginLookAtPick: (cameraId: string) => void
  cancelLookAtPick: () => void
  beginPathApplyPick: (pathId: string) => void
  cancelPathApplyPick: () => void
  placeNodeOnGround: (nodeId: string) => string | null
  placeNodeOnSupport: (nodeId: string, supportId: string) => string | null
  writeNodeTransform: (
    nodeId: string,
    patch: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ) => string | null
  setCharacterAppearance: (nodeId: string, patch: { color?: string; showLabel?: boolean }) => string | null
  setObjectAppearance: (nodeId: string, patch: { color?: string; showLabel?: boolean }) => string | null
  applyFollowingCameraWorldPos: (
    cameraId: string,
    worldPos: { x: number; y: number; z: number },
    commit: boolean,
  ) => string | null
  writeCameraWorldPos: (
    cameraId: string,
    worldPos: { x: number; y: number; z: number },
    commit: boolean,
  ) => string | null
  writeCameraLookAt: (
    cameraId: string,
    lookAt: { x: number; y: number; z: number },
    commit: boolean,
  ) => string | null
  writeCameraRotation: (
    cameraId: string,
    rotDeg: { x: number; y: number; z: number },
    commit: boolean,
  ) => string | null
  setCameraFov: (fov: number, cameraId?: string) => string | null
  renameNode: (nodeId: string, name: string) => string | null
  applyCameraMotion: (presetId: string) => string | null
  updateCameraMotionConfig: (clipId: string, patch: Record<string, number | string>) => string | null
  resizeCameraMotionClip: (clipId: string, edge: 'start' | 'end', frame: number) => string | null
  resizePathMotionClip: (clipId: string, edge: 'start' | 'end', frame: number) => string | null
  updateMotionClipConfig: (clipId: string, patch: Record<string, number | string | boolean>) => void
  addCameraFromPreset: (presetId: string, name?: string) => string | null
  canSave: boolean
  dirty: boolean
  saveState: SaveState
  /** 始终是 i18n key，消费端可直接 `t()`。原始异常文本放 `saveErrorDetail`。 */
  saveError: string | null
  /** 未本地化的原始异常文本，仅供排障展示（如 title 悬浮），不要丢给 `t()`。 */
  saveErrorDetail: string | null
  save: (opts?: SaveOptions) => Promise<string | null>
  /** 下载当前草稿 JSON + 用户关键帧。产品顶栏不展示，供控制台 / 宿主工具调用。无文档时返回 false。 */
  exportDraft: () => boolean
  addCharacter: (entry: CharacterLibEntry) => Promise<string | null>
  addMotionClipFromLibrary: (fbxKey: string, name: string) => Promise<string | null>
  addPropFromLibrary: (name: string, fileKey: string) => Promise<string | null>
  addPrimitive: (
    name: string,
    kind: string,
    parameters: Record<string, number | string | boolean>,
    transform?: Partial<{
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number }
    }>,
  ) => string | null
  setPoseValue: (nodeId: string, key: string, value: number) => void
  setPoseJoints: (nodeId: string, joints: Record<string, { x: number; y: number; z: number }>) => void
  resetPose: (nodeId: string) => void
  applyPosePreset: (nodeId: string, presetId: string) => string | null
  undo: () => void
  redo: () => void
  beginInteraction: () => void
  beginPoseEdit: () => void
  endPoseEdit: (commit: boolean) => void
  /** 拖拽收尾：期间所有写入压成一条命令；label 用于历史条目命名（如「提交变换」）。 */
  endInteraction: (label: string) => void
  /** 是否有未收尾的拖拽交互（挂起期间所有历史提交都会被丢弃）。 */
  readonly interactionActive: boolean
  setFollowMode: (v: boolean) => void
  resetEditorView: () => void
  focusSelection: () => void
  cloneSelection: (
    transforms?: Record<string, {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    }>,
  ) => void
  duplicateSelection: (input: DuplicateSelectionInput) => void
  setGizmoMode: (m: GizmoMode) => void
  setPathDrawMode: (v: boolean) => void
  setPathDrawStyle: (s: PathDrawStyle) => void
  addPathDrawPoint: (p: [number, number, number]) => void
  clearPathDrawPoints: () => void
  finishPathDraw: () => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  setFilmSelection: (selection: FilmSelection | null) => void
  /** 选中分镜时＝把它换成这台机位；未选中时＝只换看哪台机位的素材。 */
  setFilmBrowseCamera: (cameraNodeId: string) => void
  /** 立刻插入一条默认分镜。传 clipId 插到其后；传 null 追加到末尾。 */
  beginFilmAddDraft: (afterClipId?: string | null) => void
  updateFilmAddDraft: (patch: Partial<FilmAddDraft>) => void
  commitFilmAddDraft: () => void
  cancelFilmAddDraft: () => void
  beginFilmDrag: (kind: FilmDragKind, clipId: string) => void
  previewFilmDrag: (preview: FilmDragPreview) => void
  commitFilmDrag: () => void
  cancelFilmDrag: () => void
  setFilmTimelineHeight: (h: number) => void
  setFilmPxPerFrame: (v: number) => void
  alignFilmTrackToSource: (width: number, sourceFrames: number, persist?: boolean) => void
  setFilmExportOpen: (open: boolean) => void
  createFilmSequence: (name?: string) => void
  renameFilmSequence: (sequenceId: string, name: string | null) => void
  duplicateFilmSequence: (sequenceId: string) => void
  deleteFilmSequence: (sequenceId: string) => void
  activateFilmSequence: (sequenceId: string) => void
  duplicateFilmClip: (clipId: string) => void
  deleteFilmClip: (clipId: string) => void
  updateFilmClip: (
    clipId: string,
    patch: Partial<{ cameraNodeId: string; sourceFrameStart: number; sourceFrameEnd: number }>,
  ) => void
  seekFilmSequence: (frame: number) => void
  seekFilmSource: (frame: number) => void
  playFilmSequence: () => void
  playFilmSource: () => void
  pauseFilm: () => void
  fitFilmSequence: () => void
  deleteSelection: () => void
  deleteNode: (id: string) => void
  deleteClip: (clipType: 'camera' | 'motion' | 'path', clipId: string) => void
  deletePathNode: (id: string) => void
  applyPathToTarget: (pathNodeId: string, targetId: string) => string | null
  beginClipResize: () => void
  resizeClip: (
    clipType: 'camera' | 'motion' | 'path',
    clipId: string,
    edge: 'start' | 'end',
    frame: number,
  ) => void
  endClipResize: () => void
  cancelClipResize: () => void
  beginClipMove: () => void
  moveClip: (clipType: 'camera' | 'motion' | 'path', clipId: string, frame: number) => void
  endClipMove: () => void
  cancelClipMove: () => void
  commitCharacterDrag: (nodeId: string, frame: number, pos: [number, number, number]) => void
  commitNodeTransform: (
    nodeId: string,
    frame: number,
    t: { position?: number[]; rotation?: number[]; scale?: number[] },
  ) => void
  commitNodeTransforms: (
    frame: number,
    items: { nodeId: string; position?: number[]; rotation?: number[]; scale?: number[] }[],
  ) => void
}

export type DirectorStore = {
  (): StudioView
  <T>(selector: (s: StudioView) => T): T
  getState(): StudioView
}

export type { DraftNode, MotionClip }

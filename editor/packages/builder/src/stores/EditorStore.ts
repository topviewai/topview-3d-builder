import { action, makeObservable, observable } from 'mobx'
import type {
  ClipMovePreview,
  ClipResizePreview,
  FilmAddDraft,
  FilmClockMode,
  FilmDragPreview,
  FilmSelection,
  LibraryTab,
  GizmoMode,
  PathDrawStyle,
  PendingKeyframe,
  SaveState,
  Selection,
  WorkspaceMode,
} from './types'

export const TIMELINE_HEIGHT_MIN = 140
export const TIMELINE_HEIGHT_MAX = 560
export const TIMELINE_HEIGHT_DEFAULT = 320
export const FILM_TIMELINE_HEIGHT_MIN = 390
// 上限按「机位面板 + 轨道刚好被片段填满」定：再高只会在片段上下留空带。
export const FILM_TIMELINE_HEIGHT_MAX = 530
export const FILM_TIMELINE_HEIGHT_DEFAULT = 410
/** 内容区 248 + 四周 padding 12 + 右边框 1 */
export const CONTENT_WIDTH_DEFAULT = 273
export const CONTENT_WIDTH_MIN = 180
export const CONTENT_WIDTH_MAX = 360
export const INSPECTOR_WIDTH_MIN = 220
export const INSPECTOR_WIDTH_MAX = 400
export const INSPECTOR_WIDTH_DEFAULT = 280

export function clampTimelineHeight(value: number): number {
  return Math.min(TIMELINE_HEIGHT_MAX, Math.max(TIMELINE_HEIGHT_MIN, Math.round(value)))
}

export function clampInspectorWidth(value: number): number {
  return Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, Math.round(value)))
}

export function clampFilmTimelineHeight(value: number): number {
  return Math.min(FILM_TIMELINE_HEIGHT_MAX, Math.max(FILM_TIMELINE_HEIGHT_MIN, Math.round(value)))
}

export class EditorStore {
  clipMovePreview: ClipMovePreview | null = null
  clipResizePreview: ClipResizePreview | null = null
  draftId: string
  loadStatus = '加载草稿…'
  ready = false
  playing = false
  activeCameraId: string | null = null
  selection: Selection | null = null
  userKeysEnabled = true
  autoKeyframe = false
  timelineSnap = true
  chainCameraMotion = false
  pxPerFrame = 1.5
  exporting = false
  libraryOpen = true
  libraryTab: LibraryTab = 'character'
  libraryContentWidth = CONTENT_WIDTH_DEFAULT
  inspectorOpen = true
  inspectorContentWidth = INSPECTOR_WIDTH_DEFAULT
  timelineOpen = false
  /** 场景时间轴是否挂在布局里。关时整块不渲染，不是收成工具条。 */
  timelineVisible = false
  /** 本轮编辑里是否已经提示过「展开时间轴播放」。 */
  timelinePlayHintSpent = false
  timelinePlayHintVisible = false
  timelinePlayHintUntil = 0
  timelineHeight = TIMELINE_HEIGHT_DEFAULT
  viewportFullscreen = false
  followMode = false
  poseEditingId: string | null = null
  /** 第一人称操控中的相机 id；null 表示未进入 */
  cameraPilotId: string | null = null
  pathEditingId: string | null = null
  pathEditPointIndex: number | null = null
  lookAtPickingId: string | null = null
  /** 轨迹「点选绑定」中的路径 id */
  pathApplyPickingId: string | null = null
  cameraAimReleaseVersion = 0
  cameraMotionDragNoticeVersion = 0
  gizmoMode: GizmoMode = 'translate'
  pathDrawMode = false
  pathDrawStyle: PathDrawStyle = 'draw'
  pathDrawPoints: [number, number, number][] = []
  saveState: SaveState = 'idle'
  saveError: string | null = null
  saveErrorDetail: string | null = null
  pendingKeyframes: PendingKeyframe[] = []
  workspaceMode: WorkspaceMode = 'scene'
  filmSelection: FilmSelection | null = null
  filmAddDraft: FilmAddDraft | null = null
  /** 机位面板常驻，未选中分镜时也得有机位可看；选中分镜时跟着它的机位走。 */
  filmBrowseCameraId: string | null = null
  filmDragPreview: FilmDragPreview | null = null
  filmTimelineHeight = FILM_TIMELINE_HEIGHT_DEFAULT
  filmPxPerFrame = 4
  /** 进成片后只按机位时长对过一次比例；用户缩放或成片变长都不再改。 */
  filmTrackAligned = false
  filmClock: FilmClockMode = 'idle'
  filmExportOpen = false
  sceneResume: {
    frame: number
    cameraId: string | null
    selection: Selection | null
    followMode: boolean
    libraryOpen: boolean
    inspectorOpen: boolean
  } | null = null

  constructor(initialDraftId: string) {
    this.draftId = initialDraftId
    makeObservable(this, {
      clipMovePreview: observable.ref,
      clipResizePreview: observable.ref,
      setClipMovePreview: action.bound,
      setClipResizePreview: action.bound,
      draftId: observable,
      loadStatus: observable,
      ready: observable,
      playing: observable,
      activeCameraId: observable,
      selection: observable.ref,
      userKeysEnabled: observable,
      autoKeyframe: observable,
      timelineSnap: observable,
      chainCameraMotion: observable,
      pxPerFrame: observable,
      exporting: observable,
      libraryOpen: observable,
      libraryTab: observable,
      libraryContentWidth: observable,
      inspectorOpen: observable,
      inspectorContentWidth: observable,
      timelineOpen: observable,
      timelineVisible: observable,
      timelinePlayHintSpent: observable,
      timelinePlayHintVisible: observable,
      timelinePlayHintUntil: observable,
      timelineHeight: observable,
      viewportFullscreen: observable,
      followMode: observable,
      poseEditingId: observable,
      cameraPilotId: observable,
      pathEditingId: observable,
      pathEditPointIndex: observable,
      lookAtPickingId: observable,
      pathApplyPickingId: observable,
      cameraAimReleaseVersion: observable,
      notifyCameraAimReleased: action.bound,
      cameraMotionDragNoticeVersion: observable,
      notifyCameraMotionDragBlocked: action.bound,
      gizmoMode: observable,
      pathDrawMode: observable,
      pathDrawStyle: observable,
      pathDrawPoints: observable.ref,
      saveState: observable,
      saveError: observable,
      saveErrorDetail: observable,
      pendingKeyframes: observable.ref,
      mergePendingKeyframe: action.bound,
      clearPendingKeyframes: action.bound,
      workspaceMode: observable,
      filmSelection: observable.ref,
      filmAddDraft: observable.ref,
      filmBrowseCameraId: observable,
      filmDragPreview: observable.ref,
      filmTimelineHeight: observable,
      filmPxPerFrame: observable,
      filmTrackAligned: observable,
      filmClock: observable,
      filmExportOpen: observable,
      sceneResume: observable.ref,
      setWorkspaceModeFlag: action.bound,
      setFilmSelection: action.bound,
      setFilmAddDraft: action.bound,
      setFilmBrowseCameraId: action.bound,
      setFilmDragPreview: action.bound,
      setFilmTimelineHeight: action.bound,
      setFilmPxPerFrame: action.bound,
      alignFilmTrackToSource: action.bound,
      setFilmClock: action.bound,
      setFilmExportOpen: action.bound,
      setSceneResume: action.bound,
      setPanelsOpen: action.bound,
      resetForDraft: action.bound,
      setDraftId: action.bound,
      setLoadStatus: action.bound,
      setReady: action.bound,
      setPlaying: action.bound,
      setActiveCamera: action.bound,
      select: action.bound,
      setPxPerFrame: action.bound,
      toggleUserKeys: action.bound,
      toggleAutoKeyframe: action.bound,
      toggleTimelineSnap: action.bound,
      toggleChainCameraMotion: action.bound,
      setExporting: action.bound,
      toggleLibrary: action.bound,
      setLibraryTab: action.bound,
      setLibraryContentWidth: action.bound,
      toggleInspector: action.bound,
      setInspectorContentWidth: action.bound,
      toggleTimeline: action.bound,
      toggleTimelinePanel: action.bound,
      openTimeline: action.bound,
      requestTimelinePlayHint: action.bound,
      dismissTimelinePlayHint: action.bound,
      acceptTimelinePlayHint: action.bound,
      setTimelineHeight: action.bound,
      toggleViewportFullscreen: action.bound,
      setFollowModeFlag: action.bound,
      setPoseEditingId: action.bound,
      setCameraPilotId: action.bound,
      setPathEditingIdFlag: action.bound,
      setPathEditPointIndex: action.bound,
      setLookAtPickingId: action.bound,
      setPathApplyPickingId: action.bound,
      setGizmoMode: action.bound,
      setPathDrawModeFlag: action.bound,
      setPathDrawStyleFlag: action.bound,
      setPathDrawPoints: action.bound,
      setSaveState: action.bound,
    })
  }

  resetForDraft(id: string): void {
    this.draftId = id
    this.ready = false
    this.playing = false
    this.activeCameraId = null
    this.selection = null
    this.libraryOpen = true
    this.libraryTab = 'character'
    this.libraryContentWidth = CONTENT_WIDTH_DEFAULT
    this.clipMovePreview = null
    this.clipResizePreview = null
    this.followMode = false
    this.poseEditingId = null
    this.cameraPilotId = null
    this.pathEditingId = null
    this.pathEditPointIndex = null
    this.lookAtPickingId = null
    this.pathApplyPickingId = null
    this.cameraAimReleaseVersion = 0
    this.cameraMotionDragNoticeVersion = 0
    this.pathDrawMode = false
    this.pathDrawPoints = []
    this.loadStatus = '加载草稿…'
    this.saveState = 'idle'
    this.saveError = null
    this.saveErrorDetail = null
    this.pendingKeyframes = []
    this.viewportFullscreen = false
    this.timelinePlayHintSpent = false
    this.timelinePlayHintVisible = false
    this.timelinePlayHintUntil = 0
    this.workspaceMode = 'scene'
    this.filmSelection = null
    this.filmAddDraft = null
    this.filmBrowseCameraId = null
    this.filmDragPreview = null
    this.filmPxPerFrame = 4
    this.filmTrackAligned = false
    this.filmClock = 'idle'
    this.filmExportOpen = false
    this.sceneResume = null
  }

  setClipMovePreview(preview: ClipMovePreview | null): void {
    this.clipMovePreview = preview
  }

  setClipResizePreview(preview: ClipResizePreview | null): void {
    this.clipResizePreview = preview
  }

  setDraftId(id: string): void {
    this.draftId = id
  }

  setLoadStatus(loadStatus: string): void {
    this.loadStatus = loadStatus
  }

  setReady(ready: boolean): void {
    this.ready = ready
  }

  setPlaying(playing: boolean): void {
    this.playing = playing
  }

  setActiveCamera(id: string | null): void {
    this.activeCameraId = id
  }

  select(selection: Selection | null): void {
    this.selection = selection
  }

  setPxPerFrame(v: number): void {
    this.pxPerFrame = Math.min(Math.max(v, 0.2), 20)
  }

  toggleUserKeys(): void {
    this.userKeysEnabled = !this.userKeysEnabled
  }

  toggleAutoKeyframe(): void {
    this.autoKeyframe = !this.autoKeyframe
  }

  toggleTimelineSnap(): void {
    this.timelineSnap = !this.timelineSnap
  }

  toggleChainCameraMotion(): void {
    this.chainCameraMotion = !this.chainCameraMotion
  }

  setExporting(exporting: boolean): void {
    this.exporting = exporting
  }

  toggleLibrary(): void {
    this.libraryOpen = !this.libraryOpen
  }

  setLibraryTab(tab: LibraryTab): void {
    this.libraryTab = tab
    this.libraryOpen = true
  }

  setLibraryContentWidth(w: number): void {
    this.libraryContentWidth = Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, Math.round(w)))
  }

  toggleInspector(): void {
    this.inspectorOpen = !this.inspectorOpen
  }

  setInspectorContentWidth(w: number): void {
    this.inspectorContentWidth = clampInspectorWidth(w)
  }

  toggleTimeline(): void {
    this.timelineOpen = !this.timelineOpen
  }

  toggleTimelinePanel(): void {
    this.timelineVisible = !this.timelineVisible
    if (this.timelineVisible) this.timelineOpen = true
  }

  openTimeline(): void {
    this.timelineOpen = true
    this.timelineVisible = true
  }

  /** 侧栏首次成功加上运镜或动作，且时间轴仍收起时，提示一次。 */
  requestTimelinePlayHint(): void {
    if (this.timelinePlayHintSpent || this.timelineVisible || this.workspaceMode === 'film') return
    this.timelinePlayHintSpent = true
    this.timelinePlayHintVisible = true
    this.timelinePlayHintUntil = Date.now() + 5000
  }

  dismissTimelinePlayHint(): void {
    this.timelinePlayHintSpent = true
    this.timelinePlayHintVisible = false
  }

  acceptTimelinePlayHint(): void {
    this.dismissTimelinePlayHint()
    this.openTimeline()
  }

  setTimelineHeight(h: number): void {
    this.timelineHeight = clampTimelineHeight(h)
    this.timelineOpen = true
  }

  toggleViewportFullscreen(): void {
    this.viewportFullscreen = !this.viewportFullscreen
  }

  setFollowModeFlag(v: boolean): void {
    this.followMode = v
  }

  setPoseEditingId(id: string | null): void {
    this.poseEditingId = id
  }

  setCameraPilotId(id: string | null): void {
    this.cameraPilotId = id
  }

  setPathEditingIdFlag(id: string | null): void {
    this.pathEditingId = id
    if (id == null) this.pathEditPointIndex = null
  }

  setPathEditPointIndex(index: number | null): void {
    this.pathEditPointIndex = index
  }

  setLookAtPickingId(id: string | null): void {
    this.lookAtPickingId = id
  }

  setPathApplyPickingId(id: string | null): void {
    this.pathApplyPickingId = id
  }

  notifyCameraAimReleased(): void {
    this.cameraAimReleaseVersion += 1
  }

  notifyCameraMotionDragBlocked(): void {
    this.cameraMotionDragNoticeVersion += 1
  }

  setGizmoMode(m: GizmoMode): void {
    this.gizmoMode = m
  }

  setPathDrawModeFlag(v: boolean): void {
    this.pathDrawMode = v
    if (!v) this.pathDrawPoints = []
  }

  setPathDrawStyleFlag(s: PathDrawStyle): void {
    this.pathDrawStyle = s
    this.pathDrawPoints = []
  }

  setPathDrawPoints(points: [number, number, number][]): void {
    this.pathDrawPoints = points
  }

  setSaveState(
    saveState: SaveState,
    saveError: string | null = null,
    saveErrorDetail: string | null = null,
  ): void {
    this.saveState = saveState
    this.saveError = saveError
    this.saveErrorDetail = saveErrorDetail
  }

  setWorkspaceModeFlag(mode: WorkspaceMode): void {
    this.workspaceMode = mode
  }

  setFilmSelection(selection: FilmSelection | null): void {
    this.filmSelection = selection
  }

  setFilmAddDraft(draft: FilmAddDraft | null): void {
    this.filmAddDraft = draft
  }

  setFilmBrowseCameraId(cameraId: string | null): void {
    this.filmBrowseCameraId = cameraId
  }

  setFilmDragPreview(preview: FilmDragPreview | null): void {
    this.filmDragPreview = preview
  }

  setFilmTimelineHeight(h: number): void {
    this.filmTimelineHeight = clampFilmTimelineHeight(h)
    this.timelineOpen = true
  }

  setFilmPxPerFrame(v: number): void {
    this.filmPxPerFrame = Math.min(Math.max(v, 0.4), 24)
    this.filmTrackAligned = true
  }

  alignFilmTrackToSource(width: number, sourceFrames: number, persist = false): void {
    if (this.filmTrackAligned || width < 8 || sourceFrames < 1) return
    this.filmPxPerFrame = Math.min(24, Math.max(0.4, width / sourceFrames))
    if (persist) this.filmTrackAligned = true
  }

  setFilmClock(mode: FilmClockMode): void {
    this.filmClock = mode
  }

  setFilmExportOpen(open: boolean): void {
    this.filmExportOpen = open
  }

  setSceneResume(
    resume: {
      frame: number
      cameraId: string | null
      selection: Selection | null
      followMode: boolean
      libraryOpen: boolean
      inspectorOpen: boolean
    } | null,
  ): void {
    this.sceneResume = resume
  }

  setPanelsOpen(library: boolean, inspector: boolean): void {
    this.libraryOpen = library
    this.inspectorOpen = inspector
  }

  mergePendingKeyframe(entry: PendingKeyframe): void {
    const idx = this.pendingKeyframes.findIndex((item) => item.nodeId === entry.nodeId)
    const prev = idx >= 0 ? this.pendingKeyframes[idx] : undefined
    const next: PendingKeyframe = {
      nodeId: entry.nodeId,
      frame: entry.frame,
      position: entry.position ?? prev?.position,
      rotation: entry.rotation ?? prev?.rotation,
      scale: entry.scale ?? prev?.scale,
      lookAt: entry.lookAt ?? prev?.lookAt,
      fov: entry.fov ?? prev?.fov,
    }
    if (idx < 0) {
      this.pendingKeyframes = [...this.pendingKeyframes, next]
      return
    }
    const copy = this.pendingKeyframes.slice()
    copy[idx] = next
    this.pendingKeyframes = copy
  }

  clearPendingKeyframes(): void {
    if (this.pendingKeyframes.length === 0) return
    this.pendingKeyframes = []
  }

}

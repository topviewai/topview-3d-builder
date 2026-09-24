// 导演草稿（biz/scene3d-director-document）类型定义
// 坐标系：右手 Y-up、单位米、旋转欧拉角度（度）。时间线帧域，相机曲线毫秒域。

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Transform {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export interface DraftNode {
  id: string
  type: 'camera' | 'character' | 'prop' | 'path' | 'group' | 'primitive'
  name: string
  visible: boolean
  locked: boolean
  transform: Transform
  metadata?: any
  parentId?: string // primitive → group
  children?: string[] // group → 子节点 id
  group?: {
    appearance: { color: string }
    kind: string
    label?: { showLabel: boolean; scale: number; yOffset: number }
    layout?: Record<string, any>
  }
  primitive?: {
    kind: string // three.js 几何体构造器名，如 BoxGeometry / CylinderGeometry / ConeGeometry
    parameters: Record<string, any>
    appearance?: { color: string }
    label?: { showLabel: boolean }
  }
  camera?: {
    projection: string
    fov: number // 垂直视角，度
    fovAxis: string
    near: number
    far: number
    isPrimary: boolean
    lookAt: Vec3
    /**
     * 看点绑到人物：求值时 lookAt = 人物位置 + offset（缺省胸口高度）。
     * 与 `subject.nodeId` 必须是同一个人；跟随只决定机位跟不跟着走。
     * 改 XYZ / 旋转会更新 offset，不再清成自由点。
     */
    lookAtTarget?: {
      nodeId: string
      offset?: Vec3
    }
    subject?: {
      nodeId: string
      distance: number
      offset: Vec3
      lookAtOffset: Vec3
      follow: boolean
      followRotation: boolean
      /**
       * 后设置的优先级高：绑定晚于已有运镜片段时为 true，跟随盖过运镜曲线；
       * 绑定之后又加了运镜，则置回 false，由运镜接管它覆盖的帧。
       * 缺省（旧草稿）按 true 处理。
       */
      overridesMotion?: boolean
    }
  }
  character?: {
    placeholder: boolean
    gender: string
    motionId: string | null
    appearance: { color: string }
    label: { showLabel: boolean; scale: number; yOffset: number }
    animation: {
      mode: string // 'pose' 等
      baseAction?: string
      posePresetId?: string
      speed?: number
      controlValues: Record<string, number>
      /** 坐 / 蹲 / 跪类姿势要下沉的骨架根偏移（米） */
      rootPositionOffset?: Vec3
      [k: string]: any
    }
  }
  prop?: { category: string; appearance?: { color: string }; label?: { showLabel: boolean } }
  path?: {
    /** 'draw'（拖拽绘制）/ 'click'（点击加点）= 用户轨迹；'transform-keyframes' = 关键帧派生 */
    source: string
    /** 'catmullRom' = 用户轨迹（centripetal Catmull-Rom）；'polyline' = 派生路径折线 */
    curve: string
    closed: boolean
    groundSnap: boolean
    /** 'arc-length' = 按弧长匀速（用户轨迹）；'time-ratio' = 按点上的 timeRatio（派生路径） */
    parameterization: string
    smoothing: number
    /** timeRatio 只有 parameterization='time-ratio' 的派生路径才带 */
    points: { id: string; position: Vec3; timeRatio?: number }[]
  }
}

export interface CurveKeyframe {
  id: string
  time: number // 毫秒
  value: number
  interpolation: 'linear' | 'bezier' // bezier 无手柄字段，仅标记
}

export interface BakedCurve {
  id: string
  group: 'position' | 'lookAt' | 'lens' | 'rotation'
  dataPath: string // camera.position / camera.lookAt / camera.lens.fov / camera.rollDeg
  arrayIndex: number // 0/1/2
  extrapolation: string // 'constant'
  keyframes: CurveKeyframe[]
}

export interface CameraMotionClip {
  id: string
  target: { type: string; nodeId: string }
  focusTarget?: { type: string }
  frameStart: number
  frameEnd: number
  trimStartMs: number
  trimEndMs: number
  playback: {
    version: number
    speed: number
    loop: boolean
    loopMode: string
    baseDurationFrames: number
  }
  motion: {
    id: string
    version: number
    presetId: string
    label: string // 中文名
    timeUnit: string
    durationMs: number
    metadata?: any
    source?: any
    warnings?: string[] | null // 官方无 warning 时整个字段省略
    curves: BakedCurve[] // 固定 7 条：position xyz + lookAt xyz + fov
  }
}

export interface MotionClip {
  id: string
  source: string
  sourceDuration: number // 源 FBX 秒数
  frameStart: number
  frameEnd: number
  target: { type: string; nodeId: string }
  playback: { version: number; speed: number; loop: boolean; loopMode: string }
  motion: {
    assetId: string
    name: string // 中文名
    source: string
    sourceRig: string // 'mixamorig'
    url: string
    inPlace: boolean
    loop: boolean
    speed: number
    time: number // 从源动作第几秒起播
  }
}

export interface PathMotionClip {
  id: string
  status: string
  locked: boolean
  lockedReason?: string
  source: string
  target: { type: string; nodeId: string }
  pathNodeId: string
  pathName: string
  pathLength: number
  pathStartPercent: number
  pathEndPercent: number
  direction: string // 'forward'
  facing: string // 'path-tangent'
  frameStart: number
  frameEnd: number
  playback: { version: number; speed: number; loop: boolean; loopMode: string; baseDurationFrames: number }
  derivedSource?: any
}

export interface TimelineData {
  version: number
  fps: number
  frameStart: number
  frameEnd: number
  usePreviewRange: boolean
  animation: {
    fcurves: any[]
    fcurvesRef?: any
    cameraMotionClips: CameraMotionClip[]
    motionTransitions: any[]
    motionClips: MotionClip[]
    pathMotionClips: PathMotionClip[]
  }
}

/** 成片中的一个剪辑实例。源范围为闭区间 [sourceFrameStart, sourceFrameEnd]，时长 end-start+1。 */
export interface EditSequenceClip {
  id: string
  cameraNodeId: string
  sourceFrameStart: number
  sourceFrameEnd: number
}

/** 单条成片序列。clips 数组顺序即成片顺序；同源段 / 同机位允许重复。 */
export interface EditSequence {
  id: string
  name?: string
  clips: EditSequenceClip[]
}

/** 剪辑领域数据。sequences 是共享同一场景源时间轴的平行成片版本。 */
export interface EditorialData {
  version: 1
  /** 重新打开草稿时默认编辑的序列；不表示主交付版本。 */
  activeSequenceId: string
  sequences: EditSequence[]
}

export interface MotionPathEntry {
  id: string
  path: string // 完整 S3 key，如 '3d-builder/library/motions/a3d_motion_x-1234.fbx'
}

export interface DraftContent {
  version: number
  aspectRatio: string
  activeShotCameraNodeId: string
  generate?: string
  scenePlan?: any
  settings?: any
  environment: {
    background: { mode: string; skyColor: string }
    display: {
      characterLabelsVisible: boolean
      groundVisible: boolean
      groundHeight: number
      groundOpacity: number
      [k: string]: any
    }
    sphere?: any
    transform?: Transform
  }
  asset: { motionPath: MotionPathEntry[] }
  nodes: DraftNode[]
  physicalConstraints: any[]
  timeline: TimelineData
  /** 剪辑编排。旧草稿可缺省。与 timeline（源世界时间）独立，禁止复用 cameraMotionClips。 */
  editorial?: EditorialData
}

export interface DirectorDocument {
  type: string
  /** wire 字段名，沿用持久化 JSON 的原始命名，改名会破坏既有草稿兼容 */
  pippitAssetId: string
  extra?: any
  content: DraftContent
}

export type NodeId = string
export type NodeContract = DraftNode
export type TimelineContract = TimelineData

/** 媒体引用：S3 key / 历史 URL / 资产 id。engine 与 host 共用，不进 host 层。 */
export interface MediaRef {
  kind: 'character' | 'prop' | 'motion'
  assetId?: string
  sourceUrl?: string
  sourcePath?: string
}

/** 契约层场景快照（wire）。运行时覆写挂在 evaluate 的 SceneContract 上。 */
export interface SceneContract {
  meta: { fps: number; frameStart: number; frameEnd: number }
  nodes: readonly DraftNode[]
  timeline: TimelineData
}

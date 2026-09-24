// 字段与 docs/draft-format.md / contract/types.ts 一一对应。
// 真实草稿常带额外字段，对象一律 passthrough。schema 显式标 DirectorDocument，
// 避免 z.infer 把嵌套 passthrough 展成超长类型，撑爆 tsup dts。
import { z } from 'zod'
import { hydrateSkyColor } from './skyColor'
import type { DirectorDocument } from './types'

const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
})

const nodeRefSchema = z.object({
  type: z.string(),
  nodeId: z.string(),
}).passthrough()

const playbackSchema = z.object({
  version: z.number(),
  speed: z.number(),
  loop: z.boolean(),
  loopMode: z.string(),
  baseDurationFrames: z.number().optional(),
}).passthrough()

const curveKeyframeSchema = z.object({
  id: z.string(),
  time: z.number(),
  value: z.number(),
  interpolation: z.enum(['linear', 'bezier']),
}).passthrough()

const bakedCurveSchema = z.object({
  id: z.string(),
  group: z.enum(['position', 'lookAt', 'lens', 'rotation']),
  dataPath: z.string(),
  arrayIndex: z.number(),
  extrapolation: z.string(),
  keyframes: z.array(curveKeyframeSchema),
}).passthrough()

const cameraMotionClipSchema = z.object({
  id: z.string(),
  target: nodeRefSchema,
  focusTarget: z.object({ type: z.string() }).passthrough().optional(),
  frameStart: z.number(),
  frameEnd: z.number(),
  trimStartMs: z.number(),
  trimEndMs: z.number(),
  playback: playbackSchema,
  motion: z.object({
    id: z.string(),
    version: z.number(),
    presetId: z.string(),
    label: z.string(),
    timeUnit: z.string(),
    durationMs: z.number(),
    metadata: z.unknown().optional(),
    source: z.unknown().optional(),
    warnings: z.array(z.string()).nullable().optional(),
    curves: z.array(bakedCurveSchema),
  }).passthrough(),
}).passthrough()

const motionClipSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceDuration: z.number(),
  frameStart: z.number(),
  frameEnd: z.number(),
  target: nodeRefSchema,
  playback: playbackSchema,
  motion: z.object({
    assetId: z.string(),
    name: z.string(),
    source: z.string(),
    sourceRig: z.string(),
    url: z.string(),
    inPlace: z.boolean(),
    loop: z.boolean(),
    speed: z.number(),
    time: z.number(),
  }).passthrough(),
}).passthrough()

const pathMotionClipSchema = z.object({
  id: z.string(),
  status: z.string(),
  locked: z.boolean(),
  lockedReason: z.string().optional(),
  source: z.string(),
  target: nodeRefSchema,
  pathNodeId: z.string(),
  pathName: z.string(),
  pathLength: z.number(),
  pathStartPercent: z.number(),
  pathEndPercent: z.number(),
  direction: z.string(),
  facing: z.string(),
  frameStart: z.number(),
  frameEnd: z.number(),
  playback: playbackSchema,
  derivedSource: z.unknown().optional(),
}).passthrough()

const editSequenceClipSchema = z.object({
  id: z.string().min(1),
  cameraNodeId: z.string().min(1),
  sourceFrameStart: z.number().int(),
  sourceFrameEnd: z.number().int(),
}).passthrough().refine(
  (clip) => clip.sourceFrameEnd >= clip.sourceFrameStart,
  { message: 'sourceFrameEnd must be >= sourceFrameStart', path: ['sourceFrameEnd'] },
)

const editSequenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().refine((name) => name.trim().length > 0, {
    message: 'name must not be blank',
  }).optional(),
  clips: z.array(editSequenceClipSchema),
}).passthrough()

const editorialSchema = z.object({
  version: z.literal(1),
  activeSequenceId: z.string().min(1),
  sequences: z.array(editSequenceSchema).min(1),
}).passthrough()

const timelineSchema = z.object({
  version: z.number(),
  fps: z.number(),
  frameStart: z.number(),
  frameEnd: z.number(),
  usePreviewRange: z.boolean(),
  animation: z.object({
    fcurves: z.array(z.unknown()),
    fcurvesRef: z.unknown().optional(),
    cameraMotionClips: z.array(cameraMotionClipSchema),
    motionTransitions: z.array(z.unknown()).optional(),
    motionClips: z.array(motionClipSchema),
    pathMotionClips: z.array(pathMotionClipSchema),
  }).passthrough(),
}).passthrough()

const draftNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['camera', 'character', 'prop', 'path', 'group', 'primitive']),
  name: z.string(),
  visible: z.boolean(),
  locked: z.boolean(),
  transform: transformSchema,
  metadata: z.unknown().optional(),
  parentId: z.string().optional(),
  children: z.array(z.string()).optional(),
  group: z.object({
    appearance: z.object({ color: z.string() }).passthrough(),
    kind: z.string(),
    label: z.object({
      showLabel: z.boolean(),
      scale: z.number(),
      yOffset: z.number(),
    }).passthrough().optional(),
    layout: z.record(z.unknown()).optional(),
  }).passthrough().optional(),
  primitive: z.object({
    kind: z.string(),
    parameters: z.record(z.unknown()),
    appearance: z.object({ color: z.string() }).passthrough().optional(),
    label: z.object({ showLabel: z.boolean() }).passthrough().optional(),
  }).passthrough().optional(),
  camera: z.object({
    projection: z.string(),
    fov: z.number(),
    fovAxis: z.string(),
    near: z.number(),
    far: z.number(),
    isPrimary: z.boolean(),
    lookAt: vec3Schema,
  }).passthrough().optional(),
  character: z.object({
    placeholder: z.boolean(),
    gender: z.string(),
    motionId: z.string().nullable().optional(),
    appearance: z.object({ color: z.string() }).passthrough(),
    label: z.object({
      showLabel: z.boolean(),
      scale: z.number(),
      yOffset: z.number(),
    }).passthrough(),
    animation: z.object({
      mode: z.string(),
      controlValues: z.record(z.number()),
    }).passthrough(),
  }).passthrough().optional(),
  prop: z.object({
    category: z.string(),
    appearance: z.object({ color: z.string() }).passthrough().optional(),
    label: z.object({ showLabel: z.boolean() }).passthrough().optional(),
  }).passthrough().optional(),
  path: z.object({
    source: z.string(),
    curve: z.string(),
    closed: z.boolean(),
    groundSnap: z.boolean(),
    parameterization: z.string(),
    smoothing: z.number(),
    points: z.array(z.object({
      id: z.string(),
      position: vec3Schema,
      timeRatio: z.number().optional(),
    }).passthrough()),
  }).passthrough().optional(),
}).passthrough()

const draftContentSchema = z.object({
  version: z.number(),
  aspectRatio: z.string(),
  activeShotCameraNodeId: z.string(),
  generate: z.string().optional(),
  scenePlan: z.unknown().optional(),
  settings: z.unknown().optional(),
  environment: z.object({
    background: z.object({
      mode: z.string(),
      skyColor: z.string(),
    }).passthrough(),
    display: z.object({
      characterLabelsVisible: z.boolean(),
      groundVisible: z.boolean(),
      groundHeight: z.number(),
      groundOpacity: z.number(),
    }).passthrough(),
    sphere: z.unknown().optional(),
    transform: transformSchema.optional(),
  }).passthrough(),
  asset: z.object({
    motionPath: z.array(z.object({
      id: z.string(),
      path: z.string(),
    }).passthrough()),
  }).passthrough(),
  nodes: z.array(draftNodeSchema),
  physicalConstraints: z.array(z.unknown()),
  timeline: timelineSchema,
  editorial: editorialSchema.optional(),
}).passthrough()

export const directorDocumentSchema: z.ZodType<DirectorDocument> = z.object({
  type: z.string(),
  pippitAssetId: z.string(),
  extra: z.unknown().optional(),
  content: draftContentSchema,
}).passthrough() as z.ZodType<DirectorDocument>

export function parseDirectorDocument(json: unknown): DirectorDocument {
  return hydrateSkyColor(directorDocumentSchema.parse(json))
}

const fcurveHandleSchema = z.object({
  x: z.number(),
  y: z.number(),
}).passthrough()

const compactKeyframeSchema = z.array(
  z.union([z.number(), z.string(), fcurveHandleSchema, z.null()]),
).min(3)

const compactCurveSchema = z.object({
  id: z.string(),
  t: z.union([z.tuple([z.string(), z.string()]), z.string()]),
  p: z.string(),
  i: z.number().optional(),
  k: z.array(compactKeyframeSchema),
}).passthrough()

export const fcurvesCompactV1Schema = z.object({
  version: z.literal(1),
  encoding: z.literal('compact-v1'),
  fcurves: z.array(compactCurveSchema),
}).passthrough()

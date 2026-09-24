import type { ReactElement } from 'react'
import type { Vec3 } from '../../contract/types'
import {
  CAMERA_MOTIONS,
  CAMERA_PRESETS,
  type CameraPreset,
} from '../../data/cameraLibrary'
import type { CameraPoseSample } from '../../evaluate/camera/bakeMotion'
import { previewCameraMotionPoses } from '../../evaluate/camera/previewLibraryPoses'

const BODY = '#d4d4d4'
const BODY_DEEP = '#8a8a8a'
const CAM = '#e8e8e8'
const CAM_DEEP = '#8a8a8a'
const CAM_HI = 'rgba(255,255,255,0.62)'
const CONE_EDGE = 'rgba(216,216,216,0.55)'
const SHADOW = 'rgba(0,0,0,0.42)'

function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

function vLen(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

function vNorm(a: Vec3): Vec3 {
  const len = vLen(a)
  return len > 1e-9 ? vScale(a, 1 / len) : { x: 0, y: 0, z: 0 }
}

function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function iso(p: Vec3): { x: number; y: number } {
  return {
    x: (p.x - p.z) * 0.866,
    y: -p.y * 0.92 + (p.x + p.z) * 0.35,
  }
}

function cameraRight(position: Vec3, lookAt: Vec3): Vec3 {
  const forward = vNorm(vSub(lookAt, position))
  const right = vNorm(vCross(forward, { x: 0, y: 1, z: 0 }))
  return vLen(right) < 1e-6 ? { x: 1, y: 0, z: 0 } : right
}

function frustumEnds(position: Vec3, lookAt: Vec3, fov: number): [Vec3, Vec3] {
  const dist = Math.max(vLen(vSub(lookAt, position)), 0.001)
  const half = Math.tan(((fov * Math.PI) / 180) / 2) * dist
  const right = cameraRight(position, lookAt)
  return [vAdd(lookAt, vScale(right, -half)), vAdd(lookAt, vScale(right, half))]
}

function fitProject(points: Vec3[], width: number, height: number, pad: number, minSpan = 0) {
  const mapped = points.map(iso)
  const xs = mapped.map((p) => p.x)
  const ys = mapped.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, minSpan, 0.8)
  const spanY = Math.max(maxY - minY, minSpan, 0.8)
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  return (p: Vec3) => {
    const s = iso(p)
    return {
      x: (s.x - midX) * scale + width / 2,
      y: (s.y - midY) * scale + height / 2,
    }
  }
}

function downsample(poses: CameraPoseSample[], max = 12): CameraPoseSample[] {
  if (poses.length <= max) return poses
  const last = poses.length - 1
  const step = last / (max - 1)
  const out: CameraPoseSample[] = []
  for (let i = 0; i < max; i++) out.push(poses[Math.round(i * step)])
  return out
}

function previewDurationSec(durationMs: number): number {
  return Math.min(3.2, Math.max(2, durationMs / 1000))
}

function coneD(
  cam: { x: number; y: number },
  left: { x: number; y: number },
  right: { x: number; y: number },
): string {
  return `M${cam.x.toFixed(2)} ${cam.y.toFixed(2)}L${left.x.toFixed(2)} ${left.y.toFixed(2)}L${right.x.toFixed(2)} ${right.y.toFixed(2)}Z`
}

function ConeShape({
  d,
  fill,
  className,
  children,
}: {
  d: string
  fill: string
  className?: string
  children?: ReactElement
}): ReactElement {
  return (
    <path className={className} d={d} fill={fill} stroke={CONE_EDGE} strokeWidth="0.85" strokeLinejoin="round">
      {children}
    </path>
  )
}

function PersonMark({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g className="t3d-cam-person" transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="10.2" rx="6.6" ry="1.9" fill={SHADOW} />
      <path d="M-3.1 9.4v-5.2c0-.8.55-1.35 1.25-1.35h3.7c.7 0 1.25.55 1.25 1.35v5.2" fill={BODY_DEEP} />
      <path d="M-4.05 -1.35c.3-2.55 1.85-4.1 4.05-4.1s3.75 1.55 4.05 4.1L4.6 5.6c0 .8-.65 1.4-1.4 1.4h-6.4c-.75 0-1.4-.6-1.4-1.4Z" fill={BODY} />
      <circle cx="0" cy="-7.2" r="2.85" fill={BODY} />
      <circle cx="0.7" cy="-7.75" r="0.85" fill="rgba(255,255,255,0.28)" />
    </g>
  )
}

function CamMark({
  x,
  y,
  lookX,
  lookY,
  roll = 0,
  animated,
}: {
  x: number
  y: number
  lookX: number
  lookY: number
  roll?: number
  animated?: boolean
}): ReactElement {
  const rot = (Math.atan2(lookY - y, lookX - x) * 180) / Math.PI + roll
  return (
    <g
      className={animated ? 't3d-cam-live' : undefined}
      transform={`translate(${x} ${y}) rotate(${rot})`}
    >
      <ellipse cx="0" cy="5" rx="5.2" ry="1.35" fill={SHADOW} />
      <rect x="-6.6" y="-3.8" width="9.2" height="7.6" rx="1.35" fill={CAM} />
      <rect x="-5.7" y="-2.95" width="3.8" height="1.35" rx="0.45" fill={CAM_HI} />
      <path d="M2.6 -1.9 7.5 -3.7v7.4L2.6 1.9Z" fill={CAM_DEEP} />
      <circle cx="-1.35" cy="0.2" r="1.25" fill={CAM_DEEP} />
    </g>
  )
}

function Ground({
  project,
}: {
  project: (p: Vec3) => { x: number; y: number }
}): ReactElement {
  const floor = [
    project({ x: -0.85, y: 0, z: -0.85 }),
    project({ x: 0.85, y: 0, z: -0.85 }),
    project({ x: 0.85, y: 0, z: 0.85 }),
    project({ x: -0.85, y: 0, z: 0.85 }),
  ]
  const axisX = [project({ x: -0.85, y: 0, z: 0 }), project({ x: 0.85, y: 0, z: 0 })]
  const axisZ = [project({ x: 0, y: 0, z: -0.85 }), project({ x: 0, y: 0, z: 0.85 })]
  return (
    <g className="t3d-cam-ground">
      <path
        d={`M${floor.map((p, i) => `${i === 0 ? '' : 'L'}${p.x} ${p.y}`).join('')}Z`}
        fill="rgba(255,255,255,0.045)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="0.7"
      />
      <path
        d={`M${axisX[0].x} ${axisX[0].y}L${axisX[1].x} ${axisX[1].y}M${axisZ[0].x} ${axisZ[0].y}L${axisZ[1].x} ${axisZ[1].y}`}
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="0.6"
      />
    </g>
  )
}

function DiagramDefs({ uid }: { uid: string }): ReactElement {
  return (
    <defs>
      <radialGradient id={`${uid}-cone`} cx="18%" cy="30%" r="78%">
        <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.58" />
        <stop offset="55%" stopColor="#e8e8e8" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.05" />
      </radialGradient>
      <linearGradient id={`${uid}-path`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#f5f5f5" stopOpacity="0.18" />
        <stop offset="55%" stopColor="#f5f5f5" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#d0d0d0" stopOpacity="0.95" />
      </linearGradient>
      <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.15" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

function motionKeyframes(
  uid: string,
  frames: Array<{ cam: { x: number; y: number }; look: { x: number; y: number }; roll: number }>,
): string {
  const last = frames.length - 1
  const cam = frames
    .map((frame, i) => {
      const pct = last === 0 ? 0 : (i / last) * 100
      const rot = (Math.atan2(frame.look.y - frame.cam.y, frame.look.x - frame.cam.x) * 180) / Math.PI + frame.roll
      return `${pct.toFixed(2)}%{transform:translate(${frame.cam.x.toFixed(2)}px,${frame.cam.y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)}`
    })
    .join('')
  return `@keyframes t3d-cam-${uid}{${cam}}`
}

function Diagram({
  uid,
  width,
  height,
  points,
  start,
  end,
  path,
  roll = 0,
  animateMs,
  minSpan = 0,
}: {
  uid: string
  width: number
  height: number
  points: Vec3[]
  start: CameraPoseSample
  end: CameraPoseSample
  path?: CameraPoseSample[]
  roll?: number
  animateMs?: number
  minSpan?: number
}): ReactElement {
  const project = fitProject(points, width, height, 15, minSpan)
  const origin = project({ x: 0, y: 0, z: 0 })
  const startCam = project(start.position)
  const startLook = project(start.lookAt)
  const endCam = project(end.position)
  const endLook = project(end.lookAt)
  const [sL, sR] = frustumEnds(start.position, start.lookAt, start.fov).map(project)
  const [eL, eR] = frustumEnds(end.position, end.lookAt, end.fov).map(project)
  const frames = (path && path.length > 1 ? path : [end]).map((pose) => {
    const cam = project(pose.position)
    const look = project(pose.lookAt)
    const [left, right] = frustumEnds(pose.position, pose.lookAt, pose.fov).map(project)
    return {
      cam,
      look,
      cone: coneD(cam, left, right),
      roll: pose.rollDeg ?? roll,
    }
  })
  const drawn = frames.map((frame) => frame.cam)
  const pathD = drawn.length > 1 ? drawn.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') : ''
  const moved = vLen(vSub(end.position, start.position)) > 0.08
  const lookChanged = vLen(vSub(end.lookAt, start.lookAt)) > 0.08
  const fovChanged = Math.abs(end.fov - start.fov) > 0.5
  const showTravel = moved || lookChanged || fovChanged
  const live = Boolean(animateMs && showTravel && frames.length > 1)
  const dur = previewDurationSec(animateMs ?? 2400)
  const first = frames[0]
  const firstRot =
    (Math.atan2(first.look.y - first.cam.y, first.look.x - first.cam.x) * 180) / Math.PI + first.roll

  return (
    <svg
      className={live ? 't3d-leftrail-camera-thumb t3d-leftrail-camera-thumb-live' : 't3d-leftrail-camera-thumb'}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
    >
      <DiagramDefs uid={uid} />
      {live ? (
        <style>{`${motionKeyframes(uid, frames)}.t3d-cam-${uid}{animation:t3d-cam-${uid} ${dur}s linear infinite both;transform-box:view-box;transform-origin:0 0}`}</style>
      ) : null}
      <Ground project={project} />
      <PersonMark x={origin.x} y={origin.y} />
      <g className="t3d-cam-static">
        {showTravel ? <ConeShape d={coneD(startCam, sL, sR)} fill="rgba(197,204,212,0.14)" /> : null}
        <ConeShape d={coneD(endCam, eL, eR)} fill={`url(#${uid}-cone)`} />
        {moved && pathD ? (
          <path
            d={pathD}
            stroke={`url(#${uid}-path)`}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${uid}-glow)`}
          />
        ) : null}
        {moved ? <CamMark x={startCam.x} y={startCam.y} lookX={startLook.x} lookY={startLook.y} roll={roll} /> : null}
        <CamMark x={endCam.x} y={endCam.y} lookX={endLook.x} lookY={endLook.y} roll={end.rollDeg ?? roll} />
      </g>
      {live ? (
        <g className="t3d-cam-live-layer">
          <ConeShape className="t3d-cone-anim" d={first.cone} fill={`url(#${uid}-cone)`}>
            <animate
              attributeName="d"
              dur={`${dur}s`}
              repeatCount="indefinite"
              calcMode="linear"
              values={frames.map((frame) => frame.cone).join(';')}
            />
          </ConeShape>
          {moved && pathD ? (
            <path
              className="t3d-cam-path"
              d={pathD}
              stroke={`url(#${uid}-path)`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${uid}-glow)`}
            />
          ) : null}
          <g
            className={`t3d-cam-anim t3d-cam-${uid}`}
            style={{ transform: `translate(${first.cam.x}px, ${first.cam.y}px) rotate(${firstRot}deg)` }}
          >
            <CamMark x={0} y={0} lookX={6} lookY={0} animated />
          </g>
        </g>
      ) : null}
    </svg>
  )
}

function presetPose(preset: CameraPreset): CameraPoseSample {
  return {
    timeMs: 0,
    position: preset.position,
    lookAt: preset.lookAt,
    fov: preset.fov,
    rollDeg: preset.rotation.z,
  }
}

export function CameraPresetThumb({ id, instance }: { id: string; instance?: string }): ReactElement | null {
  const preset = CAMERA_PRESETS.find((item) => item.id === id)
  if (!preset) return null
  const pose = presetPose(preset)
  return (
    <Diagram
      uid={instance ? `p-${id}-${instance}` : `p-${id}`}
      width={80}
      height={80}
      points={[pose.position, pose.lookAt, { x: 0, y: 0, z: 0 }]}
      start={pose}
      end={pose}
      roll={preset.rotation.z}
      minSpan={6.8}
    />
  )
}

export function CameraMotionThumb({ id, instance }: { id: string; instance?: string }): ReactElement | null {
  const preset = CAMERA_MOTIONS.find((item) => item.id === id)
  if (!preset) return null
  const poses = previewCameraMotionPoses(preset)
  if (!poses || poses.length === 0) return null
  const samples = downsample(poses)
  const start = samples[0]
  const end = samples[samples.length - 1]
  return (
    <Diagram
      uid={instance ? `m-${id}-${instance}` : `m-${id}`}
      width={112}
      height={70}
      points={[
        start.position,
        start.lookAt,
        end.position,
        end.lookAt,
        { x: 0, y: 0, z: 0 },
        ...samples.map((p) => p.position),
        ...samples.map((p) => p.lookAt),
      ]}
      start={start}
      end={end}
      path={samples}
      animateMs={preset.defaultConfig.durationMs}
      minSpan={5.2}
    />
  )
}

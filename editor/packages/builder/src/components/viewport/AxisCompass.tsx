const AXIS_COLOR_X = '#e5484d'
const AXIS_COLOR_Y = '#30c84d'
const AXIS_COLOR_Z = '#4d7cff'

const COMPASS_SIZE = 72
const COMPASS_CENTER = COMPASS_SIZE / 2
const AXIS_LENGTH = 22
const LABEL_OFFSET = 8

export interface AxisCompassRotation {
  x: number
  y: number
  z: number
}

interface AxisProjection {
  key: 'x' | 'y' | 'z'
  label: string
  color: string
  sx: number
  sy: number
  depth: number
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

/** 复刻 three.js YXZ 旋转：世界轴投到相机视图空间（与主相机 1:1）。 */
function projectAxes(rotation: AxisCompassRotation): AxisProjection[] {
  const x = degToRad(rotation.x)
  const y = degToRad(rotation.y)
  const z = degToRad(rotation.z)

  const a = Math.cos(x)
  const b = Math.sin(x)
  const c = Math.cos(y)
  const d = Math.sin(y)
  const e = Math.cos(z)
  const f = Math.sin(z)

  const ce = c * e
  const cf = c * f
  const de = d * e
  const df = d * f

  const te0 = ce + df * b
  const te1 = a * f
  const te2 = cf * b - de
  const te4 = de * b - cf
  const te5 = a * e
  const te6 = df + ce * b
  const te8 = a * d
  const te9 = -b
  const te10 = a * c

  const axes: AxisProjection[] = [
    { key: 'x', label: 'X', color: AXIS_COLOR_X, sx: te0, sy: -te4, depth: te8 },
    { key: 'y', label: 'Y', color: AXIS_COLOR_Y, sx: te1, sy: -te5, depth: te9 },
    { key: 'z', label: 'Z', color: AXIS_COLOR_Z, sx: te2, sy: -te6, depth: te10 },
  ]
  return axes.sort((p, q) => p.depth - q.depth)
}

export function AxisCompass({ rotation }: { rotation: AxisCompassRotation }) {
  const axes = projectAxes(rotation)

  return (
    <div className="t3d-axis-compass" aria-hidden>
      <svg
        width={COMPASS_SIZE}
        height={COMPASS_SIZE}
        viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
      >
        {axes.map((axis) => {
          const plusX = COMPASS_CENTER + axis.sx * AXIS_LENGTH
          const plusY = COMPASS_CENTER + axis.sy * AXIS_LENGTH
          const minusX = COMPASS_CENTER - axis.sx * AXIS_LENGTH
          const minusY = COMPASS_CENTER - axis.sy * AXIS_LENGTH
          const labelX = COMPASS_CENTER + axis.sx * (AXIS_LENGTH + LABEL_OFFSET)
          const labelY = COMPASS_CENTER + axis.sy * (AXIS_LENGTH + LABEL_OFFSET)
          const opacity = 0.45 + 0.55 * ((axis.depth + 1) / 2)
          const plusNear = axis.depth >= 0
          return (
            <g key={axis.key} opacity={opacity}>
              <line
                x1={minusX}
                y1={minusY}
                x2={plusX}
                y2={plusY}
                stroke={axis.color}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle
                cx={plusNear ? minusX : plusX}
                cy={plusNear ? minusY : plusY}
                r={3}
                fill={axis.color}
              />
              <circle
                cx={plusNear ? plusX : minusX}
                cy={plusNear ? plusY : minusY}
                r={4}
                fill={axis.color}
              />
              <text
                x={labelX}
                y={labelY}
                fill={axis.color}
                fontSize={10}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {axis.label}
              </text>
            </g>
          )
        })}
        <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={2.5} fill="rgba(255,255,255,0.85)" />
      </svg>
    </div>
  )
}

export function ResetViewIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.2 8a4.8 4.8 0 1 0 1.15-3.12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2.4 2.7v2.9h2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

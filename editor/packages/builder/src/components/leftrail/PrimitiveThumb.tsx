import { useId, type ReactElement, type ReactNode } from 'react'

function IsoSvg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg className="t3d-leftrail-primitive" viewBox="0 0 80 80" fill="none" aria-hidden>
      {children}
    </svg>
  )
}

function IsoBox(): ReactElement {
  return (
    <IsoSvg>
      <path d="M40 16 64 28 40 40 16 28Z" fill="#d5d5d5" />
      <path d="M16 28 40 40v22L16 50Z" fill="#8b8b8b" />
      <path d="M40 40 64 28v22L40 62Z" fill="#5d5d5d" />
    </IsoSvg>
  )
}

function IsoSphere(): ReactElement {
  const gradientId = useId()
  return (
    <IsoSvg>
      <defs>
        <radialGradient id={gradientId} cx="34%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f2f2f2" />
          <stop offset="55%" stopColor="#9a9a9a" />
          <stop offset="100%" stopColor="#4d4d4d" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="22" fill={`url(#${gradientId})`} />
    </IsoSvg>
  )
}

function IsoCylinder(): ReactElement {
  const gradientId = useId()
  return (
    <IsoSvg>
      <defs>
        <linearGradient id={gradientId} x1="24" y1="40" x2="56" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b6b6b6" />
          <stop offset="0.3" stopColor="#d5d5d5" />
          <stop offset="1" stopColor="#626262" />
        </linearGradient>
      </defs>
      <path d="M24 24v32c0 3.3 7.2 6 16 6s16-2.7 16-6V24" fill={`url(#${gradientId})`} />
      <ellipse cx="40" cy="24" rx="16" ry="6" fill="#d5d5d5" />
    </IsoSvg>
  )
}

function IsoCone(): ReactElement {
  const gradientId = useId()
  return (
    <IsoSvg>
      <defs>
        <linearGradient id={gradientId} x1="19" y1="40" x2="61" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#969696" />
          <stop offset="0.32" stopColor="#e1e1e1" />
          <stop offset="0.65" stopColor="#b0b0b0" />
          <stop offset="1" stopColor="#555555" />
        </linearGradient>
      </defs>
      <path d="M40 14 61 56C61 65.3 19 65.3 19 56Z" fill={`url(#${gradientId})`} />
    </IsoSvg>
  )
}

function IsoPlane(): ReactElement {
  return (
    <IsoSvg>
      <path d="M10 40 40 23 70 40 40 57Z" fill="#bdbdbd" stroke="#dedede" strokeWidth="0.8" strokeLinejoin="round" />
    </IsoSvg>
  )
}

export function PrimitiveThumb({ kind }: { kind: string }): ReactElement {
  if (kind === 'SphereGeometry') return <IsoSphere />
  if (kind === 'CylinderGeometry') return <IsoCylinder />
  if (kind === 'ConeGeometry') return <IsoCone />
  if (kind === 'PlaneGeometry') return <IsoPlane />
  return <IsoBox />
}

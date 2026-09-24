import type { ReactElement } from 'react'

export function DirectorStageIcon({
  className,
  size = 18,
}: {
  className?: string
  size?: number
}): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="1.2"
        d="M4.5,5.5L13,7.8 M18.9,4.2v8.9L13,16.8l-8.5-2.2V5.5l6.2-3.5L18.9,4.2z M13,7.8v9 M13,7.8l5.9-3.6"
      />
      <path
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M21.1,10.8c1,1,1.6,2.2,1.6,3.4c0,3.7-4.9,6.6-11,6.6c-6.1,0-11-3-11-6.6c0-1.3,0.6-2.4,1.6-3.4"
      />
    </svg>
  )
}

import type { ReactElement, ReactNode } from 'react'

function Svg({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      {children}
    </svg>
  )
}

export function IconUndo({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 9h10a5 5 0 0 1 0 10h-4" />
      <path d="M8 5 4 9l4 4" />
    </Svg>
  )
}

export function IconRedo({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M20 9H10a5 5 0 0 0 0 10h4" />
      <path d="m16 5 4 4-4 4" />
    </Svg>
  )
}

export function IconFit({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3" />
      <path d="M8 12h8" />
    </Svg>
  )
}

/** 裁剪手柄上的方向箭头：告诉用户这一端可以往外拖。 */
export function IconTrimLeft({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 8 16" width="8" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.2 4.5 2.4 8l2.8 3.5" />
    </svg>
  )
}

export function IconTrimRight({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 8 16" width="8" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.8 4.5 5.6 8l-2.8 3.5" />
    </svg>
  )
}

import type { ReactElement, ReactNode } from 'react'

function Svg({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      {children}
    </svg>
  )
}

export function IconObject({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
      <path d="M12 20V11M4 7.5 12 11l8-3.5" />
    </Svg>
  )
}

export function IconCharacter({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19c1.4-3.2 3.8-5 7-5s5.6 1.8 7 5" />
    </Svg>
  )
}

export function IconProp({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <rect x="5" y="9" width="12" height="10" rx="1.5" />
      <path d="M9 9V7.6A3 3 0 0 1 15 7.6V9" />
      <path d="M18 4.2 18.7 6 20.5 6.7 18.7 7.4 18 9.2 17.3 7.4 15.5 6.7 17.3 6Z" />
    </Svg>
  )
}

export function IconCamera({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </Svg>
  )
}

export function IconMotion({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="14" cy="5.5" r="2" />
      <path d="M10 21.5 12.2 14l-2.4-2.2L6.4 14" />
      <path d="M12.2 14 14 12.2l3.2 2.2 1.6 5.2" />
      <path d="M9.6 10.2 12.2 8.4 15.6 10" />
    </Svg>
  )
}

export function IconCameraMotion({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4.5" width="10.5" height="8" rx="1.4" />
      <circle cx="8" cy="8.5" r="2" />
      <path d="M13.5 6.4 20.2 5v7.2L13.5 10.9" />
      <path d="M3 17.9C5.5 16.9 7.4 16.4 9 16.7c2.2.4 4.2 1.9 6.2 3 2 .9 4.2.8 7.3-.3" />
    </svg>
  )
}

export function IconScene({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 18 12 6l8 12H4Z" />
    </Svg>
  )
}

export function IconSearch({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </Svg>
  )
}

export function IconEye({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.2" />
    </Svg>
  )
}

export function IconEyeOff({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 5.5 19.5 21" />
      <path d="M9.2 8.3A7.5 7.5 0 0 1 12 8c5.5 0 9 6 9 6a16 16 0 0 1-3.3 3.7" />
      <path d="M6.2 10.4A15 15 0 0 0 3 14s3.5 6 9 6c1.1 0 2.2-.2 3.1-.6" />
    </Svg>
  )
}

export function IconLock({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <rect x="6" y="11" width="12" height="9" rx="1.5" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />
    </Svg>
  )
}

export function IconUnlock({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <rect x="6" y="11" width="12" height="9" rx="1.5" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 6.4-1.9" />
    </Svg>
  )
}

export function IconCrosshair({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2" />
    </Svg>
  )
}

export function IconLocate({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2" />
    </Svg>
  )
}

export function IconDownload({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M12 4v10" />
      <path d="M8 10.5 12 15l4-4.5" />
      <path d="M5 18h14" />
    </Svg>
  )
}

export function IconChevron({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
      <path d="M5.8 3.2 10.6 8 5.8 12.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPointer({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M4 4l6.4 15.4 2.3-6.7 6.7-2.3L4 4Z" />
      <path d="M13 13l5 5" />
    </Svg>
  )
}

export function IconRotate({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M8.2 5.4A7 7 0 1 1 5 8.8" />
      <path d="M8.4 2.2 8.1 6.2 11.8 7.6" />
    </Svg>
  )
}

export function IconScale({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M20 4 10 14M20 8.5V4h-4.5M14 14H10v-4" />
      <path d="M19 11v3.2A3.8 3.8 0 0 1 15.2 18H8.8A3.8 3.8 0 0 1 5 14.2V7.8A3.8 3.8 0 0 1 8.8 4H12" />
    </Svg>
  )
}

export function IconTimeline({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M927.232 355.84H445.44V258.9696h17.8688c11.776 0 16.896-4.5568 16.896-16.8448V67.9936c0-11.776-4.608-16.7936-16.896-16.7936H366.08c-11.776 0-16.896 4.5056-16.896 16.7936V242.176c0 11.776 4.608 16.8448 16.896 16.8448h12.8v96.768l-286.208 0.0512c-17.92 0-32.256 14.336-32.256 32.256v383.488c0 17.92 14.336 31.744 32.256 31.744l286.208 0.0512v135.3728c0 5.632 0.2048 11.264 1.9968 16.5888q7.4752 22.6304 33.792 22.6816c20.48 0 30.72-18.5344 30.72-30.8224v-143.8208l482.304-0.0512c17.92 0 31.744-14.336 31.744-31.744V388.096c0-17.92-14.336-32.256-32.256-32.256zM278.016 739.328v-105.472c0-11.776-9.728-22.016-22.016-22.016s-22.016 9.728-22.016 22.016v105.472H124.416V419.84H378.88v319.5392l-100.864-0.0512z m617.472 0h-138.24v-105.472c0-11.776-9.728-22.016-22.016-22.016s-22.016 9.728-22.016 22.016v105.472h-115.2v-105.472c0-11.776-9.728-22.016-22.016-22.016s-22.016 9.728-22.016 22.016v105.472l-108.544 0.0512V419.84l450.048 0.0512v319.488z" />
    </svg>
  )
}

export function IconPath({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <circle cx="6" cy="17" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M8 17c3.6 0 2.7-5.5 6.4-5.5 2.2 0 2.6-2.2 2.6-3.6" />
    </Svg>
  )
}

export function IconToStart({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M5 6v12" />
      <path d="M19 6 11 12l8 6" />
    </Svg>
  )
}

export function IconToEnd({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M19 6v12" />
      <path d="M5 6l8 6-8 6" />
    </Svg>
  )
}

export function IconPrevKey({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M14 6 8 12l6 6" />
      <path d="M18 8.5 14.5 12 18 15.5" />
    </Svg>
  )
}

export function IconNextKey({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M10 6l6 6-6 6" />
      <path d="M6 8.5 9.5 12 6 15.5" />
    </Svg>
  )
}

export function IconPrevFrame({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M15 6 9 12l6 6" />
    </Svg>
  )
}

export function IconNextFrame({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  )
}

export function IconPlay({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M8 6.5v11L18 12 8 6.5Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconAutoKeyframe({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 3.6 19.2 12 12 20.4 4.8 12 12 3.6Z" />
      <circle cx="18.2" cy="5.8" r="2.2" />
    </svg>
  )
}

export function IconSnapMagnet({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M860.608 568.128V162.112q0-14.144-9.984-24.128T826.496 128h-147.648q-14.08 0-24.128 9.984-9.984 9.984-9.984 24.128V568.128l-0.128 6.656q-2.432 61.312-47.232 103.488-44.8 42.112-106.368 40.768-61.44-1.28-104.448-45.376-42.88-44.032-42.752-105.536V162.112q0-14.144-9.984-24.128T309.76 128H162.112q-14.144 0-24.128 9.984T128 162.112V568.192l0.128 9.408q3.776 148.608 110.272 252.608Q345.152 934.4 494.272 934.4q74.56 0 142.592-28.8 65.728-27.776 116.48-78.464 50.624-50.688 78.464-116.48 28.8-68.032 28.8-142.528zM196.16 238.72v-42.56h79.488v42.56H196.16z m516.736 0v-42.56h79.552v42.56h-79.552z m0 68.16h79.552v261.248l-0.128 8.576q-3.392 120.576-90.048 204.992-86.784 84.48-208 84.48-123.52 0-210.816-87.232-87.296-87.36-87.296-210.816V306.88h79.488v261.312l0.128 7.616q3.072 89.408 68.032 151.04 64.896 61.568 154.304 60.032 89.472-1.6 152.192-65.472 62.72-63.808 62.592-153.28V306.88z" />
    </svg>
  )
}

export function IconTrash({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

export function IconPause({ className }: { className?: string }): ReactElement {
  return (
    <Svg className={className}>
      <path d="M8 6h2.4v12H8zM13.6 6H16v12h-2.4z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconFullscreen({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 4.5h4.5V9" />
      <path d="M19.5 15v4.5H15" />
      <path d="M9 19.5H4.5V15" />
      <path d="M4.5 9V4.5H9" />
    </svg>
  )
}

export function IconExitFullscreen({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 4.5V9h4.5" />
      <path d="M9 4.5V9H4.5" />
      <path d="M9 19.5V15H4.5" />
      <path d="M15 19.5V15h4.5" />
    </svg>
  )
}

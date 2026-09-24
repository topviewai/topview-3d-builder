import { createContext, useContext, useEffect, useState, type ReactNode, type Ref } from 'react'
import { useDirector, useOverlayClose } from '../../bridge/DirectorContext'
import { useT, useLocale } from '../../locale'
import { cx } from '../common/cx'

const EXIT_MS = 280
const LOAD_FAILED_PREFIX = '加载失败'

const PortalRootContext = createContext<HTMLElement | null>(null)

export function StudioShell({
  children,
  rootRef,
}: {
  children: ReactNode
  rootRef: Ref<HTMLDivElement>
}) {
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)
  const locale = useLocale()
  const { useStore } = useDirector()
  const ready = useStore((s) => s.ready)
  const viewportFullscreen = useStore((s) => s.viewportFullscreen)
  const writeLocked = useStore((s) => s.writeLocked)

  return (
    <PortalRootContext.Provider value={portalEl}>
      <div
        className={cx(
          't3d-root',
          !ready && 't3d-root-booting',
          viewportFullscreen && 'is-viewport-fullscreen',
          writeLocked && 'is-write-locked',
        )}
        ref={rootRef}
        lang={locale}
        tabIndex={-1}
        aria-busy={!ready}
      >
        {children}
        <DraftLoadOverlay />
        <CameraAimToast />
        <CameraMotionDragToast />
        <div className="t3d-portal-root" ref={setPortalEl} />
      </div>
    </PortalRootContext.Provider>
  )
}

export function usePortalRoot(): HTMLElement | null {
  return useContext(PortalRootContext)
}

function CameraAimToast() {
  const { useStore } = useDirector()
  const t = useT()
  const version = useStore((s) => s.cameraAimReleaseVersion)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(version > 0)
    if (!version) return
    const timer = window.setTimeout(() => setVisible(false), 3500)
    return () => window.clearTimeout(timer)
  }, [version])
  return visible ? <div className="t3d-camera-aim-toast" role="status" aria-live="polite">{t('library.lookAtReleased')}</div> : null
}

function CameraMotionDragToast() {
  const { useStore } = useDirector()
  const t = useT()
  const version = useStore((s) => s.cameraMotionDragNoticeVersion)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(version > 0)
    if (!version) return
    const timer = window.setTimeout(() => setVisible(false), 3500)
    return () => window.clearTimeout(timer)
  }, [version])
  return visible ? (
    <div className="t3d-camera-motion-toast" role="status" aria-live="polite">{t('library.cameraMotionDragBlocked')}</div>
  ) : null
}

function BootVisual({ failed }: { failed: boolean }) {
  if (failed) return null
  return (
    <div className="t3d-boot-progress" aria-hidden="true">
      <span className="t3d-boot-progress-bar" />
    </div>
  )
}

export function StudioBootScreen({
  failed = false,
  exiting = false,
  onClose,
  message,
}: {
  failed?: boolean
  exiting?: boolean
  onClose?: () => void
  /** 宿主侧失败原因（无权限 / 不存在等），缺省回落包内通用文案 */
  message?: string
}) {
  const t = useT()

  return (
    <div
      className={exiting ? 't3d-boot t3d-boot-exit' : 't3d-boot'}
      role="status"
      aria-live="polite"
      aria-busy={!failed && !exiting}
    >
      {onClose ? (
        <button type="button" className="t3d-boot-close" onClick={onClose}>
          {t('close.exit')}
        </button>
      ) : null}
      <BootVisual failed={failed} />
      <p className={failed ? 't3d-boot-title t3d-boot-title-error' : 't3d-boot-title'}>
        {failed ? message ?? t('load.failed') : 'opening'}
      </p>
    </div>
  )
}

function DraftLoadOverlay() {
  const { useStore } = useDirector()
  const close = useOverlayClose()
  const ready = useStore((s) => s.ready)
  const loadStatus = useStore((s) => s.loadStatus)
  const [phase, setPhase] = useState<'show' | 'exit' | 'gone'>(ready ? 'gone' : 'show')

  useEffect(() => {
    if (!ready) {
      setPhase('show')
      return
    }
    setPhase((current) => (current === 'gone' ? 'gone' : 'exit'))
    const timer = window.setTimeout(() => setPhase('gone'), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  if (phase === 'gone') return null

  return (
    <StudioBootScreen
      failed={loadStatus.startsWith(LOAD_FAILED_PREFIX)}
      exiting={phase === 'exit'}
      onClose={close}
    />
  )
}

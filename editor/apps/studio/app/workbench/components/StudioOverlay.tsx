'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirectorApi } from '@topview/3d-builder'
import { LocalHostAdapter, type LocalDocumentSource } from '../../../src/LocalHostAdapter'
import { setLiveStudio } from '../../../src/devtools/liveStudio'
import { useStudioLocale } from '../../../src/devtools/localePreference'

function StudioChunkFallback() {
  return (
    <div className="t3d-studio-host">
      <div className="t3d-root">
        <div className="t3d-boot" role="status" aria-live="polite" aria-busy="true">
          <div className="t3d-boot-progress" aria-hidden="true">
            <span className="t3d-boot-progress-bar" />
          </div>
          <p className="t3d-boot-title">opening</p>
        </div>
      </div>
    </div>
  )
}

const CHUNK_RELOAD_KEY = 't3d-studio-chunk-reload'

function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  const msg = String(e?.message ?? err ?? '')
  return (
    e?.name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  )
}

const DirectorStudio = dynamic(
  () =>
    import('@topview/3d-builder')
      .then((mod) => {
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY)
        } catch {
          /* ignore */
        }
        return mod.DirectorStudio
      })
      .catch((err: unknown) => {
        // After builder dist rebuild, Next HMR often leaves a stale chunk URL.
        // One hard reload recovers; avoid loops via sessionStorage.
        if (typeof window !== 'undefined' && isChunkLoadError(err)) {
          try {
            if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
              sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
              window.location.reload()
              return function StudioChunkReloadPlaceholder() {
                return null
              }
            }
            sessionStorage.removeItem(CHUNK_RELOAD_KEY)
          } catch {
            /* ignore */
          }
        }
        throw err
      }),
  { ssr: false, loading: StudioChunkFallback },
)

type StudioWindow = Window & {
  __stage?: DirectorApi['stage']
  __store?: DirectorApi['useStore']
  __exportDraft?: () => boolean
}

function installDebugHooks(api: DirectorApi): void {
  const target = window as StudioWindow
  target.__stage = api.stage
  target.__store = api.useStore
  target.__exportDraft = () => api.useStore.getState().exportDraft()
  setLiveStudio(api)
}

function clearDebugHooks(): void {
  const target = window as StudioWindow
  delete target.__stage
  delete target.__store
  delete target.__exportDraft
  setLiveStudio(null)
}

export function StudioOverlay({
  documentId,
  source = 'draft',
  onClose,
}: {
  documentId: string
  source?: LocalDocumentSource
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const locale = useStudioLocale()
  const adapter = useMemo(() => new LocalHostAdapter(source), [source])
  const onReady = useCallback((api: DirectorApi) => {
    installDebugHooks(api)
  }, [])

  useEffect(() => {
    setMounted(true)
    return () => clearDebugHooks()
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="wb-studio-overlay" role="dialog" aria-modal="true" aria-label="3D 导演台">
      <div className="studio-root">
        {/* 工作台宿主文案固定中文；包内导演台仍可由右下角开发工具切语言 */}
        <DirectorStudio
          adapter={adapter}
          documentId={documentId}
          locale={locale}
          onReady={onReady}
          onClose={onClose}
          readOnly={adapter.readOnly}
        />
      </div>
    </div>,
    document.body,
  )
}

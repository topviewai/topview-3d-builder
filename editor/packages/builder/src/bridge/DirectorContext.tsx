import '../stores/setup'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DirectorDocument } from '../contract/types'
import { DirectorDoc, History } from '../document'
import type { DirectorEngine } from '../engine/DirectorEngine'
import { Stage } from '../engine/core/Stage'
import type { HostAdapter } from '../host/types'
import { resolveMediaUrl } from '../host/resolve'
import { EditorStore } from '../stores/EditorStore'
import type { DirectorStore } from '../stores/types'
import { DocumentSync } from '../sync/DocumentSync'
import { StudioSession } from '../sync/StudioSession'
import { createStoreHook } from './createStoreHook'
import { disposeThumbnailStore } from '../components/film/hooks/thumbnailStore'

export interface DirectorApi {
  stage: DirectorEngine
  useStore: DirectorStore
  adapter: HostAdapter<DirectorDocument>
  session: StudioSession
}

const DirectorContext = createContext<DirectorApi | null>(null)

/** 最近一次指针落在哪个 App 根上；只用于快捷键路由，不是引擎/store 单例。 */
let activeAppRoot: HTMLElement | null = null

export function claimAppKeyboard(root: HTMLElement): void {
  activeAppRoot = root
}

export function isAppKeyboardOwner(root: HTMLElement | null): boolean {
  return !!root && activeAppRoot === root
}

export function releaseAppKeyboard(root: HTMLElement): void {
  if (activeAppRoot === root) activeAppRoot = null
}

function createDirectorApi(
  adapter: HostAdapter<DirectorDocument>,
  documentId: string,
  readOnly?: boolean,
): DirectorApi & { sync: DocumentSync } {
  const stage = new Stage((ref) => resolveMediaUrl(adapter, ref))
  const doc = new DirectorDoc()
  const editor = new EditorStore(documentId)
  const history = new History()
  const session = new StudioSession(stage, doc, editor, history, adapter, { readOnly })
  const sync = new DocumentSync(session)
  return { stage, useStore: createStoreHook(session), adapter, session, sync }
}

export function DirectorProvider({
  children,
  adapter,
  documentId,
  onReady,
  autoSaveIntervalMs,
  fallback = null,
  readOnly = false,
}: {
  children: ReactNode
  adapter: HostAdapter<DirectorDocument>
  documentId: string
  onReady?: (api: DirectorApi) => void
  autoSaveIntervalMs?: number
  fallback?: ReactNode
  readOnly?: boolean
}) {
  const [api, setApi] = useState<DirectorApi | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const next = createDirectorApi(adapter, documentId, readOnly)
    setApi(next)
    onReadyRef.current?.(next)
    return () => {
      next.sync.dispose()
      disposeThumbnailStore(next.stage)
      next.stage.dispose()
    }
  }, [adapter, documentId, readOnly])

  useEffect(() => {
    if (!api?.session.canSave) return
    if (!autoSaveIntervalMs || autoSaveIntervalMs <= 0) return
    const timer = window.setInterval(() => {
      void api.session.save({ captureCover: false })
    }, autoSaveIntervalMs)
    return () => window.clearInterval(timer)
  }, [api, autoSaveIntervalMs])

  if (!api) return fallback
  return <DirectorContext.Provider value={api}>{children}</DirectorContext.Provider>
}

export function useDirector(): DirectorApi {
  const ctx = useContext(DirectorContext)
  if (!ctx) throw new Error('useDirector must be used within DirectorProvider')
  return ctx
}

/** `pendingSave` 仅在后台保存模式下传入，resolve 为保存错误信息，成功为 null。 */
export type StudioCloseHandler = (pendingSave?: Promise<string | null>) => void

const OverlayCloseContext = createContext<(() => boolean | Promise<boolean>) | undefined>(undefined)

/** 前台关闭时保存可能很快，短于这一拍转圈会在画出前被卸掉。 */
const CLOSE_LOADING_FLOOR_MS = 400

export function OverlayCloseProvider({
  onClose,
  saveInBackground = false,
  children,
}: {
  onClose?: StudioCloseHandler
  saveInBackground?: boolean
  children: ReactNode
}) {
  const { session } = useDirector()
  const closingRef = useRef(false)
  const close = async (): Promise<boolean> => {
    if (!onClose || closingRef.current) return false
    closingRef.current = true
    const started = performance.now()
    const abort = () => {
      closingRef.current = false
      return false
    }
    if (!session.ready || !session.canSave) {
      onClose()
      return true
    }
    if (saveInBackground) {
      const { done } = await session.beginCloseSave()
      onClose(done ?? undefined)
      return true
    }
    const err = await session.save({ captureCover: true })
    if (err) return abort()
    const remain = CLOSE_LOADING_FLOOR_MS - (performance.now() - started)
    if (remain > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remain))
    onClose()
    return true
  }
  return (
    <OverlayCloseContext.Provider value={onClose ? close : undefined}>{children}</OverlayCloseContext.Provider>
  )
}

export function useOverlayClose(): (() => boolean | Promise<boolean>) | undefined {
  return useContext(OverlayCloseContext)
}

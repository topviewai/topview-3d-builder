import { App } from './components/App'
import { StudioBootScreen } from './components/overlay/PortalRoot'
import type { DirectorDocument } from './contract/types'
import type { HostAdapter } from './host/types'
import {
  DirectorProvider,
  OverlayCloseProvider,
  type DirectorApi,
  type StudioCloseHandler,
} from './bridge/DirectorContext'
import { LocaleProvider } from './locale'

export type { DirectorApi, StudioCloseHandler }

export const DEFAULT_AUTO_SAVE_INTERVAL_MS = 5_000

export interface DirectorStudioProps {
  /**
   * 宿主适配器。**必须是稳定引用**（`useMemo(() => new XxxAdapter(), [])` 或模块级单例）。
   * 传内联字面量会让引擎实例与 WebGL 上下文随每次渲染重建，
   * 症状是画面闪烁、越用越卡，且不易联想到本 prop。
   */
  adapter: HostAdapter<DirectorDocument>
  /** 要编辑哪一份文档。列表 / 新建归宿主，包只认这个 id */
  documentId: string
  className?: string
  onReady?: (api: DirectorApi) => void
  /**
   * 宿主 overlay 关闭。传入后 header 右侧显示退出，不传则不渲染。
   * `saveOnCloseInBackground` 开启时会带上后台保存的 Promise。
   */
  onClose?: StudioCloseHandler
  /**
   * 退出时不等保存：封面渲染完即调用 onClose，文档保存与封面上传在后台继续，
   * 结果通过 onClose 的 `pendingSave` 交给宿主（失败提示、重开前等待都归宿主）。
   * 缺省 false：保存成功才关闭。
   */
  saveOnCloseInBackground?: boolean
  /**
   * 界面语言。包内零探测：不读 storage / navigator / 广播。
   * 缺省 `en`；未收录的值回落 `en`（见 locale/catalog.ts 的 DEFAULT_LOCALE）。
   * 宿主应显式传入自身语言，不要依赖缺省值。
   * 不要把本 prop 放进重建引擎的 effect 依赖。
   */
  locale?: string
  /**
   * 自动保存间隔。缺省 5000；`0` 关闭。
   * `saveDocument` 未实现时整条链关闭。
   */
  autoSaveIntervalMs?: number
  /**
   * 宿主判定的只读会话。包不鉴权，只锁写入交互。
   * 默认 false；调试台不要传。
   */
  readOnly?: boolean
}

/**
 * 宿主在 overlay 里等自己的文档接口时用它占位，视觉与包内启动画面完全一致。
 * 自带 LocaleProvider，因此不能用在 DirectorStudio 内部。
 */
export function StudioBootOverlay({
  locale,
  failed = false,
  message,
  onClose,
  className,
}: StudioBootOverlayProps) {
  return (
    <LocaleProvider locale={locale}>
      <StudioBootShell className={className} failed={failed} message={message} onClose={onClose} />
    </LocaleProvider>
  )
}

export interface StudioBootOverlayProps {
  /** 与 DirectorStudioProps.locale 同义，缺省 `en` */
  locale?: string
  failed?: boolean
  /** 失败原因，缺省回落包内通用文案 */
  message?: string
  onClose?: () => void
  className?: string
}

function StudioBootShell({
  className,
  failed,
  message,
  onClose,
}: {
  className?: string
  failed?: boolean
  message?: string
  onClose?: () => void
}) {
  return (
    <div className={studioHostClass(className)}>
      <div className="t3d-root">
        <StudioBootScreen failed={failed} message={message} onClose={onClose} />
      </div>
    </div>
  )
}

function studioHostClass(className?: string): string {
  return className ? `t3d-studio-host ${className}` : 't3d-studio-host'
}

export function DirectorStudio({
  adapter,
  documentId,
  className,
  onReady,
  onClose,
  saveOnCloseInBackground = false,
  locale,
  autoSaveIntervalMs = DEFAULT_AUTO_SAVE_INTERVAL_MS,
  readOnly = false,
}: DirectorStudioProps) {
  const hostClass = studioHostClass(className)

  return (
    <LocaleProvider locale={locale}>
      <DirectorProvider
        adapter={adapter}
        documentId={documentId}
        onReady={onReady}
        autoSaveIntervalMs={readOnly ? 0 : autoSaveIntervalMs}
        readOnly={readOnly}
        fallback={<StudioBootShell className={className} onClose={onClose} />}
      >
        <OverlayCloseProvider onClose={onClose} saveInBackground={saveOnCloseInBackground}>
          <div className={hostClass}>
            <App />
          </div>
        </OverlayCloseProvider>
      </DirectorProvider>
    </LocaleProvider>
  )
}

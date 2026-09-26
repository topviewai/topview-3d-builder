import { useCallback, useEffect, useState } from 'react'
import type { HostAdapter } from '../../../host/types'

export type TopviewCanvasAuth = 'checking' | 'authorized' | 'unauthorized'

/** 登录在另一个标签页完成，所以窗口重新获得焦点时再查一次。 */
export function useTopviewCanvasAuth(adapter: HostAdapter, enabled: boolean) {
  const [auth, setAuth] = useState<TopviewCanvasAuth>('checking')

  const refresh = useCallback(async () => {
    if (!enabled || !adapter.topviewCanvasAuthorized) return
    try {
      setAuth((await adapter.topviewCanvasAuthorized()) ? 'authorized' : 'unauthorized')
    } catch {
      setAuth('unauthorized')
    }
  }, [adapter, enabled])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return {
    auth,
    loginUrl: adapter.topviewCanvasLoginUrl?.() ?? '',
    markUnauthorized: () => setAuth('unauthorized'),
  }
}

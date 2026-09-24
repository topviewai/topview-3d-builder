import { useEffect } from 'react'
import { useDirector } from '../../bridge/DirectorContext'

export function useDraftLifecycle(): void {
  const { session, useStore } = useDirector()
  const draftId = useStore((s) => s.draftId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await session.loadDraft(draftId)
      } catch (e) {
        if (cancelled) return
        console.error(e)
        session.setLoadStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draftId, session])
}

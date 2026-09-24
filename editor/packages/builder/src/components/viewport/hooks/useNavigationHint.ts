import { useEffect, useState } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'

let dismissedThisSession = false

export function useNavigationHint() {
  const { adapter } = useDirector()
  const [visible, setVisible] = useState(false)
  const [toast, setToast] = useState(false)

  useEffect(() => {
    try {
      setVisible(!(adapter.getNavigationHintDismissed?.() ?? dismissedThisSession))
    } catch {
      setVisible(!dismissedThisSession)
    }
  }, [adapter])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(false), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const dismiss = () => {
    dismissedThisSession = true
    setVisible(false)
    setToast(true)
    try {
      adapter.dismissNavigationHint?.()
    } catch {
      // Storage can be unavailable; keep the dismissal for this session.
    }
  }

  return { visible, toast, dismiss }
}

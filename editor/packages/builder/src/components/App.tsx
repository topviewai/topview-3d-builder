import { useRef } from 'react'
import { useDraftLifecycle } from './hooks/useDraftLifecycle'
import { useScopedKeyboard } from './hooks/useScopedKeyboard'
import { Layout } from './Layout'
import { StudioShell } from './overlay/PortalRoot'

export function App() {
  const rootRef = useRef<HTMLDivElement>(null)
  useDraftLifecycle()
  useScopedKeyboard(rootRef)

  return (
    <StudioShell rootRef={rootRef}>
      <Layout />
    </StudioShell>
  )
}

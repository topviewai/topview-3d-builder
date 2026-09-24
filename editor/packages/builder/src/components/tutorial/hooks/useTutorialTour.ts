import { useCallback, useEffect, useRef, useState } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import type { StudioView } from '../../../stores/types'
import { TUTORIAL_STEPS } from '../constants'
import type { TutorialStep } from '../types'
import { clientRectOf, isUsableRect, visibleTutorialSteps } from '../utils'

function prepareWorkspace(store: StudioView): void {
  store.setLibraryTab('object')
  if (store.workspaceMode !== 'scene') store.setWorkspaceMode('scene')
  if (!store.inspectorOpen) store.toggleInspector()
  if (!store.timelineOpen) store.openTimeline()
  if (store.viewportFullscreen) store.toggleViewportFullscreen()
  if (store.followMode) store.setFollowMode(false)
  if (store.cameraPilotId) store.setCameraPilot(null)
}

function readAnchorRect(root: HTMLElement, id: TutorialStep['id']) {
  const el = root.querySelector(`[data-tutorial-anchor="${id}"]`)
  if (!el) return null
  const rect = clientRectOf(el)
  return isUsableRect(rect) ? rect : null
}

export function useTutorialTour() {
  const { useStore } = useDirector()
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [steps, setSteps] = useState<TutorialStep[]>([])
  const rootRef = useRef<HTMLElement | null>(null)

  const refreshSteps = useCallback((): TutorialStep[] => {
    const root = rootRef.current ?? document.querySelector<HTMLElement>('.t3d-root')
    if (!root) return []
    const next = visibleTutorialSteps(TUTORIAL_STEPS, (id) => readAnchorRect(root, id))
    setSteps(next)
    return next
  }, [])

  const start = useCallback((from?: HTMLElement | null) => {
    rootRef.current = from?.closest<HTMLElement>('.t3d-root') ?? document.querySelector<HTMLElement>('.t3d-root')
    prepareWorkspace(useStore.getState())
    setStepIndex(0)
    setOpen(true)
    window.setTimeout(() => {
      const next = refreshSteps()
      if (next.length === 0) setOpen(false)
    }, 80)
  }, [refreshSteps, useStore])

  const stop = useCallback(() => {
    setOpen(false)
    setStepIndex(0)
  }, [])

  const goTo = useCallback((index: number) => {
    setStepIndex(index)
  }, [])

  useEffect(() => {
    if (!open) return
    const next = refreshSteps()
    if (next.length > 0 && stepIndex >= next.length) setStepIndex(next.length - 1)
  }, [open, refreshSteps, stepIndex])

  const step = steps[stepIndex] ?? null
  const isFirst = stepIndex <= 0
  const isLast = steps.length > 0 && stepIndex >= steps.length - 1

  const next = useCallback(() => {
    if (steps.length === 0 || stepIndex >= steps.length - 1) {
      stop()
      return
    }
    setStepIndex((index) => index + 1)
  }, [stepIndex, steps.length, stop])

  const prev = useCallback(() => {
    setStepIndex((index) => Math.max(0, index - 1))
  }, [])

  return {
    open,
    step,
    stepIndex,
    steps,
    isFirst,
    isLast,
    start,
    stop,
    goTo,
    next,
    prev,
    refreshSteps,
  }
}

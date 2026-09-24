function altCode(event: KeyboardEvent): string | null {
  if (event.code === 'AltLeft' || event.code === 'AltRight') return event.code
  if (event.key === 'Alt' || event.key === 'AltGraph') {
    return event.location === 2 ? 'AltRight' : 'AltLeft'
  }
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const el = target as HTMLElement
  const tag = el.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

/** Pointer.altKey can drop when the host eats the left Alt menu key. */
export function trackStageAltModifier(host: Window = window) {
  const pressed = new Set<string>()
  const reset = () => pressed.clear()
  const onKeyDown = (event: KeyboardEvent) => {
    const code = altCode(event)
    if (!code || isEditableTarget(event.target)) return
    pressed.add(code)
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    const code = altCode(event)
    if (!code) return
    const handled = pressed.delete(code)
    if (handled && !event.ctrlKey && !event.metaKey && !event.shiftKey) event.preventDefault()
  }
  const onVisibilityChange = () => {
    if (host.document.hidden) reset()
  }
  host.addEventListener('keydown', onKeyDown, { capture: true })
  host.addEventListener('keyup', onKeyUp, { capture: true })
  host.addEventListener('blur', reset)
  host.document.addEventListener('visibilitychange', onVisibilityChange)
  return {
    isPressed: (event: Pick<PointerEvent, 'altKey'>) => event.altKey || pressed.size > 0,
    dispose: () => {
      host.removeEventListener('keydown', onKeyDown, { capture: true })
      host.removeEventListener('keyup', onKeyUp, { capture: true })
      host.removeEventListener('blur', reset)
      host.document.removeEventListener('visibilitychange', onVisibilityChange)
      reset()
    },
  }
}

import { useEffect, useState } from 'react'

/** Let a mouse wheel browse the same categories as a horizontal trackpad gesture. */
export function useChipScroll() {
  const [element, setElement] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      if (element.scrollWidth <= element.clientWidth) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1
      const previous = element.scrollLeft
      element.scrollLeft += event.deltaY * unit
      if (element.scrollLeft !== previous) event.preventDefault()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [element])

  return setElement
}

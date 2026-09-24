import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { CatalogImage } from '../library/AssetGrid'
import type { HostAdapter } from '../../host/types'
import { usePortalRoot } from '../overlay/PortalRoot'
import { CameraMotionThumb, CameraPresetThumb } from './CameraLibraryThumb'
import { HOVER_SIZE } from './constants'
import { PrimitiveThumb } from './PrimitiveThumb'
import type { HoverDiagram, HoverTarget } from './types'

function HoverDiagramView({ diagram }: { diagram: HoverDiagram }): ReactElement {
  const wide = diagram.kind === 'cameraMotion'
  return (
    <div className={wide ? 't3d-leftrail-hover-diagram t3d-leftrail-hover-diagram-wide' : 't3d-leftrail-hover-diagram'}>
      {diagram.kind === 'primitive' ? (
        <PrimitiveThumb kind={diagram.id} />
      ) : diagram.kind === 'cameraPreset' ? (
        <CameraPresetThumb id={diagram.id} instance="hover" />
      ) : (
        <CameraMotionThumb id={diagram.id} instance="hover" />
      )}
    </div>
  )
}

export function HoverPreview({
  target,
  adapter,
}: {
  target: HoverTarget | null
  adapter: HostAdapter
}): ReactElement | null {
  const portal = usePortalRoot()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!ref.current || !target) return
    const height = ref.current.offsetHeight || HOVER_SIZE
    const top = Math.min(Math.max(12, target.top), window.innerHeight - height - 12)
    ref.current.style.left = `${target.panelRight + 8}px`
    ref.current.style.top = `${top}px`
  }, [target])

  if (!target || !portal) return null
  return createPortal(
    <div ref={ref} className="t3d-leftrail-hover" aria-hidden>
      {target.diagram ? (
        <HoverDiagramView diagram={target.diagram} />
      ) : target.assetKey ? (
        <CatalogImage adapter={adapter} assetKey={target.assetKey} alt={target.alt} />
      ) : null}
      <div className="t3d-leftrail-hover-name">{target.alt}</div>
    </div>,
    portal,
  )
}

import { useState, type ReactElement } from 'react'
import type { DraftNode } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { isPathApplyTarget, isPathEditTarget } from '../../stores/nodeSelection'
import { displayNodeName } from '../displayNames'
import { Dropdown } from '../common/Dropdown'
import { Tooltip } from '../common/Tooltip'
import { IconCrosshair } from '../leftrail/icons'
import { InspectorSection } from './PosePanel'

export function PathEditButton({ node }: { node: DraftNode }): ReactElement | null {
  const t = useT()
  const { useStore } = useDirector()
  const pathEditingId = useStore((s) => s.pathEditingId)
  const setPathEditingId = useStore((s) => s.setPathEditingId)
  if (!isPathEditTarget(node)) return null
  const editing = pathEditingId === node.id
  const locked = Boolean(node.locked)
  return (
    <button
      type="button"
      className="t3d-inspector-path-edit"
      aria-pressed={editing}
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => setPathEditingId(editing ? null : node.id)}
    >
      {t(editing ? 'viewport.finishPath' : 'viewport.editPath')}
    </button>
  )
}

export function PathSection({ node }: { node: DraftNode }): ReactElement | null {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const applyPathToTarget = useStore((s) => s.applyPathToTarget)
  const beginPathApplyPick = useStore((s) => s.beginPathApplyPick)
  const cancelPathApplyPick = useStore((s) => s.cancelPathApplyPick)
  const pathApplyPickingId = useStore((s) => s.pathApplyPickingId)
  const [msg, setMsg] = useState<string | null>(null)
  if (!doc || !node.path) return null
  const picking = pathApplyPickingId === node.id
  const targets = doc.content.nodes.filter((x) => isPathApplyTarget(x))
  const targetLabel = (target: DraftNode): string => {
    const kind =
      target.type === 'camera'
        ? t('inspector.targetCamera')
        : target.type === 'prop'
          ? t('inspector.targetProp')
          : target.type === 'primitive'
            ? t('inspector.targetPrimitive')
            : t('inspector.targetCharacter')
    return kind + ' · ' + displayNodeName(t, target)
  }
  return (
    <InspectorSection title={t('inspector.applyTo')} collapsible={false}>
      <Dropdown
        ariaLabel={t('inspector.applyTo')}
        value=""
        disabled={node.locked}
        options={[
          { value: '', label: t('inspector.pickTarget') },
          ...targets.map((target) => ({
            value: target.id,
            label: targetLabel(target),
            disabled: target.locked,
          })),
        ]}
        onChange={(id) => {
          if (!id || node.locked) return
          setMsg(applyPathToTarget(node.id, id))
        }}
      />
      <Tooltip label={t('help.pathApplyPick')} side="top" variant="description">
        <button
          type="button"
          className={`t3d-path-apply-btn${picking ? ' is-active' : ''}`}
          aria-pressed={picking}
          disabled={node.locked}
          onClick={() => (picking ? cancelPathApplyPick() : beginPathApplyPick(node.id))}
        >
          <IconCrosshair />
          <span>{t('inspector.bindInViewport')}</span>
        </button>
      </Tooltip>
      {msg ? <div role="alert" className="t3d-inspector-empty t3d-path-apply-error">{msg}</div> : null}
    </InspectorSection>
  )
}

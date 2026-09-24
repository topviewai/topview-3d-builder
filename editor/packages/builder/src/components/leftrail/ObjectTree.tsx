import { useState, type ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { buildNodeSelection, nodeIdsOf, toggleNodeIds } from '../../stores/nodeSelection'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { IconCamera, IconCharacter, IconEye, IconEyeOff, IconLock, IconObject, IconProp, IconScene, IconUnlock } from './icons'
import { SearchField } from './SearchField'
import { buildObjectRows, treeIconKind, type TreeRow } from './utils'

function RowIcon({ kind }: { kind: ReturnType<typeof treeIconKind> }): ReactElement {
  if (kind === 'scene') return <IconScene />
  if (kind === 'character') return <IconCharacter />
  if (kind === 'camera') return <IconCamera />
  if (kind === 'prop') return <IconProp />
  return <IconObject />
}

export function ObjectTree(): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const [query, setQuery] = useState('')
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const film = useStore((s) => s.workspaceMode === 'film')
  const writeLocked = useStore((s) => s.writeLocked)
  const { select, setNodeFlags } = useStore()
  const rows = buildObjectRows(doc?.content.nodes ?? [], query, t)
  const selectedIds = new Set(nodeIdsOf(selection))

  return (
    <div className="t3d-leftrail-object">
      <SearchField value={query} placeholder={t('library.searchObjects')} onChange={setQuery} />
      <div className="t3d-leftrail-tree">
        {rows.map((row) => (
          <TreeRowView
            key={row.id}
            row={row}
            selected={row.type !== 'scene' && selectedIds.has(row.id)}
            sceneLabel={t('library.sceneRoot')}
            hideLabel={t('library.hide')}
            showLabel={t('library.show')}
            lockLabel={t('library.lock')}
            unlockLabel={t('library.unlock')}
            readOnly={film || writeLocked}
            onSelect={(shiftKey) => {
              if (film) return
              if (row.type === 'scene') {
                select(null)
                return
              }
              if (shiftKey) {
                const current = selection?.kind === 'node' ? selection : null
                select(buildNodeSelection(toggleNodeIds(current?.nodeIds, current?.nodeId, row.id)))
                return
              }
              select(buildNodeSelection([row.id]))
            }}
            onToggleVisible={() => {
              if (film || !row.node) return
              setNodeFlags(row.node.id, { visible: row.node.visible === false })
            }}
            onToggleLocked={() => {
              if (film || !row.node) return
              setNodeFlags(row.node.id, { locked: !row.node.locked })
            }}
          />
        ))}
      </div>
    </div>
  )
}

function TreeRowView({
  row,
  selected,
  sceneLabel,
  hideLabel,
  showLabel,
  lockLabel,
  unlockLabel,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  readOnly,
}: {
  row: TreeRow
  selected: boolean
  sceneLabel: string
  hideLabel: string
  showLabel: string
  lockLabel: string
  unlockLabel: string
  readOnly?: boolean
  onSelect: (shiftKey: boolean) => void
  onToggleVisible: () => void
  onToggleLocked: () => void
}): ReactElement {
  const hidden = row.node?.visible === false
  const locked = Boolean(row.node?.locked)
  return (
    <div
      className={cx('t3d-leftrail-tree-row', selected && 't3d-leftrail-tree-row-active')}
      style={{ paddingLeft: 8 + row.depth * 14 }}
    >
      <button type="button" className="t3d-leftrail-tree-main" onClick={(e) => onSelect(e.shiftKey)}>
        <RowIcon kind={treeIconKind(row.type)} />
        <span className={cx(hidden && 't3d-leftrail-tree-hidden')}>
          {row.type === 'scene' ? sceneLabel : row.name}
        </span>
      </button>
      {row.type !== 'scene' && row.node ? (
        <span className="t3d-leftrail-tree-flags">
          <Tooltip label={hidden ? showLabel : hideLabel} side="top">
            <button
              type="button"
              className={cx(hidden && 'is-on')}
              disabled={readOnly}
              onClick={onToggleVisible}
            >
              {hidden ? <IconEyeOff /> : <IconEye />}
            </button>
          </Tooltip>
          <Tooltip label={locked ? unlockLabel : lockLabel} side="top">
            <button
              type="button"
              className={cx(locked && 'is-on')}
              disabled={readOnly}
              onClick={onToggleLocked}
            >
              {locked ? <IconLock /> : <IconUnlock />}
            </button>
          </Tooltip>
        </span>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'

/** Inspector / 时间线共用的节点名编辑。点一下进入编辑，回车或失焦提交。 */
export function NodeNameEditor({
  nodeId,
  persistName,
  displayName,
  className,
  editRequest = 0,
}: {
  nodeId: string
  persistName: string
  displayName: string
  className?: string
  /** 外部重命名按钮递增此值，即可进入编辑。 */
  editRequest?: number
}) {
  const t = useT()
  const { useStore } = useDirector()
  const renameNode = useStore((s) => s.renameNode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName)
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName

  useEffect(() => {
    if (!editing) setDraft(displayName)
  }, [displayName, editing])

  useEffect(() => {
    if (!editRequest) return
    setDraft(displayNameRef.current)
    setEditing(true)
  }, [editRequest])

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === persistName || next === displayName) {
      setDraft(displayName)
      return
    }
    renameNode(nodeId, next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={className}
        title={t('inspector.renameHint')}
        onClick={(e) => {
          e.stopPropagation()
          setDraft(displayName)
          setEditing(true)
        }}
      >
        {displayName}
      </button>
    )
  }

  return (
    <input
      className="t3d-node-name-input"
      value={draft}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(displayName)
          setEditing(false)
        }
      }}
    />
  )
}

import { useState, type ReactElement } from 'react'
import type { DraftNode } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import { CameraLensPanel } from '../common/CameraLensPanel'
import { CameraSubjectPanel } from '../common/CameraSubjectPanel'
import { CameraTransformPanel } from '../common/CameraTransformPanel'
import { CharacterColorPanel } from '../common/CharacterColorPanel'
import { NodeNameEditor } from '../common/NodeNameEditor'
import { displayNodeName } from '../displayNames'
import { NodeTransformPanel, ResetTransformButton, TransformKeyframeButton } from '../common/NodeTransformPanel'
import { Dropdown } from '../common/Dropdown'
import { cx } from '../common/cx'
import { IconCharacter, IconObject, IconProp } from '../leftrail/icons'
import { FieldRow, InspectorSection, PosePanel, ToggleRow } from './PosePanel'
import { PathEditButton, PathSection } from './PathControls'
import { NODE_DELETE_LABEL } from './constants'
import { nodeTypeLabel } from './utils'

function IconRename() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 20h4.2L19 9.2a1.6 1.6 0 0 0 0-2.3L17.1 5a1.6 1.6 0 0 0-2.3 0L4 15.8V20Z" />
      <path d="M13.4 6.6l4 4" />
    </svg>
  )
}

function InspectorTitle({
  node,
  icon,
  extra,
}: {
  node: DraftNode
  icon?: ReactElement
  extra?: ReactElement
}) {
  const t = useT()
  const [editRequest, setEditRequest] = useState(0)
  const renameable = node.type === 'character' || node.type === 'prop' || node.type === 'camera' || node.type === 'primitive'
  return (
    <div className="t3d-inspector-title">
      {icon}
      <span className="t3d-inspector-title-text">
        <NodeNameEditor
          nodeId={node.id}
          persistName={node.name}
          displayName={displayNodeName(t, node)}
          className="t3d-node-name-btn"
          editRequest={editRequest}
        />
      </span>
      {renameable || extra ? (
        <span className="t3d-inspector-title-action">
          {renameable ? (
            <button
              type="button"
              className="t3d-inspector-rename"
              aria-label={t('inspector.renameHint')}
              title={t('inspector.renameHint')}
              onClick={() => setEditRequest((n) => n + 1)}
            >
              <IconRename />
            </button>
          ) : null}
          {extra}
        </span>
      ) : null}
    </div>
  )
}

function PlaceOnGroundButton({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const placeNodeOnGround = useStore((s) => s.placeNodeOnGround)
  return (
    <button
      type="button"
      className="t3d-inspector-action"
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => {
        if (locked) return
        placeNodeOnGround(nodeId)
      }}
    >
      {t('inspector.placeOnGround')}
    </button>
  )
}

function PlaceOnSupportRow({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const placeNodeOnSupport = useStore((s) => s.placeNodeOnSupport)
  const [supportId, setSupportId] = useState('')
  const targets = (doc?.content.nodes ?? []).filter(
    (n) =>
      n.id !== nodeId && (n.type === 'character' || n.type === 'prop' || n.type === 'primitive'),
  )
  if (targets.length === 0) return null
  const chosen = targets.some((n) => n.id === supportId) ? supportId : ''
  return (
    <div className="t3d-place-on">
      <div className="t3d-cam-aim-target">
        <span>{t('inspector.placeOnSupport')}</span>
        <Dropdown
          ariaLabel={t('inspector.pickSupport')}
          value={chosen}
          disabled={locked}
          options={[
            { value: '', label: t('inspector.pickSupport') },
            ...targets.map((n) => ({ value: n.id, label: displayNodeName(t, n) })),
          ]}
          onChange={setSupportId}
        />
      </div>
      <button
        type="button"
        className="t3d-inspector-action"
        disabled={locked || !chosen}
        title={locked ? t('inspector.nodeLocked') : t('inspector.placeOnSupportHint')}
        onClick={() => {
          if (locked || !chosen) return
          placeNodeOnSupport(nodeId, chosen)
        }}
      >
        {t('inspector.placeOnSupportAction')}
      </button>
    </div>
  )
}

/** 多选面板：几何对象共用材质色。显隐和锁定在对象栏。 */
export function MultiNodeInspector({ nodes }: { nodes: DraftNode[] }): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const setCharacterAppearance = useStore((s) => s.setCharacterAppearance)
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const materialNodes = nodes.filter(
    (node) => node.type === 'character' || node.type === 'prop' || node.type === 'primitive',
  )
  const firstMaterial = materialNodes[0]
  const colorOf = (node: DraftNode): string => {
    if (node.character) return node.character.appearance.color
    if (node.prop) return node.prop.appearance?.color ?? '#cccccc'
    return node.primitive?.appearance?.color ?? '#cccccc'
  }
  const materialColor = firstMaterial
    ? materialNodes.every((node) => colorOf(node).toLowerCase() === colorOf(firstMaterial).toLowerCase())
      ? colorOf(firstMaterial)
      : '#cccccc'
    : '#cccccc'
  const applyMaterialColor = (color: string) => {
    for (const node of materialNodes) {
      if (node.character) setCharacterAppearance(node.id, { color })
      else setObjectAppearance(node.id, { color })
    }
  }

  return (
    <div className="t3d-inspector">
      <div className="t3d-inspector-title">
        <IconObject className="t3d-inspector-title-icon" />
        <span className="t3d-inspector-title-text">
          {t('inspector.multiSelectTitle', { count: nodes.length })}
        </span>
      </div>
      {materialNodes.length > 0 ? (
        <InspectorSection title={t('inspector.material')}>
          <CharacterColorPanel
            color={materialColor}
            onChange={applyMaterialColor}
          />
        </InspectorSection>
      ) : null}
    </div>
  )
}

export function NodePanel({ node }: { node: DraftNode }): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const deleteNode = useStore((s) => s.deleteNode)
  const deleteKey = NODE_DELETE_LABEL[node.type]
  const locked = Boolean(node.locked)
  const primitiveLabelVisible = node.primitive?.label?.showLabel === true

  return (
    <div className="t3d-inspector">
      <InspectorTitle
        node={node}
        extra={
          node.type === 'camera' || node.type === 'primitive' ? undefined : (
            <span className="t3d-inspector-chip">{nodeTypeLabel(t, node.type)}</span>
          )
        }
      />
      {node.type === 'path' && !isDerivedTransformPath(node) ? <PathSection key={node.id} node={node} /> : null}
      {node.type === 'primitive' ? (
        <InspectorSection title={t('inspector.display')}>
          <ToggleRow
            label={t('inspector.showLabel')}
            checked={primitiveLabelVisible}
            disabled={locked}
            onChange={(showLabel) => setObjectAppearance(node.id, { showLabel })}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection
        key={`${node.id}:transform`}
        title={t('timeline.transform')}
        defaultOpen={false}
        extra={
          <span className="t3d-inspector-section-actions">
            <TransformKeyframeButton nodeId={node.id} locked={locked} />
            {node.camera ? null : <ResetTransformButton nodeId={node.id} locked={locked} />}
          </span>
        }
      >
        {node.camera ? (
          <>
            <CameraTransformPanel cameraId={node.id} />
            <CameraLensPanel cameraId={node.id} />
          </>
        ) : (
          <>
            <NodeTransformPanel nodeId={node.id} locked={locked} />
            {node.character ? <FieldRow label={t('inspector.color')} value={node.character.appearance.color} /> : null}
            {node.type === 'character' || node.type === 'prop' || node.type === 'primitive' ? (
              <>
                <PlaceOnSupportRow nodeId={node.id} locked={locked} />
                <PlaceOnGroundButton nodeId={node.id} locked={locked} />
              </>
            ) : null}
          </>
        )}
      </InspectorSection>
      {(node.type === 'primitive' || node.type === 'prop') ? (
        <InspectorSection title={t('inspector.material')}>
          <CharacterColorPanel
            color={
              node.type === 'prop'
                ? (node.prop?.appearance?.color ?? '#cccccc')
                : (node.primitive?.appearance?.color ?? '#cccccc')
            }
            disabled={locked}
            onChange={(next) => setObjectAppearance(node.id, { color: next })}
          />
        </InspectorSection>
      ) : null}
      {node.camera ? (
        <InspectorSection key={`${node.id}:lookAt`} title={t('timeline.lookAt')} defaultOpen={false}>
          <CameraSubjectPanel cameraId={node.id} />
        </InspectorSection>
      ) : null}
      {node.type === 'character' ? <PosePanel node={node} /> : null}
      {node.type === 'path' && !isDerivedTransformPath(node) ? <PathEditButton node={node} /> : null}
      {deleteKey ? (
        <button
          type="button"
          className="t3d-inspector-danger"
          disabled={locked}
          title={locked ? t('inspector.nodeLocked') : undefined}
          onClick={() => {
            if (locked) return
            if (window.confirm(t('inspector.deleteConfirm', { name: displayNodeName(t, node) }))) {
              deleteNode(node.id)
            }
          }}
        >
          {t(deleteKey)}
        </button>
      ) : null}
    </div>
  )
}

function DeleteNodeButton({ node }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const deleteNode = useStore((s) => s.deleteNode)
  const labelKey = NODE_DELETE_LABEL[node.type]
  const locked = Boolean(node.locked)
  if (!labelKey) return null
  return (
    <button
      type="button"
      className="t3d-inspector-danger"
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => {
        if (locked) return
        if (window.confirm(t('inspector.deleteConfirm', { name: displayNodeName(t, node) }))) {
          deleteNode(node.id)
        }
      }}
    >
      {t(labelKey)}
    </button>
  )
}

export function PropInspector({ node: n }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const locked = Boolean(n.locked)
  const color = n.prop?.appearance?.color ?? '#cccccc'
  const showLabel = n.prop?.label?.showLabel === true
  return (
    <div className="t3d-inspector">
      <InspectorTitle node={n} icon={<IconProp className="t3d-inspector-title-icon" />} />
      <InspectorSection title={t('inspector.display')}>
        <ToggleRow
          label={t('inspector.showLabel')}
          checked={showLabel}
          disabled={locked}
          onChange={(next) => setObjectAppearance(n.id, { showLabel: next })}
        />
      </InspectorSection>
      <InspectorSection
        title={t('timeline.transform')}
        defaultOpen={false}
        extra={
          <span className="t3d-inspector-section-actions">
          <TransformKeyframeButton nodeId={n.id} locked={locked} />
          <ResetTransformButton nodeId={n.id} locked={locked} />
        </span>
        }
      >
        <NodeTransformPanel nodeId={n.id} locked={locked} />
        <PlaceOnSupportRow nodeId={n.id} locked={locked} />
        <PlaceOnGroundButton nodeId={n.id} locked={locked} />
      </InspectorSection>
      <InspectorSection title={t('inspector.material')}>
        <CharacterColorPanel
          color={color}
          disabled={locked}
          onChange={(next) => setObjectAppearance(n.id, { color: next })}
        />
      </InspectorSection>
      <DeleteNodeButton node={n} />
    </div>
  )
}

/**
 * 角色节点检查器：顶层「属性 | 姿势」页签。
 * 属性页可手工改变换（整组打关键帧、缩放默认同比），没有骨骼开关。
 */
export function CharacterInspector({ node: n }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const setCharacterAppearance = useStore((s) => s.setCharacterAppearance)
  const [tab, setTab] = useState<'props' | 'pose'>('props')
  const locked = Boolean(n.locked)
  const showLabel = n.character?.label.showLabel !== false
  return (
    <div className={cx('t3d-inspector', tab === 'pose' && 't3d-inspector-pose')}>
      <InspectorTitle node={n} icon={<IconCharacter className="t3d-inspector-title-icon" />} />
      <div className="t3d-inspector-tabs">
        <button
          type="button"
          className={cx('t3d-inspector-tab', tab === 'props' && 't3d-inspector-tab-active')}
          aria-disabled="false"
          onClick={() => setTab('props')}
        >
          {t('inspector.tabProps')}
        </button>
        <button
          type="button"
          className={cx('t3d-inspector-tab', tab === 'pose' && 't3d-inspector-tab-active')}
          aria-disabled="false"
          onClick={() => setTab('pose')}
        >
          {t('inspector.tabPose')}
        </button>
      </div>
      {tab === 'pose' ? (
        <PosePanel node={n} />
      ) : (
        <>
          <div className="t3d-inspector-flags">
            <ToggleRow
              label={t('inspector.showLabel')}
              checked={showLabel}
              disabled={locked}
              onChange={(next) => setCharacterAppearance(n.id, { showLabel: next })}
            />
          </div>
          <InspectorSection
            title={t('timeline.transform')}
            defaultOpen={false}
            extra={
          <span className="t3d-inspector-section-actions">
          <TransformKeyframeButton nodeId={n.id} locked={locked} />
          <ResetTransformButton nodeId={n.id} locked={locked} />
        </span>
        }
          >
            <NodeTransformPanel nodeId={n.id} locked={locked} />
            <PlaceOnSupportRow nodeId={n.id} locked={locked} />
            <PlaceOnGroundButton nodeId={n.id} locked={locked} />
          </InspectorSection>
          {n.character ? (
            <InspectorSection title={t('inspector.material')}>
              <CharacterColorPanel
                color={n.character.appearance.color}
                disabled={locked}
                onChange={(color) => setCharacterAppearance(n.id, { color })}
              />
            </InspectorSection>
          ) : null}
        </>
      )}
    </div>
  )
}

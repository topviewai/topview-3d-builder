import { useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import type { Vec3 } from '../../contract/types'
import { cameraMotionOwnsKeyframes } from '../../evaluate/camera/cameraMotionExclusive'
import { useT } from '../../locale'
import { nodeIdsOf } from '../../stores/nodeSelection'
import { IconLock, IconRotate, IconUnlock } from '../leftrail/icons'
import { xformPropsForNodeType } from '../timeline/constants'
import { TransformGroup, type TransformAxis } from './TransformGroup'
import { hasKeyAtFrame, KeyframeButton } from './KeyframeButton'
import { useThrottledFrame } from '../../bridge/useEngineEvent'
import type { TrackProp } from '../../evaluate/curves/KeyframeTrack'

function uniformScale(prev: Vec3, axis: TransformAxis, next: number): Vec3 {
  const old = prev[axis]
  if (Math.abs(old) < 1e-8) return { x: next, y: next, z: next }
  const r = next / old
  return { x: prev.x * r, y: prev.y * r, z: prev.z * r }
}

/**
 * 人物 / 道具「变换」：位移、旋转、缩放各一块，布局与只读 XyzRow 一致。
 * 缩放默认锁定等比，锁在标签行右侧，打开后才可以按轴改。
 */
export function NodeTransformPanel({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore, stage } = useDirector()
  const doc = useStore((s) => s.doc)
  const writeNodeTransform = useStore((s) => s.writeNodeTransform)
  const [scaleLocked, setScaleLocked] = useState(true)
  if (!doc) return null

  const node = doc.content.nodes.find((n) => n.id === nodeId)
  if (!node) return null

  const snap = stage.getNodeSnapshot(nodeId)
  const pos = snap?.position?.length === 3
    ? { x: snap.position[0], y: snap.position[1], z: snap.position[2] }
    : node.transform.position
  const rot = snap?.rotation?.length === 3
    ? { x: snap.rotation[0], y: snap.rotation[1], z: snap.rotation[2] }
    : node.transform.rotation
  const scale = snap?.scale?.length === 3
    ? { x: snap.scale[0], y: snap.scale[1], z: snap.scale[2] }
    : node.transform.scale

  const setPos = (axis: TransformAxis, value: number) => {
    writeNodeTransform(nodeId, { position: { ...pos, [axis]: value } })
  }
  const setRot = (axis: TransformAxis, value: number) => {
    writeNodeTransform(nodeId, { rotation: { ...rot, [axis]: value } })
  }
  const setScale = (axis: TransformAxis, value: number) => {
    writeNodeTransform(nodeId, {
      scale: scaleLocked ? uniformScale(scale, axis, value) : { ...scale, [axis]: value },
    })
  }

  return (
    <div className="t3d-cam-xform">
      <TransformGroup
        label={t('inspector.staticPosition')}
        value={pos}
        step={0.1}
        precision={1}
        disabled={locked}
        onAxis={setPos}
      />
      <TransformGroup
        label={t('inspector.staticRotation')}
        value={rot}
        step={0.1}
        precision={1}
        disabled={locked}
        onAxis={setRot}
      />
      <TransformGroup
        label={t('inspector.staticScale')}
        value={scale}
        step={0.1}
        precision={1}
        disabled={locked}
        onAxis={setScale}
        trailing={
          <button
            type="button"
            className={`t3d-cam-xform-lock${scaleLocked ? ' is-on' : ''}`}
            title={scaleLocked ? t('inspector.scaleUnlock') : t('inspector.scaleLock')}
            aria-pressed={scaleLocked}
            onClick={() => setScaleLocked((v) => !v)}
          >
            {scaleLocked ? <IconLock /> : <IconUnlock />}
          </button>
        }
      />
    </div>
  )
}


const TRANSFORM_KEY_PROPS: TrackProp[] = ['position', 'rotation', 'scale']

/**
 * 「变换」标题栏：一次为该节点变换组全部维度打关键帧；已有则覆盖。机位含看点 / FOV。
 * 视口/对象树里多选时，这颗按钮给整批选中对象打键（一条 undo）。
 */
export function TransformKeyframeButton({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const userKeys = useStore((s) => s.userKeys)
  const selection = useStore((s) => s.selection)
  const addTransformKeyframes = useStore((s) => s.addTransformKeyframes)
  const frame = useThrottledFrame()
  const selectedIds = nodeIdsOf(selection)
  const targets = selectedIds.length > 1 && selectedIds.includes(nodeId) ? selectedIds : [nodeId]
  const motionLocked = targets.every((id) => cameraMotionOwnsKeyframes(doc, id))
  const keyed = targets.every((id) => {
    const type = doc?.content.nodes.find((n) => n.id === id)?.type
    const props = type ? xformPropsForNodeType(type) : TRANSFORM_KEY_PROPS
    return props.every((prop) => hasKeyAtFrame(userKeys[id]?.[prop], frame))
  })

  return (
    <KeyframeButton
      keyed={keyed}
      title={
        motionLocked
          ? t('timeline.keyframeSuspendedByMotion')
          : targets.length > 1
            ? t('timeline.addKeyframeMulti', { count: targets.length })
            : t('timeline.addKeyframeBundle')
      }
      disabled={locked || !doc || motionLocked}
      onClick={() => {
        if (locked || !doc || motionLocked) return
        addTransformKeyframes(targets)
      }}
    />
  )
}

export function ResetTransformButton({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const writeNodeTransform = useStore((s) => s.writeNodeTransform)
  return (
    <button
      type="button"
      className="t3d-inspector-section-icon"
      disabled={locked}
      title={t('inspector.resetTransform')}
      onClick={(e) => {
        e.stopPropagation()
        if (locked) return
        writeNodeTransform(nodeId, {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        })
      }}
    >
      <IconRotate />
    </button>
  )
}

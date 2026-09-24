import { Tooltip } from './Tooltip'
import { useNodeSnapshot } from '../../bridge/useEngineEvent'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { isLookAtPickTarget } from '../../stores/nodeSelection'
import { ToggleRow } from '../inspector/PosePanel'
import { IconCrosshair } from '../leftrail/icons'
import { displayNodeName } from '../displayNames'
import { Dropdown } from './Dropdown'
import { SliderNumberControl } from './SliderNumberControl'
import { TransformGroup, type TransformAxis } from './TransformGroup'

/**
 * 机位「看点」：选一个人物（或自由点），XYZ 是当前注视坐标。
 * 手动转向可解除看点目标，并保留原目标的位置跟随。
 * 改看点不自动打关键帧，只从时间轴「变换」主轨手工添加。
 */
export function CameraSubjectPanel({ cameraId }: { cameraId: string }) {
  const t = useT()
  const { useStore, stage } = useDirector()
  const doc = useStore((s) => s.doc)
  const {
    writeCameraLookAt,
    setCameraLookAtTarget,
    setCameraFollow,
    setCameraSubjectDistance,
    beginLookAtPick,
    cancelLookAtPick,
  } = useStore()
  const lookAtPickingId = useStore((s) => s.lookAtPickingId)
  const snap = useNodeSnapshot(cameraId)
  const cam = doc?.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  const personId = cam?.camera?.lookAtTarget?.nodeId || ''
  if (!doc || !cam?.camera) return null

  const targets = doc.content.nodes.filter((n) => isLookAtPickTarget(n, cameraId))
  const binding = cam.camera.subject
  const picking = lookAtPickingId === cameraId
  const following = Boolean(binding?.follow)
  const followTarget = following ? doc.content.nodes.find((node) => node.id === binding?.nodeId) : undefined
  const lookAt = snap?.lookAt?.length === 3
    ? { x: snap.lookAt[0], y: snap.lookAt[1], z: snap.lookAt[2] }
    : (cam.camera.lookAt ?? { x: 0, y: 1.2, z: 0 })
  const snapPos =
    snap?.position?.length === 3
      ? { x: snap.position[0], y: snap.position[1], z: snap.position[2] }
      : cam.transform.position
  const liveDistance = Math.hypot(
    snapPos.x - lookAt.x,
    snapPos.y - lookAt.y,
    snapPos.z - lookAt.z,
  )
  const distance = binding?.distance ?? (liveDistance || 1)

  const setLook = (axis: TransformAxis, value: number, commit = true) => {
    const latest = stage.getNodeSnapshot(cameraId)?.lookAt
    const current = latest?.length === 3 ? { x: latest[0], y: latest[1], z: latest[2] } : lookAt
    writeCameraLookAt(cameraId, { ...current, [axis]: value }, commit)
  }

  return (
    <div className="t3d-cam-aim">
      {targets.length === 0 ? (
        <div className="t3d-camera-subject-hint">{t('library.noLookAtTargets')}</div>
      ) : (
        <div className="t3d-cam-aim-target">
          <span>{t('library.pickLookAt')}</span>
          <Dropdown
            ariaLabel={t('library.pickLookAt')}
            value={personId}
            options={[
              { value: '', label: t('library.lookAtPoint') },
              ...targets.map((c) => ({ value: c.id, label: displayNodeName(t, c) })),
            ]}
            onChange={(id) => setCameraLookAtTarget(cameraId, id || null)}
          />
          <Tooltip label={t('help.lookAtPick')} side="top" variant="description">
            <button
              type="button"
              className={`t3d-cam-aim-pick${picking ? ' t3d-cam-aim-pick-active' : ''}`}
              aria-pressed={picking}
              onClick={() => (picking ? cancelLookAtPick() : beginLookAtPick(cameraId))}
            >
              <IconCrosshair />
              <span>{t('viewport.lookAt')}</span>
            </button>
          </Tooltip>
        </div>
      )}
      <TransformGroup
        label={t('timeline.lookAt')}
        helpText={t('help.lookAtCoordinates')}
        value={lookAt}
        step={0.1}
        precision={1}
        onAxis={setLook}
      />
      <ToggleRow
        label={t('library.startFollow')}
        helpText={t('library.followHelp')}
        checked={following}
        disabled={!personId && !following}
        onChange={(next) => setCameraFollow(next, cameraId, personId || undefined)}
      />
      {following && followTarget && binding?.nodeId !== personId ? (
        <div className="t3d-camera-subject-hint">{t('library.followingTarget', { name: displayNodeName(t, followTarget) })}</div>
      ) : null}
      <div className="t3d-camera-subject-row">
        <SliderNumberControl
          label={t('library.subjectDistance')}
          helpText={t('library.subjectDistanceHelp')}
          min={0.5}
          max={20}
          step={0.1}
          precision={2}
          unit="m"
          value={distance}
          onChange={(value) => setCameraSubjectDistance(value, cameraId)}
        />
      </div>
      {following && binding?.overridesMotion === false ? (
        <div className="t3d-camera-subject-hint">{t('library.subjectMotionOwns')}</div>
      ) : null}
    </div>
  )
}

import { useDirector } from '../../bridge/DirectorContext'
import { useNodeSnapshot } from '../../bridge/useEngineEvent'
import { useT } from '../../locale'
import { TransformGroup, type TransformAxis } from './TransformGroup'

/**
 * 机位「变换」：位移 / 旋转。看点在独立分区，跟跟随共用同一个人。
 * 旋转是相机物体欧拉角（度），改完按当前目标距离重算 lookAt。
 * 改值不自动打关键帧；整组键走属性栏 / 时间轴「变换」主轨。
 */
export function CameraTransformPanel({ cameraId }: { cameraId: string }) {
  const t = useT()
  const { useStore, stage } = useDirector()
  const doc = useStore((s) => s.doc)
  const { writeCameraWorldPos, writeCameraRotation, beginInteraction, endInteraction } = useStore()
  const snap = useNodeSnapshot(cameraId)
  if (!doc) return null

  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam) return null

  const pos = snap?.position?.length === 3
    ? { x: snap.position[0], y: snap.position[1], z: snap.position[2] }
    : cam.transform.position
  const rot = snap?.rotation?.length === 3
    ? { x: snap.rotation[0], y: snap.rotation[1], z: snap.rotation[2] }
    : cam.transform.rotation

  const setPos = (axis: TransformAxis, value: number, commit = true) => {
    const latest = stage.getNodeSnapshot(cameraId)?.position
    const current = latest?.length === 3 ? { x: latest[0], y: latest[1], z: latest[2] } : pos
    writeCameraWorldPos(cameraId, { ...current, [axis]: value }, commit)
  }
  const setRot = (axis: TransformAxis, value: number, commit = true) => {
    const latest = stage.getNodeSnapshot(cameraId)?.rotation
    const current = latest?.length === 3 ? { x: latest[0], y: latest[1], z: latest[2] } : rot
    writeCameraRotation(cameraId, { ...current, [axis]: value }, commit)
  }
  return (
    <div className="t3d-cam-xform">
      <TransformGroup
        label={t('timeline.position')}
        value={pos}
        step={0.1}
        precision={1}
        onAxis={setPos}
        onEditStart={beginInteraction}
        onEditEnd={() => endInteraction(t('timeline.position'))}
      />
      <TransformGroup
        label={t('timeline.rotation')}
        value={rot}
        step={0.1}
        precision={1}
        onAxis={setRot}
        onEditStart={beginInteraction}
        onEditEnd={() => endInteraction(t('timeline.rotation'))}
      />
    </div>
  )
}

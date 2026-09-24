import { useNodeSnapshot, useThrottledFrame } from '../../bridge/useEngineEvent'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../data/cameraLibrary'
import { cameraMotionOwnsKeyframes } from '../../evaluate/camera/cameraMotionExclusive'
import { hasKeyAtFrame, KeyframeButton } from './KeyframeButton'
import { SliderNumberControl } from './SliderNumberControl'

/**
 * 视场角：垂直 FOV 12–120°。拖滑条不自动打关键帧；钻石走 addKeyframe。
 */
export function CameraLensPanel({ cameraId }: { cameraId: string | null | undefined }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const userKeys = useStore((s) => s.userKeys)
  const { setCameraFov, addKeyframe } = useStore()
  const frame = useThrottledFrame()
  const snap = useNodeSnapshot(cameraId)
  if (!doc || !cameraId) return null

  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return null

  const fov = snap?.fov ?? cam.camera.fov
  const keyed = hasKeyAtFrame(userKeys[cameraId]?.fov, frame)
  const motionLocked = cameraMotionOwnsKeyframes(doc, cameraId)

  return (
    <div className="t3d-camera-subject-row">
      <SliderNumberControl
        label={t('library.lensFov')}
        helpText={t('help.fov')}
        min={CAMERA_FOV_MIN}
        max={CAMERA_FOV_MAX}
        step={1}
        precision={1}
        unit="°"
        value={fov}
        onChange={(value) => setCameraFov(value, cameraId)}
      />
      <KeyframeButton
        keyed={keyed}
        title={t(motionLocked ? 'timeline.keyframeSuspendedByMotion' : 'timeline.addKeyframe')}
        disabled={motionLocked}
        onClick={() => addKeyframe(cameraId, 'fov', [fov])}
      />
    </div>
  )
}

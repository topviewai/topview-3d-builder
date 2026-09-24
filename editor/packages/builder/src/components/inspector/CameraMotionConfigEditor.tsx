import { CAMERA_MOTIONS } from '../../data/cameraLibrary'
import type { CameraMotionClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { EasingCurveCards } from '../common/EasingCurveCards'
import { RangeSlider } from '../common/RangeSlider'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { EXTRA_PARAM_RANGE, PARAM_LABEL } from './constants'
import { FrameRangeRow } from './FrameRangeRow'

function ParamValue({
  value,
  min,
  max,
  step,
  precision,
  unit,
  ariaLabel,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  precision: number
  unit?: string
  ariaLabel?: string
  onChange: (next: number) => void
}) {
  return (
    <span className="t3d-inspector-param-value-unit">
      <ScrubNumberInput
        className="t3d-inspector-param-scrub"
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        ariaLabel={ariaLabel}
        onChange={onChange}
      />
      {unit ? <span className="t3d-inspector-param-unit">{unit}</span> : null}
    </span>
  )
}

export function CameraMotionConfigEditor({ clip, onDelete }: { clip: CameraMotionClip; onDelete?: () => void }) {
  const t = useT()
  const { useStore } = useDirector()
  const updateCameraMotionConfig = useStore((s) => s.updateCameraMotionConfig)
  const resizeCameraMotionClip = useStore((s) => s.resizeCameraMotionClip)
  const doc = useStore((s) => s.doc)
  const preset = CAMERA_MOTIONS.find((p) => p.id === clip.motion.presetId)
  if (!preset) return null
  const cfg = (clip.motion.metadata?.config ?? preset.defaultConfig) as Record<string, number | string>
  const extras = Object.keys(preset.defaultConfig).filter(
    (k) => !['durationMs', 'easing', 'strength', 'angleDeg'].includes(k) && EXTRA_PARAM_RANGE[k],
  )
  const patch = (k: string, v: number | string) => updateCameraMotionConfig(clip.id, { [k]: v })
  const defaults = preset.defaultConfig as Record<string, number | string>
  const easing = String(cfg.easing ?? preset.defaultConfig.easing)

  const tlStart = doc?.content.timeline.frameStart ?? 0
  const tlEnd = doc?.content.timeline.frameEnd ?? clip.frameEnd

  return (
    <>
      <FrameRangeRow
        start={clip.frameStart}
        end={clip.frameEnd}
        startMin={tlStart}
        startMax={clip.frameEnd - 1}
        endMin={clip.frameStart + 1}
        endMax={tlEnd}
        onStart={(n) => resizeCameraMotionClip(clip.id, 'start', n)}
        onEnd={(n) => resizeCameraMotionClip(clip.id, 'end', n)}
        onDelete={onDelete}
        deleteLabel={t('common.delete')}
      />

      <EasingCurveCards value={easing} onChange={(kind) => patch('easing', kind)} />

      {extras.map((k) => {
        const r = EXTRA_PARAM_RANGE[k]
        const v = Number(cfg[k] ?? defaults[k])
        const precision = r.step < 1 ? (String(r.step).split('.')[1]?.length ?? 1) : 0
        return (
          <div className="t3d-inspector-param t3d-inspector-param-grid" key={k}>
            <span className="t3d-inspector-param-label">{t(PARAM_LABEL[k] ?? k)}</span>
            <div className="t3d-inspector-param-controls">
              <RangeSlider
                min={r.min}
                max={r.max}
                step={r.step}
                value={v}
                onChange={(e) => patch(k, Number(e.target.value))}
              />
              <ParamValue
                value={v}
                min={r.min}
                max={r.max}
                step={r.step}
                precision={precision}
                ariaLabel={t(PARAM_LABEL[k] ?? k)}
                onChange={(n) => patch(k, n)}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

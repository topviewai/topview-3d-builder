import type { MotionClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { Dropdown } from '../common/Dropdown'
import { InspectorRangeDelete } from './FrameRangeRow'
import { ToggleRow } from './PosePanel'

const MOTION_SPEEDS = [1, 2, 3] as const

export function MotionClipConfigEditor({
  clip,
  onDelete,
}: {
  clip: MotionClip
  onDelete?: () => void
}) {
  const t = useT()
  const { useStore } = useDirector()
  const update = useStore((s) => s.updateMotionClipConfig)
  const patch = (key: string, value: number | string | boolean) => update(clip.id, { [key]: value })

  return (
    <div className="t3d-motion-clip-settings">
      <div className="t3d-inspector-title t3d-inspector-title-sub">
        {t('inspector.motionSettings')}
        {onDelete ? (
          <span className="t3d-inspector-title-action">
            <InspectorRangeDelete label={t('common.delete')} onClick={onDelete} />
          </span>
        ) : null}
      </div>
      <div className="t3d-inspector-kv">
        <span className="t3d-inspector-k">{t('inspector.clipSpeed')}</span>
        <span className="t3d-inspector-v">
          <span className="t3d-motion-speed" role="group" aria-label={t('inspector.clipSpeed')}>
            {MOTION_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={cx('t3d-motion-speed-btn', Math.abs(clip.playback.speed - speed) < 0.001 && 'is-active')}
                aria-pressed={Math.abs(clip.playback.speed - speed) < 0.001}
                onClick={() => patch('speed', speed)}
              >
                {speed}x
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="t3d-inspector-kv">
        <span className="t3d-inspector-k">{t('inspector.loopMode')}</span>
        <span className="t3d-inspector-v">
          <Dropdown
            value={clip.playback.loopMode}
            options={[
              { value: 'repeat', label: t('inspector.loopRepeat') },
              { value: 'ping-pong', label: t('inspector.loopPingPong') },
            ]}
            onChange={(next) => patch('loopMode', next)}
          />
        </span>
      </div>
      <ToggleRow
        label={t('inspector.loop')}
        checked={clip.playback.loop}
        onChange={(next) => patch('loop', next)}
      />
      <ToggleRow
        label={t('inspector.inPlaceMotion')}
        checked={clip.motion.inPlace}
        onChange={(next) => patch('inPlace', next)}
      />
    </div>
  )
}

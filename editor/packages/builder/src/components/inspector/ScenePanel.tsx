import type { ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { DEFAULT_SKY_COLOR } from '../../contract/skyColor'
import { useT } from '../../locale'
import { IconObject } from '../leftrail/icons'
import { ColorRow, InspectorSection, SliderRow, ToggleRow } from './PosePanel'

export function ScenePanel(): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const updateEnvironment = useStore((s) => s.updateEnvironment)
  const env = doc?.content.environment
  const sky = env?.background.skyColor ?? DEFAULT_SKY_COLOR
  const labels = env?.display.characterLabelsVisible !== false
  const ground = env?.display.groundVisible !== false
  const height = env?.display.groundHeight ?? 0
  const opacity = env?.display.groundOpacity ?? 1

  return (
    <div className="t3d-inspector">
      <div className="t3d-inspector-title">
        <IconObject className="t3d-inspector-title-icon" />
        {t('inspector.sceneTitle')}
      </div>
      <InspectorSection title={t('inspector.background')}>
        <ColorRow
          label={t('inspector.backgroundColor')}
          value={sky}
          onChange={(skyColor) => updateEnvironment({ skyColor })}
        />
      </InspectorSection>
      <InspectorSection title={t('inspector.display')}>
        <ToggleRow
          label={t('inspector.characterLabels')}
          checked={labels}
          onChange={(characterLabelsVisible) => updateEnvironment({ characterLabelsVisible })}
        />
        <ToggleRow
          label={t('inspector.ground')}
          checked={ground}
          onChange={(groundVisible) => updateEnvironment({ groundVisible })}
        />
        <SliderRow
          className="t3d-inspector-row-child"
          label={t('inspector.groundOpacity')}
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          step={1}
          disabled={!ground}
          display={`${Math.round(opacity * 100)}%`}
          onChange={(next) => updateEnvironment({ groundOpacity: next / 100 })}
        />
        <SliderRow
          className="t3d-inspector-row-child"
          label={t('inspector.height')}
          value={height}
          min={-2}
          max={2}
          step={0.01}
          unit="m"
          disabled={!ground}
          display={height.toFixed(2)}
          onChange={(groundHeight) => updateEnvironment({ groundHeight })}
        />
        {!ground && <p className="t3d-inspector-help">{t('inspector.groundDisabledHint')}</p>}
      </InspectorSection>
    </div>
  )
}

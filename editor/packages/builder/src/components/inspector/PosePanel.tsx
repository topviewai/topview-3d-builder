import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { findMotionClipAt } from '../../contract/parser'
import { DEFAULT_SKY_COLOR, normalizeSkyHex } from '../../contract/skyColor'
import type { DraftNode } from '../../contract/types'
import { POSE_CONTROLS, POSE_CONTROL_STEP, type PoseControl } from '../../data/poseControls'
import { useDirector } from '../../bridge/DirectorContext'
import { useThrottledFrame } from '../../bridge/useEngineEvent'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { FieldHelp } from '../common/FieldHelp'
import { RangeSlider } from '../common/RangeSlider'
import { SliderNumberControl } from '../common/SliderNumberControl'
import { Tooltip } from '../common/Tooltip'
import { IconChevron, IconRotate } from '../leftrail/icons'
import { PoseLibraryGrid } from './PoseLibraryGrid'

/**
 * 姿势面板：
 * 「姿势调整」可折叠区（默认展开）→「手动调整姿势」开关 → 子页签
 * 「姿势预设 | 姿势调节」。预设为姿势库图集网格，当前项高亮；开关关闭时
 * 调节滑杆禁用（预设随时可点）。
 */
export function PosePanel({ node }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const frame = useThrottledFrame()
  const poseEditingId = useStore((s) => s.poseEditingId)
  const { setPoseValue, resetPose, applyPosePreset, setPoseEditingId } = useStore()
  const [open, setOpen] = useState(true)
  const [manual, setManual] = useState(false)
  const [switchReady, setSwitchReady] = useState(false)
  const [subTab, setSubTab] = useState<'presets' | 'controls'>('presets')
  if (!doc || !node.character) return null

  const anim = node.character.animation
  const cv = anim.controlValues ?? {}
  const clipActive = !!findMotionClipAt(doc, node.id, frame)
  const editing = poseEditingId === node.id

  const groups: { name: string; items: PoseControl[] }[] = []
  for (const c of POSE_CONTROLS) {
    let g = groups.find((x) => x.name === c.group)
    if (!g) {
      g = { name: c.group, items: [] }
      groups.push(g)
    }
    g.items.push(c)
  }

  return (
    <div className="t3d-pose">
      <div
        className="t3d-inspector-title t3d-inspector-title-sub t3d-pose-section-head"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cx('t3d-pose-caret', open && 't3d-pose-caret-open')}>▸</span>
        {t('inspector.poseAdjust')}
        <span className="t3d-inspector-title-action">
          <Tooltip label={t(editing ? 'viewport.finishPose' : 'viewport.editPose')} side="top">
            <button
              type="button"
              className={cx('t3d-pose-edit-btn', editing && 'is-on')}
              aria-pressed={editing}
              aria-label={t('viewport.editPose')}
              disabled={node.locked}
              onClick={(e) => {
                e.stopPropagation()
                setPoseEditingId(editing ? null : node.id)
              }}
            >
              {t('viewport.editPose')}
            </button>
          </Tooltip>
          <Tooltip label={t('common.reset')} side="top">
            <button
              type="button"
              className="t3d-inspector-section-icon t3d-pose-reset"
              aria-label={t('common.reset')}
              disabled={node.locked}
              onClick={(e) => {
                e.stopPropagation()
                if (node.locked) return
                resetPose(node.id)
              }}
            >
              <IconRotate />
            </button>
          </Tooltip>
        </span>
      </div>
      {open && (
        <div className="t3d-pose-body">
          {anim.mode !== 'pose' && (
            <div className="t3d-pose-hint">{t('inspector.poseModeHint', { mode: anim.mode })}</div>
          )}
          {clipActive && (
            <div className="t3d-pose-hint">{t('inspector.poseClipHint')}</div>
          )}
          <div className="t3d-pose-manual">
            <span className="t3d-pose-manual-label">{t('inspector.poseManual')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={manual}
              className={cx('t3d-inspector-switch', manual && 'is-on', switchReady && 'is-init')}
              onClick={() => {
                setSwitchReady(true)
                const next = !manual
                setManual(next)
                if (next) setSubTab('controls')
              }}
            >
              <span className="t3d-inspector-switch-thumb" />
            </button>
          </div>
          <div className="t3d-pose-subtabs">
            <button
              type="button"
              className={cx('t3d-pose-subtab', subTab === 'presets' && 't3d-pose-subtab-active')}
              onClick={() => setSubTab('presets')}
            >
              {t('inspector.posePresets')}
            </button>
            <button
              type="button"
              className={cx('t3d-pose-subtab', subTab === 'controls' && 't3d-pose-subtab-active')}
              onClick={() => setSubTab('controls')}
            >
              {t('inspector.poseControls')}
            </button>
          </div>
          {subTab === 'presets' ? (
            <PoseLibraryGrid
              selectedId={anim.posePresetId}
              disabled={node.locked}
              onSelect={(id) => applyPosePreset(node.id, id)}
            />
          ) : (
            <div className={cx(!manual && 't3d-pose-controls-locked')}>
              {groups.map((g) => (
                <div key={g.name}>
                  <div className="t3d-pose-group">{t(`pose.group.${g.name}`)}</div>
                  {g.items.map((c) => {
                    const v = cv[c.key] ?? 0
                    return (
                      <div className="t3d-inspector-param" key={c.key}>
                        <span className="t3d-inspector-param-label">{t(`pose.label.${c.key}`)}</span>
                        <RangeSlider
                          min={c.min}
                          max={c.max}
                          step={POSE_CONTROL_STEP}
                          value={v}
                          disabled={!manual}
                          onChange={(e) => setPoseValue(node.id, c.key, Number(e.target.value))}
                        />
                        <span className="t3d-inspector-param-value">{Math.round(v)}°</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function InspectorSection({
  title,
  children,
  defaultOpen = true,
  collapsible = true,
  extra,
}: {
  title: string
  children?: ReactNode
  defaultOpen?: boolean
  collapsible?: boolean
  extra?: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  return (
    <section className="t3d-inspector-section">
      <div className="t3d-inspector-section-head-row">
        {collapsible ? (
          <button
            type="button"
            className="t3d-inspector-section-head"
            aria-disabled="false"
            onClick={() => setOpen((v) => !v)}
          >
            <IconChevron className={cx('t3d-inspector-chevron', open && 'is-open')} />
            {title}
          </button>
        ) : (
          <div className="t3d-inspector-section-head is-static">{title}</div>
        )}
        {extra}
      </div>
      {shown && children != null ? <div className="t3d-inspector-section-body">{children}</div> : null}
    </section>
  )
}

export function ToggleRow({
  label,
  helpText,
  checked,
  onChange,
  disabled,
}: {
  label: string
  helpText?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): ReactElement {
  const [ready, setReady] = useState(false)
  return (
    <label className="t3d-inspector-row">
      <span>{label}{helpText && <FieldHelp text={helpText} />}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={cx('t3d-inspector-switch', checked && 'is-on', ready && 'is-init')}
        onClick={() => {
          if (disabled) return
          setReady(true)
          onChange(!checked)
        }}
      >
        <span className="t3d-inspector-switch-thumb" />
      </button>
    </label>
  )
}

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const pickingRef = useRef(false)
  onChangeRef.current = onChange
  const hex = normalizeHex(value)

  // 取色器打开时回写 value 会让 Chromium 不再派发后续 input，选完色就点不动。
  useEffect(() => {
    const input = inputRef.current
    if (!input || pickingRef.current) return
    if (input.value.toLowerCase() !== hex.toLowerCase()) input.value = hex
  }, [hex])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const finish = () => {
      onChangeRef.current(input.value)
      // React 的 onChange 也会接到这次 change，并在本轮把 picking 再置上。
      // 微任务里再清掉，关掉取色器之后才能继续同步。
      queueMicrotask(() => {
        pickingRef.current = false
      })
    }
    const stop = () => {
      pickingRef.current = false
    }
    input.addEventListener('change', finish)
    input.addEventListener('blur', stop)
    return () => {
      input.removeEventListener('change', finish)
      input.removeEventListener('blur', stop)
    }
  }, [])

  return (
    <label className="t3d-inspector-row">
      <span>{label}</span>
      <span className="t3d-inspector-color">
        <span className="t3d-inspector-swatch" style={{ backgroundColor: hex }}>
          <input
            ref={inputRef}
            type="color"
            defaultValue={hex}
            aria-label={label}
            onPointerDown={() => {
              pickingRef.current = true
            }}
            onChange={(e) => {
              pickingRef.current = true
              onChange(e.target.value)
            }}
          />
        </span>
        <em>{hex}</em>
      </span>
    </label>
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  unit,
  disabled,
  className,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  unit?: string
  disabled?: boolean
  className?: string
  onChange: (next: number) => void
}): ReactElement {
  return (
    <div className={cx('t3d-inspector-row t3d-inspector-row-inline', className)}>
      <SliderNumberControl label={label} min={min} max={max} step={step} value={value}
        precision={step >= 1 ? 0 : 2} unit={unit ?? (display.endsWith('%') ? '%' : '')}
        disabled={disabled} onChange={onChange} />
    </div>
  )
}

export { XyzRow } from '../common/TransformGroup'

export function FieldRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="t3d-inspector-row">
      <span>{label}</span>
      <em>{value}</em>
    </div>
  )
}

function normalizeHex(value: string): string {
  return normalizeSkyHex(value) ?? DEFAULT_SKY_COLOR
}

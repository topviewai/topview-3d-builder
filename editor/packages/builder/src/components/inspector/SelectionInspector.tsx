import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { assetNameLabel } from '../../locale/assetLabels'
import { findNode } from '../../contract/parser'
import type { DraftNode } from '../../contract/types'
import type { TrackProp } from '../../evaluate/curves/KeyframeTrack'
import { nodeIdsOf } from '../../stores/nodeSelection'
import { clipRefsOf, keyframeRefsOf } from '../../stores/types'
import { FC_PROP_PATH, xformPropsForNodeType } from '../timeline/constants'
import { EasingCurveCards, normalizeEasingKind } from '../common/EasingCurveCards'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { CameraMotionConfigEditor } from './CameraMotionConfigEditor'
import { MotionClipConfigEditor } from './MotionClipConfigEditor'
import { FrameRangeRow } from './FrameRangeRow'
import { ScenePanel } from './ScenePanel'
import { CharacterInspector, MultiNodeInspector, NodePanel, PropInspector } from './NodeInspectors'
import { displayCameraMotionName, displayPathName } from '../displayNames'

export function SelectionInspector() {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const userKeys = useStore((s) => s.userKeys)
  const fcurves = useStore((s) => s.fcurves)
  const {
    select,
    setKeyframesInterp,
    setTransformKeysInterpAtFrame,
    removeTransformKeysAtFrame,
    moveKeyframes,
    removeKeyframes,
    deleteSelection,
    resizePathMotionClip,
  } = useStore()

  if (!doc) return <div className="t3d-inspector">{t('common.loading')}</div>
  if (!selection) return <ScenePanel />

  const selectedClips = clipRefsOf(selection)
  if (selectedClips.length > 1) {
    const keys = keyframeRefsOf(selection)
    return (
      <div className="t3d-inspector">
        <div className="t3d-inspector-title">{t('inspector.selectedClips', { count: selectedClips.length })}</div>
        <div className="t3d-inspector-section-body">
          {keys.length > 0 && <p>{t('inspector.selectedKeys', { count: keys.length })}</p>}
          <button type="button" className="t3d-inspector-mini" onClick={deleteSelection}>{t('common.delete')}</button>
        </div>
      </div>
    )
  }

  let sel = selection
  if (sel.kind === 'timelineBox') {
    if (sel.keys.length > 0) {
      const primary = sel.keys[sel.keys.length - 1]
      sel = {
        kind: 'keyframe',
        nodeId: primary.nodeId,
        prop: primary.prop,
        keyId: primary.keyId,
        keys: sel.keys.length > 1 ? sel.keys : undefined,
      }
    } else if (sel.clips.length > 0) {
      const primary = sel.clips[sel.clips.length - 1]
      sel = {
        kind: 'clip',
        clipType: primary.clipType,
        clipId: primary.clipId,
        clips: sel.clips.length > 1 ? sel.clips : undefined,
      }
    }
  }

  if (sel.kind === 'node') {
    const ids = nodeIdsOf(sel)
    if (ids.length > 1) {
      const picked = ids
        .map((id) => findNode(doc, id))
        .filter((node): node is DraftNode => !!node)
      if (picked.length > 1) return <MultiNodeInspector nodes={picked} />
    }
    const n = findNode(doc, sel.nodeId)
    if (!n) return <div className="t3d-inspector">{t('inspector.emptyNode')}</div>
    if (n.type === 'character') return <CharacterInspector key={n.id} node={n} />
    if (n.type === 'prop') return <PropInspector key={n.id} node={n} />
    return <NodePanel node={n} />
  }

  if (sel.kind === 'clip') {
    const clipSel = sel
    const anim = doc.content.timeline.animation
    if (clipSel.clipType === 'camera') {
      const c = anim.cameraMotionClips.find((x) => x.id === clipSel.clipId)
      if (!c) return <div className="t3d-inspector">{t('inspector.emptyClip')}</div>
      return (
        <div className="t3d-inspector">
          <div className="t3d-inspector-title">{t('inspector.cameraMotionTitle', { name: displayCameraMotionName(t, c) })}</div>
          <CameraMotionConfigEditor
            clip={c}
            onDelete={deleteSelection}
          />
        </div>
      )
    }
    if (clipSel.clipType === 'motion') {
      const c = anim.motionClips.find((x) => x.id === clipSel.clipId)
      if (!c) return <div className="t3d-inspector">{t('inspector.emptyClip')}</div>
      return (
        <div className="t3d-inspector">
          <div className="t3d-inspector-title">{t('inspector.motionTitle', { name: assetNameLabel(t, c.motion.name, 'motion') })}</div>
          <MotionClipConfigEditor clip={c} onDelete={deleteSelection} />
        </div>
      )
    }
    const c = anim.pathMotionClips.find((x) => x.id === clipSel.clipId)
    if (!c) return <div className="t3d-inspector">{t('inspector.emptyClip')}</div>
    const tlStart = doc.content.timeline.frameStart
    const tlEnd = doc.content.timeline.frameEnd
    return (
      <div className="t3d-inspector">
        <div className="t3d-inspector-title">{t('inspector.pathWalkTitle', { name: displayPathName(t, c.pathName) })}</div>
        <FrameRangeRow
          start={c.frameStart}
          end={c.frameEnd}
          startMin={tlStart}
          startMax={c.frameEnd - 1}
          endMin={c.frameStart + 1}
          endMax={tlEnd}
          onStart={(n) => resizePathMotionClip(c.id, 'start', n)}
          onEnd={(n) => resizePathMotionClip(c.id, 'end', n)}
          onDelete={deleteSelection}
          deleteLabel={t('common.delete')}
        />
      </div>
    )
  }

  if (sel.kind === 'transformKeyframe') {
    const { nodeId, frame } = sel
    const node = findNode(doc, nodeId)
    if (!node) return <div className="t3d-inspector">{t('inspector.emptyNode')}</div>
    const uk = userKeys[nodeId]
    const matchingKeys: { prop: TrackProp; keyId: string; interpolation?: string }[] = []
    if (uk) {
      for (const [prop, track] of Object.entries(uk)) {
        const kf = track?.find((k) => k.frame === frame)
        if (kf) {
          matchingKeys.push({ prop: prop as TrackProp, keyId: kf.id, interpolation: kf.interpolation })
        }
      }
    }
    const hasFcKey =
      !!fcurves &&
      xformPropsForNodeType(node.type).some((prop) => {
        const propPath = FC_PROP_PATH[prop]
        const comps = prop === 'fov' ? 1 : 3
        return Array.from({ length: comps }, (_, i) => i).some((i) =>
          fcurves.getKeyAt(nodeId, propPath, i, frame),
        )
      })
    if (matchingKeys.length === 0 && !hasFcKey) {
      return <div className="t3d-inspector">{t('inspector.emptyKeyframe')}</div>
    }

    const tl = doc.content.timeline
    const frameStart = tl.frameStart ?? 0
    const frameEnd = tl.frameEnd ?? 0
    const setFrame = (nextFrame: number) => {
      const rounded = Math.round(nextFrame)
      if (rounded === frame) return
      if (matchingKeys.length > 0) {
        moveKeyframes(
          matchingKeys.map(({ prop, keyId }) => ({
            nodeId,
            prop,
            keyId,
            newFrame: rounded,
          })),
        )
        select({ kind: 'transformKeyframe', nodeId, frame: rounded })
      }
    }

    const bundleEasings = new Set(matchingKeys.map((key) => normalizeEasingKind(key.interpolation)))
    const currentInterp = bundleEasings.size > 1 ? null : matchingKeys[0]?.interpolation ?? 'ease-in-out'

    return (
      <div className="t3d-inspector">
        <div className="t3d-inspector-title">
          <span className="t3d-inspector-title-text">{t('inspector.keyframePanelTitle')}</span>
          <span className="t3d-inspector-frame-field" title={t('timeline.frame')}>
            <i>F</i>
            <ScrubNumberInput
              className="t3d-scrub-input"
              value={frame}
              step={1}
              precision={0}
              min={frameStart}
              max={frameEnd}
              ariaLabel={t('inspector.keyframeFrameBadge', { frame })}
              onChange={setFrame}
              commitOnRelease
            />
          </span>
        </div>
        <EasingCurveCards
          value={currentInterp}
          onChange={(kind) => setTransformKeysInterpAtFrame(nodeId, frame, kind)}
        />
      </div>
    )
  }

  if (sel.kind !== 'keyframe') {
    return <div className="t3d-inspector">{t('inspector.emptyKeyframe')}</div>
  }
  const { nodeId, prop, keyId } = sel
  const kf = (userKeys[nodeId]?.[prop] ?? []).find((k) => k.id === keyId)
  if (!kf) return <div className="t3d-inspector">{t('inspector.emptyKeyframe')}</div>
  const refs = keyframeRefsOf(sel)
  const selectedKeys = refs.flatMap((ref) =>
    (userKeys[ref.nodeId]?.[ref.prop] ?? []).filter((key) => key.id === ref.keyId),
  )
  const easings = new Set(selectedKeys.map((key) => normalizeEasingKind(key.interpolation)))
  const tl = doc.content.timeline
  const frameStart = tl.frameStart ?? 0
  const frameEnd = tl.frameEnd ?? 0
  const setFrame = (nextFrame: number) => {
    const rounded = Math.round(nextFrame)
    if (rounded === kf.frame) return
    const refs = keyframeRefsOf(sel)
    // Primary key leads; moveKeyframes rigid-translates the whole multi-select group.
    moveKeyframes([
      { nodeId, prop, keyId, newFrame: rounded },
      ...refs
        .filter((ref) => ref.keyId !== keyId)
        .map((ref) => ({
          ...ref,
          newFrame:
            userKeys[ref.nodeId]?.[ref.prop]?.find((item) => item.id === ref.keyId)?.frame ?? rounded,
        })),
    ])
  }
  return (
    <div className="t3d-inspector">
      <div className="t3d-inspector-title">
        <span className="t3d-inspector-title-text">{selectedKeys.length > 1
          ? t('inspector.selectedKeys', { count: selectedKeys.length })
          : t('inspector.keyframePanelTitle')}</span>
        <span className="t3d-inspector-frame-field" title={t('timeline.frame')}>
          <i>F</i>
          <ScrubNumberInput
            className="t3d-scrub-input"
            value={kf.frame}
            step={1}
            precision={0}
            min={frameStart}
            max={frameEnd}
            ariaLabel={t('inspector.keyframeFrameBadge', { frame: kf.frame })}
            onChange={setFrame}
            commitOnRelease
          />
        </span>
      </div>
      {selectedKeys.length > 1 && <p className="t3d-inspector-help">{t('inspector.multiKeyEditHint')}</p>}
      <EasingCurveCards
        value={easings.size > 1 ? null : kf.interpolation}
        onChange={(kind) => setKeyframesInterp(refs, kind)}
      />
    </div>
  )
}

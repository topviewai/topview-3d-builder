import type { TrackProp, UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { type KeyframeRef, type Selection } from '../../stores/types'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'
import { selectedKeyframeDragItems, useKeyframeDrag } from './hooks/useKeyframeDrag'
import { useSnapFrame } from './hooks/useSnapFrame'
import type { TimelineSummary } from './types'
import {
bundlePreviewOffset,
collectFrameBundles,
isGroupKeyframeSelected,
isKeyframeHighlighted,
isSameSelection,
keyframePreviewOffset,
nextKeyframeSelection
} from './utils'

import { isAdditiveMod } from './utils/trackRow'

function IconDiamond() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.7a2.41 2.41 0 0 0-3.41 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AddKeyframeButton({
  label,
  name,
  onClick,
  locked,
  lockedHint,
}: {
  label: string
  name: string
  onClick: () => void
  locked?: boolean
  lockedHint?: string
}) {
  const text = locked && lockedHint ? lockedHint : `${label}: ${name}`
  return (
    <Tooltip label={text} side="top" delay={120} showOnFocus>
      <button
        type="button"
        className="t3d-timeline-kf-add"
        aria-label={text}
        disabled={locked}
        onClick={(e) => {
          e.stopPropagation()
          if (locked) return
          onClick()
        }}
      >
        <IconDiamond />
      </button>
    </Tooltip>
  )
}

export function GhostKeyframes({
  summary,
  frameStart,
  pxPerFrame,
  userKeys,
  selection,
  readOnly = false,
  onSelect,
  onSeek,
  onMoveKeyframes,
}: {
  summary: TimelineSummary
  frameStart: number
  pxPerFrame: number
  userKeys: UserKeys
  selection: Selection | null
  readOnly?: boolean
  onSelect: (next: Selection) => void
  onSeek: (frame: number) => void
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
}) {
  const snap = useSnapFrame(pxPerFrame)
  const drag = useKeyframeDrag(pxPerFrame, onMoveKeyframes, snap)
  const previewDf = drag.previewDf
  const draggingKeyIds = drag.draggingKeyIds
  return summary.kfTracks.flatMap(({ nodeId, prop }) =>
    (userKeys[nodeId]?.[prop] ?? []).map((kf) => (
      <div
        key={`g-uk-${kf.id}`}
        className={cx(
          't3d-timeline-kf',
          't3d-timeline-kf-ghost',
          isKeyframeHighlighted(selection, { keyId: kf.id, nodeId, frame: kf.frame }) &&
            't3d-timeline-kf-selected',
        )}
        data-kf-node={nodeId}
        data-kf-prop={prop}
        data-kf-id={kf.id}
                data-timeline-key-tokens={JSON.stringify([kf.id])}
        style={{
                  left:
                    (kf.frame -
                      frameStart +
                      keyframePreviewOffset(previewDf, kf.id, draggingKeyIds)) *
                    pxPerFrame,
                }}
        onPointerDown={(e) => {
          e.stopPropagation()
          const clicked: KeyframeRef = { nodeId, prop, keyId: kf.id }
          const next = nextKeyframeSelection(selection, clicked, isAdditiveMod(e), kf.frame)
          if (next !== selection) onSelect(next)
          onSeek(kf.frame)
          if (!readOnly) drag.begin(e, selectedKeyframeDragItems(next, userKeys))
        }}
        onPointerMove={readOnly ? undefined : drag.move}
        onPointerUp={readOnly ? undefined : drag.end}
        onPointerCancel={readOnly ? undefined : drag.cancel}
      />
    )),
  )
}

export function AggregateKeyframes({
  nodeId,
  props,
  frameStart,
  pxPerFrame,
  userKeys,
  selection,
  muted = false,
  readOnly = false,
  mutedHint,
  onSelect,
  onSeek,
  onMoveKeyframes,
}: {
  nodeId: string
  props: TrackProp[]
  frameStart: number
  pxPerFrame: number
  userKeys: UserKeys
  selection: Selection | null
  muted?: boolean
  readOnly?: boolean
  mutedHint?: string
  onSelect: (next: Selection) => void
  onSeek: (frame: number) => void
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
}) {
  const snap = useSnapFrame(pxPerFrame)
  const drag = useKeyframeDrag(pxPerFrame, onMoveKeyframes, snap)
  const previewDf = muted || readOnly ? null : drag.previewDf
  const draggingKeyIds = muted || readOnly ? null : drag.draggingKeyIds
  return collectFrameBundles(nodeId, props, userKeys).map((bundle) => {
    const lead = bundle.refs[0]
    if (!lead) return null
    const selected = isGroupKeyframeSelected(selection, nodeId, bundle.frame, bundle.refs)
    const bundleKeyIds = bundle.refs.map((r) => r.keyId)
    const diamond = (
      <div
        key={`agg-${nodeId}-${bundle.frame}`}
        className={cx(
          't3d-timeline-kf',
          selected && 't3d-timeline-kf-selected',
          muted && 't3d-timeline-kf-suspended',
        )}
        data-kf-node={lead.nodeId}
        data-kf-prop={lead.prop}
        data-kf-id={lead.keyId}
        data-timeline-key-tokens={JSON.stringify(bundleKeyIds)}
        data-kf-bundle={JSON.stringify(bundle.refs)}
        style={{
          left:
            (bundle.frame -
              frameStart +
              bundlePreviewOffset(previewDf, bundleKeyIds, draggingKeyIds)) *
            pxPerFrame,
        }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          if (muted) {
            onSeek(bundle.frame)
            return
          }
          const next: Selection = { kind: 'transformKeyframe', nodeId, frame: bundle.frame }
          if (!isSameSelection(selection, next)) onSelect(next)
          onSeek(bundle.frame)
          if (!readOnly) drag.begin(e, bundle.refs.map((ref) => ({ ...ref, origFrame: bundle.frame })))
        }}
        onPointerMove={muted || readOnly ? undefined : drag.move}
        onPointerUp={muted || readOnly ? undefined : drag.end}
        onPointerCancel={muted || readOnly ? undefined : drag.cancel}
      />
    )
    if (muted && mutedHint) {
      return (
        <Tooltip key={`agg-${nodeId}-${bundle.frame}`} label={mutedHint} side="top" delay={120}>
          {diamond}
        </Tooltip>
      )
    }
    return diamond
  })
}

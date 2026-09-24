import type { CameraMotionClip, MotionClip, PathMotionClip } from '../../contract/types'
import { useT } from '../../locale'
import { assetNameLabel } from '../../locale/assetLabels'
import { isClipSelected, type Selection } from '../../stores/types'
import { displayCameraMotionName } from '../displayNames'
import { ClipBlock } from './ClipBlock'

import { box } from './utils/trackRow'

export function CameraClips({
  clips,
  ghost,
  frameStart,
  pxPerFrame,
  selection,
  onSelect,
}: {
  clips: CameraMotionClip[]
  ghost: boolean
  frameStart: number
  pxPerFrame: number
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const t = useT()
  return clips.map((c) => (
    <ClipBlock
      key={c.id}
      kind="camera"
      ghost={ghost}
      selected={!ghost && isClipSelected(selection, c.id)}
      {...box(frameStart, pxPerFrame, c.frameStart, c.frameEnd)}
      label={displayCameraMotionName(t, c)}
      clipId={c.id}
      frameStart={c.frameStart}
      frameEnd={c.frameEnd}
      pxPerFrame={pxPerFrame}
      onSelect={ghost ? undefined : () => onSelect({ kind: 'clip', clipType: 'camera', clipId: c.id })}
    />
  ))
}

export function MotionClips({
  clips,
  ghost,
  frameStart,
  pxPerFrame,
  selection,
  onSelect,
}: {
  clips: MotionClip[]
  ghost: boolean
  frameStart: number
  pxPerFrame: number
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const t = useT()
  return clips.map((c) => (
    <ClipBlock
      key={c.id}
      kind="motion"
      ghost={ghost}
      selected={!ghost && isClipSelected(selection, c.id)}
      {...box(frameStart, pxPerFrame, c.frameStart, c.frameEnd)}
      label={assetNameLabel(t, c.motion.name, 'motion')}
      clipId={c.id}
      frameStart={c.frameStart}
      frameEnd={c.frameEnd}
      pxPerFrame={pxPerFrame}
      onSelect={ghost ? undefined : () => onSelect({ kind: 'clip', clipType: 'motion', clipId: c.id })}
    />
  ))
}

export function PathClips({
  clips,
  ghost,
  frameStart,
  pxPerFrame,
  selection,
  onSelect,
}: {
  clips: PathMotionClip[]
  ghost: boolean
  frameStart: number
  pxPerFrame: number
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const t = useT()
  return clips.map((c) => (
    <ClipBlock
      key={c.id}
      kind="path"
      ghost={ghost}
      locked={c.locked}
      selected={!ghost && isClipSelected(selection, c.id)}
      {...box(frameStart, pxPerFrame, c.frameStart, c.frameEnd)}
      label={t('timeline.pathClipLabel')}
      clipId={c.id}
      frameStart={c.frameStart}
      frameEnd={c.frameEnd}
      pxPerFrame={pxPerFrame}
      onSelect={ghost ? undefined : () => onSelect({ kind: 'clip', clipType: 'path', clipId: c.id })}
    />
  ))
}

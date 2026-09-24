import { useEffect, useMemo, useState } from 'react'
import {
  isPoseLibraryPoseSelected,
  type PoseLibraryRecord,
} from '../../data/poseLibraryBank'
import { useDirector } from '../../bridge/DirectorContext'
import { hydratePoseBank, isPoseLibraryCatalogHydrated } from './hydratePoseBank'
import { useT } from '../../locale'
import { cx } from '../common/cx'

const POSE_ATLAS_SKELETON_COUNT = 8

const TAG_LABEL: Record<string, string> = {
  all: 'inspector.poseTagAll',
  common: 'inspector.poseTagCommon',
  stand: 'inspector.poseTagStand',
  sit: 'inspector.poseTagSit',
  lie: 'inspector.poseTagLie',
  move: 'inspector.poseTagMove',
  action: 'inspector.poseTagAction',
}

export function PoseLibraryGrid({
  selectedId,
  disabled,
  onSelect,
}: {
  selectedId?: string
  disabled?: boolean
  onSelect: (id: string) => void
}) {
  const t = useT()
  const { adapter, stage } = useDirector()
  const [tag, setTag] = useState('all')
  const [catalogGen, setCatalogGen] = useState(0)
  const [loading, setLoading] = useState(() => !isPoseLibraryCatalogHydrated(stage.poseBank))

  useEffect(() => {
    let cancelled = false
    if (!isPoseLibraryCatalogHydrated(stage.poseBank)) setLoading(true)
    void hydratePoseBank(adapter, stage.poseBank).finally(() => {
      if (cancelled) return
      setLoading(false)
      setCatalogGen((value) => value + 1)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, stage])

  const tags = useMemo(() => stage.poseBank.listTags(), [catalogGen, stage])
  const poses = useMemo(() => stage.poseBank.list(tag), [catalogGen, stage, tag])
  const tabs = loading ? (['all'] as const) : (['all', ...tags] as const)

  useEffect(() => {
    if (tag !== 'all' && !tags.includes(tag)) setTag('all')
  }, [tag, tags])

  return (
    <div className="t3d-pose-bank">
      <div className="t3d-pose-tags" role="tablist">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tag === item}
            className={cx('t3d-pose-tag', tag === item && 'is-active')}
            onClick={() => setTag(item)}
          >
            {TAG_LABEL[item] ? t(TAG_LABEL[item]) : item}
          </button>
        ))}
      </div>
      <div className="t3d-pose-atlas" key={catalogGen} aria-busy={loading}>
        {loading ? (
          Array.from({ length: POSE_ATLAS_SKELETON_COUNT }, (_, index) => (
            <span key={`skel-${index}`} className="t3d-pose-atlas-cell is-skel" aria-hidden>
              <span className="t3d-pose-atlas-skel" />
            </span>
          ))
        ) : (
          poses.map((pose) => {
            const active = isPoseLibraryPoseSelected(selectedId, pose.id)
            return (
              <button
                key={pose.id}
                type="button"
                disabled={disabled}
                title={pose.nameZh || pose.name}
                aria-label={pose.nameZh || pose.name}
                aria-pressed={active}
                className={cx('t3d-pose-atlas-cell', active && 'is-active')}
                onClick={() => onSelect(pose.id)}
              >
                <span className="t3d-pose-atlas-crop">
                  <PoseCover pose={pose} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function PoseCover({ pose }: { pose: PoseLibraryRecord }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
  }, [pose.coverUrl])
  if (!pose.coverUrl) {
    return <span className="t3d-pose-atlas-empty" />
  }
  return (
    <>
      {!ready ? <span className="t3d-pose-atlas-skel" aria-hidden /> : null}
      <img alt="" src={pose.coverUrl} draggable={false} onLoad={() => setReady(true)} />
    </>
  )
}

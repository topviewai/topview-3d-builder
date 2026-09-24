import type { ReactElement, ReactNode } from 'react'
import { CAMERA_MOTIONS, CAMERA_PRESETS, MOTION_CATEGORY_ORDER } from '../../data/cameraLibrary'
import type { CharacterLibEntry, HostAdapter, MotionLibEntry, PropLibEntry } from '../../host/types'
import type { TranslateFn } from '../../locale'
import { assetCategoryLabel, assetNameLabel } from '../../locale/assetLabels'
import { cx } from '../common/cx'
import { AssetCard } from './AssetCard'
import { CameraMotionThumb, CameraPresetThumb } from './CameraLibraryThumb'
import {
  ALL_CHIP,
  CAMERA_MOTION_CATEGORY_LABEL,
  PRIMITIVE_CHIP,
  PRIMITIVES,
} from './constants'
import { useHoverPreview } from './hooks/useHoverPreview'
import { catalogPreviewSrc, groupByCategory, matchesQuery, sectionDomId, tOr, uniqueCategories } from './utils'

const CATALOG_SKELETON_COUNT = 8

function CatalogSkeleton({ variant }: { variant?: 'motion' }): ReactElement {
  return (
    <div
      className={cx(
        't3d-leftrail-grid',
        variant === 'motion' && 't3d-leftrail-grid-motion',
        't3d-leftrail-catalog-skel',
      )}
      aria-busy="true"
    >
      {Array.from({ length: CATALOG_SKELETON_COUNT }, (_, index) => (
        <div
          key={index}
          className={cx('t3d-leftrail-card', 't3d-leftrail-card-skel', variant === 'motion' && 't3d-leftrail-card-motion')}
          aria-hidden
        >
          <div className="t3d-leftrail-card-preview">
            <span className="t3d-leftrail-skel" />
          </div>
          <span className="t3d-leftrail-skel-line" />
        </div>
      ))}
    </div>
  )
}

function CatalogGroups({ children }: { children: ReactNode }): ReactElement {
  return <div className="t3d-leftrail-catalog-groups">{children}</div>
}

export function CatalogSection({
  id,
  title,
  children,
  gridClass,
}: {
  id: string
  title: string
  children: ReactNode
  gridClass?: string
}): ReactElement {
  return (
    <section id={id} className="t3d-leftrail-section">
      <div className="t3d-leftrail-section-title">{title}</div>
      <div className={cx('t3d-leftrail-grid', gridClass)}>{children}</div>
    </section>
  )
}

type Hover = ReturnType<typeof useHoverPreview>

export function CharacterList({
  items,
  busyKey,
  t,
  adapter,
  hover,
  onPick,
}: {
  items: CharacterLibEntry[] | null
  busyKey: string | null
  t: TranslateFn
  adapter: HostAdapter
  hover: Hover
  onPick: (c: CharacterLibEntry) => void
}): ReactElement {
  if (items === null) return <CatalogSkeleton />
  if (items.length === 0) return <div className="t3d-leftrail-empty">{t('library.emptyCharacters')}</div>
  const groups = groupByCategory(items)
  const named = groups.filter((group) => group.category)
  const untitled = groups.find((group) => !group.category)?.items ?? []
  const cards = (list: CharacterLibEntry[]) =>
    list.map((c) => (
      <AssetCard
        key={c.id}
        name={assetNameLabel(t, c.name, 'character')}
        previewKey={catalogPreviewSrc(c.coverUrl, c.cover)}
        busy={busyKey === `chr-${c.id}`}
        disabled={busyKey !== null}
        adapter={adapter}
        onClick={() => onPick(c)}
        onHoverStart={hover.onEnter}
        onHoverEnd={hover.onLeave}
      />
    ))
  if (named.length === 0) {
    return <div className="t3d-leftrail-grid t3d-leftrail-catalog-ready">{cards(items)}</div>
  }
  return (
    <CatalogGroups>
      {untitled.length > 0 ? (
        <CatalogSection id={sectionDomId('character', ALL_CHIP)} title={t('library.categoryAll')}>
          {cards(untitled)}
        </CatalogSection>
      ) : null}
      {named.map((group) => (
        <CatalogSection key={group.category} id={sectionDomId('character', group.category)} title={assetCategoryLabel(t, group.category)}>
          {cards(group.items)}
        </CatalogSection>
      ))}
    </CatalogGroups>
  )
}

function LoadMoreStatus({
  loaded,
  total,
  loading,
  t,
}: {
  loaded: number
  total: number
  loading: boolean
  t: TranslateFn
}): ReactElement {
  return (
    <div className="t3d-leftrail-more" aria-live="polite">
      {loading ? t('common.loading') : t('library.loadMore', { loaded, total })}
    </div>
  )
}

export function PropList({
  items,
  query,
  filter,
  hasMore,
  loadingMore,
  loaded,
  total,
  busyKey,
  t,
  adapter,
  hover,
  onProp,
  onPrimitive,
}: {
  items: PropLibEntry[] | null
  query: string
  filter: string
  hasMore: boolean
  loadingMore: boolean
  loaded: number
  total: number
  busyKey: string | null
  t: TranslateFn
  adapter: HostAdapter
  hover: Hover
  onProp: (p: PropLibEntry) => void
  onPrimitive: (g: (typeof PRIMITIVES)[number]) => void
}): ReactElement {
  if (items === null) return <CatalogSkeleton />
  const showPrimitives = filter === ALL_CHIP || filter === PRIMITIVE_CHIP
  const primitives = showPrimitives ? PRIMITIVES.filter((g) => matchesQuery(t(g.nameKey), query)) : []
  const groups = filter === PRIMITIVE_CHIP ? [] : groupByCategory(items)
  const empty = primitives.length === 0 && groups.every((g) => g.items.length === 0)
  if (empty) return <div className="t3d-leftrail-empty">{t('library.emptyAssets')}</div>
  return (
    <CatalogGroups key={`${filter}:${query}`}>
      {primitives.length > 0 ? (
        <CatalogSection id={sectionDomId('prop', PRIMITIVE_CHIP)} title={t('library.categoryPrimitives')}>
          {primitives.map((g) => (
            <AssetCard
              key={g.kind}
              name={t(g.nameKey)}
              primitiveKind={g.kind}
              busy={busyKey === `prim-${g.kind}`}
              disabled={busyKey !== null}
              adapter={adapter}
              onClick={() => onPrimitive(g)}
              onHoverStart={hover.onEnter}
              onHoverEnd={hover.onLeave}
            />
          ))}
        </CatalogSection>
      ) : null}
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <CatalogSection
            key={group.category}
            id={sectionDomId('prop', group.category || 'misc')}
            title={group.category ? assetCategoryLabel(t, group.category) : t('library.categoryAll')}
          >
            {group.items.map((p) => (
              <AssetCard
                key={p.id}
                name={assetNameLabel(t, p.name, 'prop')}
                  previewKey={catalogPreviewSrc(p.coverUrl, p.cover)}
                busy={busyKey === `prop-${p.id}`}
                disabled={busyKey !== null}
                adapter={adapter}
                onClick={() => onProp(p)}
                onHoverStart={hover.onEnter}
                onHoverEnd={hover.onLeave}
              />
            ))}
          </CatalogSection>
        ),
      )}
      {filter !== PRIMITIVE_CHIP && hasMore ? (
        <LoadMoreStatus loaded={loaded} total={total} loading={loadingMore} t={t} />
      ) : null}
    </CatalogGroups>
  )
}

export function MotionList({
  items,
  query,
  filter,
  facets,
  busyKey,
  locked,
  t,
  adapter,
  hover,
  onPick,
}: {
  items: MotionLibEntry[] | null
  query: string
  filter: string
  facets: string[]
  busyKey: string | null
  locked: boolean
  t: TranslateFn
  adapter: HostAdapter
  hover: Hover
  onPick: (m: MotionLibEntry) => void
}): ReactElement {
  if (items === null) return <CatalogSkeleton variant="motion" />
  if (items.length === 0) return <div className="t3d-leftrail-empty">{t('library.motionsNotInstalled')}</div>
  const filtered = items.filter((m) => matchesQuery(m.name, query) || matchesQuery(assetNameLabel(t, m.name, 'motion'), query))
  const categories = filter === ALL_CHIP ? uniqueCategories(facets, filtered) : [filter]
  const visible = categories.filter((category) => filtered.some((m) => (m.category?.trim() || '') === category))
  if (visible.length === 0) return <div className="t3d-leftrail-empty">{t('library.emptyAssets')}</div>
  return (
    <CatalogGroups key={`${filter}:${query}`}>
      {visible.map((category) => {
        const group = filtered.filter((m) => (m.category?.trim() || '') === category)
        if (group.length === 0) return null
        return (
          <CatalogSection
            key={category}
            id={sectionDomId('motion', category)}
            title={assetCategoryLabel(t, category)}
            gridClass="t3d-leftrail-grid-motion"
          >
            {group.map((m) => (
              <AssetCard
                key={m.fbx}
                name={assetNameLabel(t, m.name, 'motion')}
                previewKey={catalogPreviewSrc(m.gifUrl, m.gif)}
                variant="motion"
                busy={busyKey === `motion-${m.fbx}`}
                disabled={busyKey !== null || locked}
                adapter={adapter}
                onClick={() => onPick(m)}
                onHoverStart={hover.onEnter}
                onHoverEnd={hover.onLeave}
              />
            ))}
          </CatalogSection>
        )
      })}
    </CatalogGroups>
  )
}

export function CameraList({
  t,
  adapter,
  hover,
  onPick,
}: {
  t: TranslateFn
  adapter: HostAdapter
  hover: Hover
  onPick: (id: string) => void
}): ReactElement {
  return (
    <CatalogSection id={sectionDomId('camera', ALL_CHIP)} title={t('library.categoryAll')}>
      {CAMERA_PRESETS.map((p) => (
        <AssetCard
          key={p.id}
          name={tOr(t, `cameraPreset.${p.id}`, p.name)}
          icon="camera"
          diagram={<CameraPresetThumb id={p.id} />}
          hoverDiagram={{ kind: 'cameraPreset', id: p.id }}
          adapter={adapter}
          onClick={() => onPick(p.id)}
          onHoverStart={hover.onEnter}
          onHoverEnd={hover.onLeave}
        />
      ))}
    </CatalogSection>
  )
}

export function CameraMotionList({
  filter,
  t,
  adapter,
  hover,
  onPick,
}: {
  filter: string
  t: TranslateFn
  adapter: HostAdapter
  hover: Hover
  onPick: (id: string) => void
}): ReactElement {
  const categories = filter === ALL_CHIP ? MOTION_CATEGORY_ORDER : MOTION_CATEGORY_ORDER.filter((cat) => cat === filter)
  return (
    <CatalogGroups key={filter}>
      {categories.map((cat) => {
        const items = CAMERA_MOTIONS.filter((m) => m.categoryId === cat)
        if (items.length === 0) return null
        return (
          <CatalogSection
            key={cat}
            id={sectionDomId('cameraMotion', cat)}
            title={t(CAMERA_MOTION_CATEGORY_LABEL[cat] ?? cat)}
          >
            {items.map((m) => (
              <AssetCard
                key={m.id}
                name={tOr(t, `cameraMotion.${m.id}.name`, m.name)}
                icon="camera"
                diagram={<CameraMotionThumb id={m.id} />}
                hoverDiagram={{ kind: 'cameraMotion', id: m.id }}
                variant="cameraMotion"
                adapter={adapter}
                onClick={() => onPick(m.id)}
                onHoverStart={hover.onEnter}
                onHoverEnd={hover.onLeave}
              />
            ))}
          </CatalogSection>
        )
      })}
    </CatalogGroups>
  )
}

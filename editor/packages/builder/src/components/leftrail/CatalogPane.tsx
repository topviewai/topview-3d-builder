import { localizeMessage } from '../../locale/messages'
import { assetCategoryLabel, assetNameLabel, assetSearchKeyword } from '../../locale/assetLabels'
import { useEffect, useMemo, useState, type ReactElement, type SyntheticEvent } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useThrottledFrame } from '../../bridge/useEngineEvent'
import { MOTION_CATEGORY_ORDER } from '../../data/cameraLibrary'
import { useT, type TranslateFn } from '../../locale'
import type { LibraryTab } from '../../stores/types'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { selectedTimelineNodeId } from '../timeline/utils'
import {
  CameraList,
  CameraMotionList,
  CharacterList,
  MotionList,
  PropList,
} from './CatalogLists'
import { Chips, type ChipItem } from './Chips'
import { ALL_CHIP, CAMERA_MOTION_CATEGORY_LABEL, PRIMITIVE_CHIP } from './constants'
import { useCatalog, type CatalogState } from './hooks/useCatalog'
import { HoverPreview } from './HoverPreview'
import { useHoverPreview } from './hooks/useHoverPreview'
import { displayCameraName } from '../displayNames'
import { SearchField } from './SearchField'
import { sectionDomId, uniqueCategories } from './utils'

function scrollToSection(scroll: HTMLElement | null, id: string): void {
  if (!scroll) return
  if (id === ALL_CHIP) {
    scroll.scrollTop = 0
    return
  }
  const el = scroll.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  el?.scrollIntoView({ block: 'start' })
}

export function CatalogPane({ tab }: { tab: LibraryTab }): ReactElement {
  const t = useT()
  const { useStore, adapter } = useDirector()
  const [queryByTab, setQueryByTab] = useState<Partial<Record<LibraryTab, string>>>({})
  const [anchorByTab, setAnchorByTab] = useState<Partial<Record<LibraryTab, string>>>({})
  const query = queryByTab[tab] ?? ''
  const anchor = anchorByTab[tab] ?? ALL_CHIP
  const [message, setMessage] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const hover = useHoverPreview()
  const frame = useThrottledFrame()
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const activeCameraId = useStore((s) => s.activeCameraId)
  const writeLocked = useStore((s) => s.writeLocked)
  const {
    addCharacter,
    addMotionClipFromLibrary,
    addPropFromLibrary,
    addPrimitive,
    addCameraFromPreset,
    applyCameraMotion,
  } = useStore()
  const debounced = useDebouncedValue(query)
  const propKeyword = useMemo(() => assetSearchKeyword(t, debounced), [t, debounced])
  const catalog = useCatalog(adapter, tab, tab === 'prop' ? anchor : ALL_CHIP, tab === 'prop' ? propKeyword : '')

  const setQuery = (value: string) => setQueryByTab((prev) => ({ ...prev, [tab]: value }))
  const setAnchor = (value: string) => setAnchorByTab((prev) => ({ ...prev, [tab]: value }))

  useEffect(() => {
    setMessage(null)
  }, [tab])

  const selectedNodeId = doc ? selectedTimelineNodeId(doc, selection) : null
  const selectedCharacter = selectedNodeId
    ? doc?.content.nodes.find((n) => n.id === selectedNodeId && n.type === 'character')
    : undefined
  const selectedCamera = selectedNodeId
    ? doc?.content.nodes.find((n) => n.id === selectedNodeId && n.type === 'camera')
    : undefined
  const activeCam = doc?.content.nodes.find((n) => n.type === 'camera' && n.id === activeCameraId)
  const camTarget = selectedCamera ?? activeCam

  const hint = catalogHint(t, tab, {
    character: selectedCharacter,
    cameraName: camTarget ? displayCameraName(t, camTarget.name) : t('library.noCamera'),
    frame: Math.round(frame),
  })

  const run = async (key: string, fn: () => Promise<string | null> | string | null) => {
    if (busyKey || writeLocked) return
    setBusyKey(key)
    setMessage(null)
    try {
      const err = await fn()
      setMessage(err ?? null)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  useEffect(() => {
    if (tab !== 'prop' || !scrollEl) return
    const maybeLoad = () => {
      if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 160) return
      catalog.loadMoreProps()
    }
    maybeLoad()
    scrollEl.addEventListener('scroll', maybeLoad, { passive: true })
    return () => scrollEl.removeEventListener('scroll', maybeLoad)
  }, [tab, scrollEl, catalog.propsHasMore, catalog.propsLoadingMore, catalog.props, catalog.loadMoreProps])

  const onChip = (id: string) => {
    setAnchor(id)
    if (tab === 'prop' || id === ALL_CHIP) {
      if (scrollEl) scrollEl.scrollTop = 0
      return
    }
    scrollToSection(scrollEl, sectionDomId(tab, id))
  }

  const guardCatalogWrite = (event: SyntheticEvent) => {
    if (!writeLocked || !(event.target instanceof Element)) return
    if (event.nativeEvent instanceof KeyboardEvent && (event.nativeEvent.key === 'Tab' || event.nativeEvent.key === 'Escape')) return
    if (!event.target.closest('button')) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="t3d-leftrail-catalog">
      {hint ? <div className="t3d-leftrail-hint">{hint}</div> : null}
      {message ? <div className="t3d-leftrail-message">{localizeMessage(t, message)}</div> : null}
      <CatalogToolbar
        tab={tab}
        t={t}
        query={query}
        onQuery={setQuery}
        anchor={anchor}
        onChip={onChip}
        catalog={catalog}
      />
      <div
        ref={setScrollEl}
        className="t3d-leftrail-scroll"
        aria-disabled={writeLocked || undefined}
        onPointerDownCapture={guardCatalogWrite}
        onClickCapture={guardCatalogWrite}
        onKeyDownCapture={guardCatalogWrite}
      >
        {tab === 'character' && (
          <CharacterList
            items={catalog.characters}
            busyKey={busyKey}
            t={t}
            adapter={adapter}
            hover={hover}
            onPick={(c) => run(`chr-${c.id}`, () => addCharacter({ ...c, name: assetNameLabel(t, c.name, 'character') }))}
          />
        )}
        {tab === 'prop' && (
          <PropList
            items={catalog.props}
            query={debounced}
            filter={anchor}
            hasMore={catalog.propsHasMore}
            loadingMore={catalog.propsLoadingMore}
            loaded={catalog.props?.length ?? 0}
            total={catalog.propsTotal}
            busyKey={busyKey}
            t={t}
            adapter={adapter}
            hover={hover}
            onProp={(p) => run(`prop-${p.id}`, () => addPropFromLibrary(p.name, p.file))}
            onPrimitive={(g) =>
              run(`prim-${g.kind}`, () =>
                addPrimitive(t(g.nameKey), g.kind, g.parameters, {
                  position: { x: 0, y: g.y, z: 0 },
                  rotation: { x: g.rotX ?? 0, y: 0, z: 0 },
                }),
              )
            }
          />
        )}
        {tab === 'motion' && (
          <MotionList
            items={catalog.motions}
            query={debounced}
            filter={anchor}
            facets={catalog.motionFacets}
            busyKey={busyKey}
            locked={Boolean(selectedCharacter?.locked)}
            t={t}
            adapter={adapter}
            hover={hover}
            onPick={(m) =>
              run(`motion-${m.fbx}`, async () => {
                if (selectedCharacter?.locked) return null
                if (!selectedCharacter) {
                  const first = catalog.characters?.[0]
                  if (!first) return t('library.needCharacter')
                  const created = await addCharacter({ ...first, name: assetNameLabel(t, first.name, 'character') })
                  if (created) return created
                }
                const err = await addMotionClipFromLibrary(m.fbx, m.name)
                if (!err) useStore.getState().requestTimelinePlayHint()
                return err === 'missing-character' ? t('library.needCharacter') : err
              })
            }
          />
        )}
        {tab === 'camera' && (
          <CameraList
            t={t}
            adapter={adapter}
            hover={hover}
            onPick={(id) => {
              const err = addCameraFromPreset(id, t(`cameraPreset.${id}`))
              setMessage(err ? t('library.addCameraFailed', { error: localizeMessage(t, err) }) : null)
            }}
          />
        )}
        {tab === 'cameraMotion' && (
          <CameraMotionList
            filter={anchor}
            t={t}
            adapter={adapter}
            hover={hover}
            onPick={(id) => {
              const err = applyCameraMotion(id)
              if (!err) useStore.getState().requestTimelinePlayHint()
              setMessage(
                err === 'missing-target'
                  ? t('library.motionNeedsCharacter')
                  : err
                    ? t('library.applyMotionFailed', { error: localizeMessage(t, err) })
                    : null,
              )
            }}
          />
        )}
      </div>
      <HoverPreview target={hover.preview} adapter={adapter} />
    </div>
  )
}

function catalogHint(
  t: TranslateFn,
  tab: LibraryTab,
  ctx: {
    character?: { name: string; locked: boolean }
    cameraName: string
    frame: number
  },
): string {
  if (tab === 'character' || tab === 'prop' || tab === 'camera') return ''
  if (tab === 'motion') {
    if (!ctx.character) return t('library.hintMotionNone')
    if (ctx.character.locked) return t('library.hintMotionLocked', { name: ctx.character.name })
    return t('library.hintMotionSelected', { name: ctx.character.name, frame: ctx.frame })
  }
  if (tab === 'cameraMotion') {
    return t('library.hintCameraMotionPlayhead', { name: ctx.cameraName, frame: ctx.frame })
  }
  return ''
}

function CatalogToolbar({
  tab,
  t,
  query,
  onQuery,
  anchor,
  onChip,
  catalog,
}: {
  tab: LibraryTab
  t: TranslateFn
  query: string
  onQuery: (v: string) => void
  anchor: string
  onChip: (id: string) => void
  catalog: CatalogState
}): ReactElement | null {
  const chips = useMemo(() => buildChips(tab, t, catalog), [tab, t, catalog])
  const showSearch = tab === 'prop' || tab === 'motion'
  if (!showSearch && chips.length === 0) return null
  return (
    <div className="t3d-leftrail-toolbar">
      {chips.length > 0 ? <Chips items={chips} activeId={anchor} onSelect={onChip} /> : null}
      {showSearch ? (
        <SearchField
          value={query}
          placeholder={tab === 'motion' ? t('library.searchMotions') : t('library.searchPropsSimple')}
          onChange={onQuery}
        />
      ) : null}
    </div>
  )
}

function buildChips(tab: LibraryTab, t: TranslateFn, catalog: CatalogState): ChipItem[] {
  const all = { id: ALL_CHIP, label: t('library.categoryAll') }
  if (tab === 'prop') {
    const cats = uniqueCategories(catalog.propFacets, null)
    return [
      all,
      { id: PRIMITIVE_CHIP, label: t('library.categoryPrimitives') },
      ...cats.map((c) => ({ id: c, label: assetCategoryLabel(t, c) })),
    ]
  }
  if (tab === 'motion') {
    const cats = uniqueCategories(catalog.motionFacets, catalog.motions)
    return [
      all,
      ...cats.map((c) => ({
        id: c,
        label: assetCategoryLabel(t, c),
      })),
    ]
  }
  if (tab === 'cameraMotion') {
    return [
      all,
      ...MOTION_CATEGORY_ORDER.map((c) => ({
        id: c,
        label: t(CAMERA_MOTION_CATEGORY_LABEL[c] ?? c),
      })),
    ]
  }
  return []
}

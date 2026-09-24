import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterLibEntry, MotionLibEntry, PropLibEntry } from '../../../host/types'
import type { HostAdapter } from '../../../host/types'
import type { LibraryTab } from '../../../stores/types'
import { ALL_CHIP, ASSET_FETCH_PAGE, ASSET_PROP_PAGE, PRIMITIVE_CHIP } from '../constants'

export interface CatalogState {
  characters: CharacterLibEntry[] | null
  props: PropLibEntry[] | null
  motions: MotionLibEntry[] | null
  /** 道具 / 动作 chips 都来自宿主 listAssetFacets；角色无 chips */
  propFacets: string[]
  motionFacets: string[]
  propsTotal: number
  propsHasMore: boolean
  propsLoadingMore: boolean
  loadMoreProps: () => void
}

interface PropListCache {
  items: PropLibEntry[]
  total: number
  pageNo: number
}

interface CatalogCache {
  propFacets: string[] | null
  motionFacets: string[] | null
  characters: CharacterLibEntry[] | null
  motions: MotionLibEntry[] | null
  propLists: Map<string, PropListCache>
  propInflight: Map<string, Promise<PropListCache>>
  propFacetsInflight: Promise<string[]> | null
  motionFacetsInflight: Promise<string[]> | null
  characterInflight: Promise<CharacterLibEntry[]> | null
  motionInflight: Promise<MotionLibEntry[]> | null
}

const caches = new WeakMap<HostAdapter, CatalogCache>()

function cacheFor(adapter: HostAdapter): CatalogCache {
  let cache = caches.get(adapter)
  if (!cache) {
    cache = {
      propFacets: null,
      motionFacets: null,
      characters: null,
      motions: null,
      propLists: new Map(),
      propInflight: new Map(),
      propFacetsInflight: null,
      motionFacetsInflight: null,
      characterInflight: null,
      motionInflight: null,
    }
    caches.set(adapter, cache)
  }
  return cache
}

function propCacheKey(category: string, keyword: string): string {
  return `${category}\0${keyword}`
}

function loadPropFacets(adapter: HostAdapter): Promise<string[]> {
  const cache = cacheFor(adapter)
  if (cache.propFacets) return Promise.resolve(cache.propFacets)
  if (cache.propFacetsInflight) return cache.propFacetsInflight
  cache.propFacetsInflight = adapter.listAssetFacets('prop').then((result) => {
    const values = result.categories.map((item) => item.value).filter(Boolean)
    cache.propFacets = values
    return values
  }).catch(() => {
    return [] as string[]
  }).finally(() => {
    cache.propFacetsInflight = null
  })
  return cache.propFacetsInflight
}

function loadMotionFacets(adapter: HostAdapter): Promise<string[]> {
  const cache = cacheFor(adapter)
  if (cache.motionFacets) return Promise.resolve(cache.motionFacets)
  if (cache.motionFacetsInflight) return cache.motionFacetsInflight
  cache.motionFacetsInflight = adapter.listAssetFacets('motion').then((result) => {
    const values = result.categories.map((item) => item.value).filter(Boolean)
    cache.motionFacets = values
    return values
  }).catch(() => {
    return [] as string[]
  }).finally(() => {
    cache.motionFacetsInflight = null
  })
  return cache.motionFacetsInflight
}

function loadCharacters(adapter: HostAdapter): Promise<CharacterLibEntry[]> {
  const cache = cacheFor(adapter)
  if (cache.characters) return Promise.resolve(cache.characters)
  if (cache.characterInflight) return cache.characterInflight
  cache.characterInflight = adapter.searchAssets({
    kind: 'character',
    pageNo: 1,
    pageSize: ASSET_FETCH_PAGE,
  }).then((page) => {
    const items = page.items as CharacterLibEntry[]
    cache.characters = items
    return items
  }).catch(() => {
    return [] as CharacterLibEntry[]
  }).finally(() => {
    cache.characterInflight = null
  })
  return cache.characterInflight
}

function loadMotions(adapter: HostAdapter): Promise<MotionLibEntry[]> {
  const cache = cacheFor(adapter)
  if (cache.motions) return Promise.resolve(cache.motions)
  if (cache.motionInflight) return cache.motionInflight
  cache.motionInflight = adapter.searchAssets({
    kind: 'motion',
    pageNo: 1,
    pageSize: ASSET_FETCH_PAGE,
  }).then((page) => {
    const items = page.items as MotionLibEntry[]
    cache.motions = items
    return items
  }).catch(() => {
    return [] as MotionLibEntry[]
  }).finally(() => {
    cache.motionInflight = null
  })
  return cache.motionInflight
}

function loadPropPage(
  adapter: HostAdapter,
  category: string,
  keyword: string,
): Promise<PropListCache> {
  const cache = cacheFor(adapter)
  const key = propCacheKey(category, keyword)
  const cached = cache.propLists.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = cache.propInflight.get(key)
  if (pending) return pending
  const request = adapter.searchAssets({
    kind: 'prop',
    keyword: keyword || undefined,
    category: category === ALL_CHIP ? undefined : category,
    pageNo: 1,
    pageSize: ASSET_PROP_PAGE,
  }).then((page) => {
    const next = { items: page.items as PropLibEntry[], total: page.total, pageNo: 1 }
    cache.propLists.set(key, next)
    return next
  }).catch(() => {
    return { items: [] as PropLibEntry[], total: 0, pageNo: 1 }
  }).finally(() => {
    cache.propInflight.delete(key)
  })
  cache.propInflight.set(key, request)
  return request
}

export function useCatalog(
  adapter: HostAdapter,
  tab: LibraryTab,
  propCategory: string,
  propKeyword: string,
): CatalogState {
  const cache = cacheFor(adapter)
  const [characters, setCharacters] = useState<CharacterLibEntry[] | null>(cache.characters)
  const [props, setProps] = useState<PropLibEntry[] | null>(null)
  const [motions, setMotions] = useState<MotionLibEntry[] | null>(cache.motions)
  const [propFacets, setPropFacets] = useState<string[]>(() => cache.propFacets ?? [])
  const [motionFacets, setMotionFacets] = useState<string[]>(() => cache.motionFacets ?? [])
  const [propsTotal, setPropsTotal] = useState(0)
  const [propsLoadingMore, setPropsLoadingMore] = useState(false)
  const propReq = useRef(0)
  const filterRef = useRef({ category: propCategory, keyword: propKeyword })
  filterRef.current = { category: propCategory, keyword: propKeyword }

  useEffect(() => {
    if (tab !== 'prop') return
    let cancelled = false
    void loadPropFacets(adapter).then((values) => {
      if (!cancelled) setPropFacets(values)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, tab])

  useEffect(() => {
    if (tab !== 'motion') return
    let cancelled = false
    void loadMotionFacets(adapter).then((values) => {
      if (!cancelled) setMotionFacets(values)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, tab])

  useEffect(() => {
    if (tab !== 'character') return
    if (cache.characters) {
      setCharacters(cache.characters)
      return
    }
    let cancelled = false
    setCharacters(null)
    void loadCharacters(adapter).then((items) => {
      if (!cancelled) setCharacters(items)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, cache, tab])

  useEffect(() => {
    if (tab !== 'motion') return
    if (cache.motions) {
      setMotions(cache.motions)
      return
    }
    let cancelled = false
    setMotions(null)
    void loadMotions(adapter).then((items) => {
      if (!cancelled) setMotions(items)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, cache, tab])

  useEffect(() => {
    if (tab !== 'prop') return
    if (propCategory === PRIMITIVE_CHIP) {
      setProps([])
      setPropsTotal(0)
      return
    }
    const cached = cache.propLists.get(propCacheKey(propCategory, propKeyword))
    if (cached) {
      setProps(cached.items)
      setPropsTotal(cached.total)
      return
    }
    const req = ++propReq.current
    let cancelled = false
    setProps(null)
    setPropsTotal(0)
    void loadPropPage(adapter, propCategory, propKeyword).then((page) => {
      if (cancelled || req !== propReq.current) return
      setProps(page.items)
      setPropsTotal(page.total)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, cache, tab, propCategory, propKeyword])

  const loadMoreProps = useCallback(() => {
    const { category, keyword } = filterRef.current
    if (category === PRIMITIVE_CHIP) return
    const key = propCacheKey(category, keyword)
    if (cache.propInflight.has(key)) return
    const cached = cache.propLists.get(key)
    if (!cached || cached.items.length >= cached.total) return
    setPropsLoadingMore(true)
    const nextPage = cached.pageNo + 1
    const request = adapter.searchAssets({
      kind: 'prop',
      keyword: keyword || undefined,
      category: category === ALL_CHIP ? undefined : category,
      pageNo: nextPage,
      pageSize: ASSET_PROP_PAGE,
    }).then((page) => {
      const items = [...cached.items, ...(page.items as PropLibEntry[])]
      const next = { items, total: page.total, pageNo: nextPage }
      cache.propLists.set(key, next)
      if (propCacheKey(filterRef.current.category, filterRef.current.keyword) === key) {
        setProps(items)
        setPropsTotal(page.total)
      }
      return next
    }).catch(() => cached).finally(() => {
      cache.propInflight.delete(key)
      setPropsLoadingMore(false)
    })
    cache.propInflight.set(key, request)
  }, [adapter, cache])

  const propsCount = props?.length ?? 0
  return {
    characters,
    props,
    motions,
    propFacets,
    motionFacets,
    propsTotal,
    propsHasMore: propsCount < propsTotal,
    propsLoadingMore,
    loadMoreProps,
  }
}

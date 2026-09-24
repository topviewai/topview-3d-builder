export interface ThumbRequest {
  cameraId: string
  frame: number
  /** 离屏渲染高度（px）；同一帧不同高度各存一份，拉高面板才能换上更清晰的图。 */
  height: number
}

export type ThumbRenderer = (requests: ThumbRequest[]) => (string | null)[]

/** 一批最多渲染这么多张，剩下的推到下一帧，避免长任务卡住拖拽与播放。 */
const BATCH_SIZE = 4
/** 缓存上限，超过按插入顺序淘汰最旧的。 */
const MAX_ENTRIES = 600

export function thumbKey(cameraId: string, frame: number, height: number): string {
  return `${cameraId}@${frame}@${height}`
}

/** 每个 DirectorProvider 持有一份，避免多个编辑器互相清缓存或覆盖 renderer。 */
export class ThumbnailStore {
  private readonly cache = new Map<string, string>()
  private readonly misses = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly queue: (ThumbRequest & { key: string })[] = []
  private readonly queued = new Set<string>()
  private scope = ''
  private scheduled = 0
  private version = 0
  private renderer: ThumbRenderer | null = null

  get = (key: string): string | undefined => this.cache.get(key)

  getVersion = (): number => this.version

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  setScope(next: string): void {
    if (this.scope === next) return
    this.scope = next
    this.cache.clear()
    this.misses.clear()
    this.queue.length = 0
    this.queued.clear()
    this.notify()
  }

  request(items: ThumbRequest[], render: ThumbRenderer): void {
    this.renderer = render
    for (const item of items) {
      const key = thumbKey(item.cameraId, item.frame, item.height)
      if (this.cache.has(key) || this.misses.has(key) || this.queued.has(key)) continue
      this.queued.add(key)
      this.queue.push({ key, ...item })
    }
    this.schedule()
  }

  dispose(): void {
    if (this.scheduled) cancelAnimationFrame(this.scheduled)
    this.scheduled = 0
    this.queue.length = 0
    this.queued.clear()
    this.listeners.clear()
    this.renderer = null
  }

  private schedule(): void {
    if (this.scheduled || this.queue.length === 0) return
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0
      this.flush()
    })
  }

  private flush(): void {
    const render = this.renderer
    if (!render) return
    // 同一批必须同高度：离屏渲染器一次只能设一个画布尺寸
    const height = this.queue[0]?.height
    if (height == null) return
    const batch: (ThumbRequest & { key: string })[] = []
    for (let i = 0; i < this.queue.length && batch.length < BATCH_SIZE; ) {
      if (this.queue[i].height === height) batch.push(this.queue.splice(i, 1)[0])
      else i++
    }
    if (batch.length === 0) return
    let results: (string | null)[] = []
    try {
      results = render(batch.map(({ cameraId, frame, height: h }) => ({ cameraId, frame, height: h })))
    } catch {
      // 渲染失败就记为 miss，不重复排队打爆 GPU
      results = batch.map(() => null)
    }
    batch.forEach((item, index) => {
      this.queued.delete(item.key)
      const url = results[index]
      if (url) {
        this.cache.set(item.key, url)
        if (this.cache.size > MAX_ENTRIES) {
          const oldest = this.cache.keys().next().value
          if (oldest) this.cache.delete(oldest)
        }
      } else {
        this.misses.add(item.key)
      }
    })
    this.notify()
    this.schedule()
  }

  private notify(): void {
    this.version += 1
    for (const fn of this.listeners) fn()
  }
}

const stores = new WeakMap<object, ThumbnailStore>()

export function thumbnailStoreFor(owner: object): ThumbnailStore {
  let store = stores.get(owner)
  if (!store) {
    store = new ThumbnailStore()
    stores.set(owner, store)
  }
  return store
}

export function disposeThumbnailStore(owner: object): void {
  stores.get(owner)?.dispose()
  stores.delete(owner)
}

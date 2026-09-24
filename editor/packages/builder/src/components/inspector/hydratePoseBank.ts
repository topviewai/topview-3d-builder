import { collectPoseLibraryPages } from '../../data/collectPoseLibrary'
import type { PoseLibraryBank } from '../../data/poseLibraryBank'
import type { HostAdapter } from '../../host/types'

export { collectPoseLibraryPages, POSE_LIBRARY_MAX_PAGES, POSE_LIBRARY_PAGE_SIZE } from '../../data/collectPoseLibrary'

interface HydrationState {
  hydrated: boolean
  inflight: Promise<void> | null
}

const hydration = new WeakMap<PoseLibraryBank, HydrationState>()

function stateFor(bank: PoseLibraryBank): HydrationState {
  let state = hydration.get(bank)
  if (!state) {
    state = { hydrated: false, inflight: null }
    hydration.set(bank, state)
  }
  return state
}

export function isPoseLibraryCatalogHydrated(bank: PoseLibraryBank): boolean {
  return stateFor(bank).hydrated
}

export async function hydratePoseBank(adapter: HostAdapter, bank: PoseLibraryBank): Promise<void> {
  const state = stateFor(bank)
  if (state.hydrated) return
  if (state.inflight) return state.inflight
  state.inflight = (async () => {
    try {
      const records = await collectPoseLibraryPages((pageNo, pageSize) =>
        adapter.searchAssets({ kind: 'pose', pageNo, pageSize }),
      )
      bank.set(records)
      state.hydrated = true
    } catch {
      // 保留草稿已按需写入的骨骼 stub，下次打开面板再试目录
    } finally {
      state.inflight = null
    }
  })()
  return state.inflight
}

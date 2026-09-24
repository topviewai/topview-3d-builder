import { useEffect, useSyncExternalStore } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import { useEngine } from '../../../bridge/useEngine'
import { thumbWidthFor } from '../utils'
import {
  thumbKey,
  thumbnailStoreFor,
  type ThumbRequest,
} from './thumbnailStore'

export type ThumbLookup = (cameraId: string, frame: number, height: number) => string | undefined

/**
 * 返回按 (cameraId, frame) 取缩略图的函数；缺的图排队离屏渲染，
 * 渲染完成后经订阅触发一次重渲。
 */
export function useFilmThumbnails(requests: ThumbRequest[]): ThumbLookup {
  const engine = useEngine()
  const { useStore } = useDirector()
  const thumbnailStore = thumbnailStoreFor(engine)
  const doc = useStore((s) => s.doc)
  const draftId = useStore((s) => s.draftId)
  const ready = useStore((s) => s.ready)
  const scope = `${draftId}\0${doc?.pippitAssetId ?? ''}`

  useSyncExternalStore(thumbnailStore.subscribe, thumbnailStore.getVersion, thumbnailStore.getVersion)

  useEffect(() => {
    thumbnailStore.setScope(scope)
  }, [scope, thumbnailStore])

  useEffect(() => {
    if (!ready || requests.length === 0) return
    thumbnailStore.request(requests, (batch) => {
      const state = useStore.getState()
      const height = batch[0].height
      return engine.captureThumbnails({
        requests: batch,
        width: thumbWidthFor(height),
        height,
        userKeys: state.userKeys,
        userKeysEnabled: state.userKeysEnabled,
        chainCameraMotion: state.chainCameraMotion,
      })
    })
  }, [engine, useStore, ready, requests, thumbnailStore])

  return (cameraId, frame, height) => thumbnailStore.get(thumbKey(cameraId, frame, height))
}

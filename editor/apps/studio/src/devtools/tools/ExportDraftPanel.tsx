'use client'

import { useStudioT } from '../../locale'


import { useSyncExternalStore } from 'react'
import { getLiveStudio, subscribeLiveStudio } from '../liveStudio'

export function ExportDraftPanel() {
  const t = useStudioT()
  const api = useSyncExternalStore(subscribeLiveStudio, getLiveStudio, () => null)
  const state = api?.useStore.getState()
  const draftId = state?.draftId
  const canExport = Boolean(state?.ready && state.doc)

  return (
    <div className="studio-devtools-upload">
      {api ? (
        <>
          <p className="studio-devtools-hint">{t("调用 exportDraft() 下载当前草稿 JSON 与用户关键帧。顶栏不展示此入口。")}</p>
          <p className="studio-devtools-hint">{t("当前草稿：")}{draftId || t("（无 id）")}</p>
          <p className="studio-devtools-hint">{t("控制台也可：__exportDraft() 或 __store.getState().exportDraft()")}</p>
          <button
            type="button"
            className="studio-devtools-primary"
            disabled={!canExport}
            onClick={() => {
              getLiveStudio()?.useStore.getState().exportDraft()
            }}
          >{t("导出草稿")}</button>
        </>
      ) : (
        <p className="studio-devtools-hint">{t("先打开一份草稿，再导出当前编辑中的 JSON。")}</p>
      )}
    </div>
  )
}

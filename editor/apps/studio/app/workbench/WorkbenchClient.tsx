'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CreateDialog } from './components/CreateDialog'
import { DraftCard } from './components/DraftCard'
import { PlusIcon } from './components/icons'
import { StudioOverlay } from './components/StudioOverlay'
import { DEFAULT_FPS, DEFAULT_FRAMES, DRAFT_QUERY_KEY, PROJECT_QUERY_KEY } from './constants'
import { useWorkbenchDrafts } from './hooks/useWorkbenchDrafts'
import { buildWorkbenchHref, isValidDraftId, readDraftQuery } from './utils'
import './styles.css'

export function WorkbenchClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, projects, error, busy, createDraft, removeDraft } = useWorkbenchDrafts()
  const [createOpen, setCreateOpen] = useState(false)
  const editingId = readDraftQuery(searchParams.get(DRAFT_QUERY_KEY))
  const projectId = editingId ? null : readDraftQuery(searchParams.get(PROJECT_QUERY_KEY))
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [name, setName] = useState('新草稿')
  const [fps, setFps] = useState(DEFAULT_FPS)
  const [frames, setFrames] = useState(DEFAULT_FRAMES)
  const [withCamera, setWithCamera] = useState(true)

  const syncQuery = useCallback(
    (open: { draft?: string; project?: string } | null) => {
      const href = buildWorkbenchHref(searchParams.toString(), open)
      if (href === `${window.location.pathname}${window.location.search}`) return
      router.replace(href, { scroll: false })
    },
    [router, searchParams],
  )

  const openCreate = () => {
    setName('新草稿')
    setFps(DEFAULT_FPS)
    setFrames(DEFAULT_FRAMES)
    setWithCamera(true)
    setCreateOpen(true)
  }

  const openStudio = useCallback(
    (id: string) => {
      if (isValidDraftId(id)) syncQuery({ draft: id })
    },
    [syncQuery],
  )

  const openProject = useCallback(
    (id: string) => {
      if (isValidDraftId(id)) syncQuery({ project: id })
    },
    [syncQuery],
  )

  const closeStudio = useCallback(() => {
    syncQuery(null)
  }, [syncQuery])

  const create = async () => {
    const id = await createDraft({ name, fps, frames, withCamera })
    if (!id) return
    setCreateOpen(false)
    openStudio(id)
  }

  const remove = async (id: string) => {
    setConfirmingId(null)
    if (editingId === id) closeStudio()
    await removeDraft(id)
  }

  const closeCreate = () => {
    if (busy) return
    setCreateOpen(false)
  }

  return (
    <>
      <main className="wb">
        <header className="wb-hero">
          <div className="wb-hero-top">
            <p className="wb-kicker">Topview · Scene3D Studio</p>
            <div className="wb-hero-actions">
              <button type="button" className="wb-cta" onClick={openCreate} disabled={busy}>
                <PlusIcon />新建草稿</button>
            </div>
          </div>
          <h1 className="wb-title">3D 导演台</h1>
          <p className="wb-sub">本地草稿工作台。草稿保存在本机，素材来自本地素材清单，全程离线。</p>
        </header>

        {error && <div className="wb-error">{error}</div>}

        <section className="wb-section">
          <div className="wb-section-head">
            <h2>我的草稿</h2>
            {data ? <span className="wb-count">{data.user.length}</span> : null}
          </div>
          <div className="wb-grid">
            <button type="button" className="wb-new-card" onClick={openCreate} disabled={busy}>
              <span className="wb-new-card-cover">
                <span className="wb-plus">
                  <PlusIcon />
                </span>
              </span>
              <span className="wb-card-body">
                <span className="wb-card-title">从空白开始</span>
                <span className="wb-card-meta">空白场景 · 可配置帧率</span>
              </span>
            </button>
            {data
              ? data.user.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    confirming={confirmingId === draft.id}
                    busy={busy}
                    onOpen={openStudio}
                    onConfirmingChange={setConfirmingId}
                    onRemove={() => void remove(draft.id)}
                  />
                ))
              : Array.from({ length: 3 }, (_, i) => <div key={`user-sk-${i}`} className="wb-skeleton" />)}
          </div>
        </section>

        {projects.length > 0 ? (
          <section className="wb-section">
            <div className="wb-section-head">
              <h2>CLI 项目（只读）</h2>
              <span className="wb-count">{projects.length}</span>
            </div>
            <div className="wb-grid">
              {projects.map((project) => (
                <DraftCard key={project.id} draft={project} readonly onOpen={openProject} />
              ))}
            </div>
          </section>
        ) : null}

        {createOpen && (
          <CreateDialog
            busy={busy}
            name={name}
            fps={fps}
            frames={frames}
            withCamera={withCamera}
            error={error}
            onName={setName}
            onFps={setFps}
            onFrames={setFrames}
            onCamera={setWithCamera}
            onClose={closeCreate}
            onSubmit={() => void create()}
          />
        )}
      </main>
      {editingId ? <StudioOverlay documentId={editingId} onClose={closeStudio} /> : null}
      {projectId ? <StudioOverlay documentId={projectId} source="project" onClose={closeStudio} /> : null}
    </>
  )
}

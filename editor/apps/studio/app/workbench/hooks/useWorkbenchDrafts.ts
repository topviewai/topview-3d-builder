import { useCallback, useEffect, useState } from 'react'
import { CAMERA_PRESETS, createInitialDraft, type DirectorDocument } from '@topview/3d-builder'
import type { DraftsResponse, ProjectRow } from '../types'
import { slugify } from '../utils'
import { LocalHostAdapter } from '../../../src/LocalHostAdapter'

async function createLocalDraft(id: string, doc: DirectorDocument): Promise<string> {
  const res = await fetch('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, doc }),
  })
  if (!res.ok) {
    const body = (await res.json()) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return id
}

export function useWorkbenchDrafts() {
  const [data, setData] = useState<DraftsResponse | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/drafts', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as DraftsResponse)
      const listed = await fetch('/api/projects', { cache: 'no-store' })
      setProjects(listed.ok ? ((await listed.json()) as { projects: ProjectRow[] }).projects : [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const createDraft = async (input: {
    name: string
    fps: number
    frames: number
    withCamera: boolean
  }): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const camera = input.withCamera ? CAMERA_PRESETS.find((p) => p.id === 'front-medium') : undefined
      const doc = await createInitialDraft(new LocalHostAdapter(), {
        name: input.name.trim() || '新草稿',
        fps: input.fps,
        totalFrames: input.frames,
        camera,
      })
      const id = await createLocalDraft(`${slugify(input.name)}-${Date.now().toString(36)}`, doc)
      await reload()
      return id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const removeDraft = async (id: string) => {
    setBusy(true)
    try {
      await fetch(`/api/drafts/${id}`, { method: 'DELETE' })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return { data, projects, error, busy, createDraft, removeDraft }
}

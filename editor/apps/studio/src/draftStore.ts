// 本地草稿仓库：草稿以 JSON 文件落在 apps/studio/drafts/（已 gitignore）。
// 这是宿主侧的集合操作（列表 / 新建 / 删除），包完全不感知，见 architecture.md §3.5。
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface DraftSummary {
  id: string
  name: string
  fps?: number
  frameEnd?: number
  nodeCount?: number
  updatedAt?: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function isValidDraftId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function draftsDir(): string {
  return path.resolve(process.cwd(), 'drafts')
}

function draftPath(id: string): string {
  return path.join(draftsDir(), `${id}.json`)
}

function fcurvesPath(id: string): string {
  return path.join(draftsDir(), `${id}.fcurves.json`)
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export function summarizeDraft(id: string, raw: unknown): DraftSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const content = (doc.content ?? {}) as Record<string, unknown>
  // makeEmptyDraft 把草稿名写在 extra.customDraftName；内置格式没有 content.name
  const extra = (doc.extra ?? {}) as Record<string, unknown>
  const timeline = (content.timeline ?? {}) as Record<string, unknown>
  const nodes = Array.isArray(content.nodes) ? content.nodes : []
  return {
    id,
    name: typeof extra.customDraftName === 'string' && extra.customDraftName
      ? extra.customDraftName
      : id,
    fps: typeof timeline.fps === 'number' ? timeline.fps : undefined,
    frameEnd: typeof timeline.frameEnd === 'number' ? timeline.frameEnd : undefined,
    nodeCount: nodes.length,
  }
}

export async function listUserDrafts(): Promise<DraftSummary[]> {
  await mkdir(draftsDir(), { recursive: true })
  const files = await readdir(draftsDir())
  const out: DraftSummary[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    if (file.endsWith('.fcurves.json')) continue
    const id = file.slice(0, -'.json'.length)
    if (!isValidDraftId(id)) continue
    // 坏文件不阻断列表
    const summary = summarizeDraft(id, await readJson(draftPath(id)))
    if (summary) out.push(summary)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export async function readDraft(id: string): Promise<unknown | null> {
  if (!isValidDraftId(id)) return null
  return readJson(draftPath(id))
}

export async function writeUserDraft(id: string, doc: unknown): Promise<void> {
  if (!isValidDraftId(id)) throw new Error(`非法草稿 id: ${id}`)
  await mkdir(draftsDir(), { recursive: true })
  await writeFile(draftPath(id), `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

export async function deleteUserDraft(id: string): Promise<boolean> {
  if (!isValidDraftId(id)) return false
  try {
    await unlink(draftPath(id))
  } catch {
    return false
  }
  await unlink(fcurvesPath(id)).catch(() => undefined)
  return true
}

export async function readFCurves(id: string): Promise<unknown | null> {
  if (!isValidDraftId(id)) return null
  return readJson(fcurvesPath(id))
}

export async function writeUserFCurves(id: string, data: unknown): Promise<void> {
  if (!isValidDraftId(id)) throw new Error(`非法草稿 id: ${id}`)
  await mkdir(draftsDir(), { recursive: true })
  await writeFile(fcurvesPath(id), `${JSON.stringify(data)}\n`, 'utf8')
}

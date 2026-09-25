// CLI 项目入口（仅服务端）。TOPVIEW3D_PROJECTS 列出项目目录（用系统路径分隔符隔开）。
// 读取 .topview-3d/document.json 与 fcurves.json。保存时调用 topview-3d-cli project adopt，
// 把 Studio 的编辑写回实体库，之后 Agent 再读这份项目就是编辑后的结果。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { summarizeDraft, type DraftSummary } from './draftStore'

export interface LocalProject {
  id: string
  root: string
}

export function projectStateDir(root: string): string | null {
  const dir = path.join(root, '.topview-3d')
  return existsSync(path.join(dir, 'document.json')) ? dir : null
}

function cacheDir(): string {
  const override = process.env.TOPVIEW3D_CACHE_DIR?.trim()
  if (override) return override
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Caches', 'topview-3d-cli')
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
    return path.join(base, 'topview-3d-cli', 'Cache')
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'topview-3d-cli')
}

/** Same id the CLI puts in the Studio URL: sha256 of the absolute path, first 16 hex chars. */
export function projectId(root: string): string {
  return `cli-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`
}

function remember(roots: Map<string, string>, candidate: string): void {
  const trimmed = candidate.trim()
  if (!trimmed) return
  try {
    const resolved = realpathSync(path.resolve(trimmed))
    roots.set(resolved, resolved)
  } catch {
    // A listed directory that is not on disk yet is ignored.
  }
}

export function projectRoots(): string[] {
  const roots = new Map<string, string>()
  const raw = process.env.TOPVIEW3D_PROJECTS?.trim()
  if (raw) raw.split(path.delimiter).forEach((item) => remember(roots, item))
  try {
    const text = readFileSync(path.join(cacheDir(), 'studio', 'projects.txt'), 'utf8')
    text.split('\n').forEach((item) => remember(roots, item))
  } catch {
    // No shared registry yet.
  }
  return [...roots.values()]
}

export function listProjects(): LocalProject[] {
  return projectRoots()
    .filter((root) => projectStateDir(root))
    .map((root) => ({ id: projectId(root), root }))
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function findProject(id: string): LocalProject | undefined {
  return listProjects().find((project) => project.id === id)
}

export function projectSummaries(): (DraftSummary & { root: string })[] {
  const out: (DraftSummary & { root: string })[] = []
  for (const project of listProjects()) {
    const state = projectStateDir(project.root)
    const doc = state ? readJson(path.join(state, 'document.json')) : null
    const summary = doc ? summarizeDraft(project.id, doc) : null
    if (summary) out.push({ ...summary, name: summary.name === project.id ? path.basename(project.root) : summary.name, root: project.root })
  }
  return out
}

export function readProjectDocument(id: string): unknown | null {
  const project = findProject(id)
  const state = project ? projectStateDir(project.root) : null
  return state ? readJson(path.join(state, 'document.json')) : null
}

export function readProjectFCurves(id: string): unknown | null {
  const project = findProject(id)
  const state = project ? projectStateDir(project.root) : null
  return state ? readJson(path.join(state, 'fcurves.json')) : null
}

export function adoptProjectEdit(id: string, payload: { document?: unknown; fcurves?: unknown }): void {
  const project = findProject(id)
  if (!project) throw new Error(`项目不存在: ${id}`)
  if (payload.document === undefined && payload.fcurves === undefined) {
    throw new Error('保存内容为空')
  }
  const cli = process.env.TOPVIEW3D_CLI?.trim() || 'topview-3d-cli'
  const dir = mkdtempSync(path.join(tmpdir(), 'topview-3d-adopt-'))
  const file = path.join(dir, 'edit.json')
  try {
    writeFileSync(file, JSON.stringify(payload))
    execFileSync(cli, ['project', 'adopt', project.root, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr) : ''
    throw new Error(stderr.trim() || (error instanceof Error ? error.message : String(error)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

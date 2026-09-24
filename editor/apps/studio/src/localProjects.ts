// CLI 项目入口（仅服务端）。TOPVIEW3D_PROJECTS 列出项目目录（用系统路径分隔符隔开）。
// 读取 .topview-3d/document.json 与 fcurves.json。保存时调用 topview-3d-cli project adopt，
// 把 Studio 的编辑写回实体库，之后 Agent 再读这份项目就是编辑后的结果。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

function slug(value: string): string {
  const ascii = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (ascii || 'project').slice(0, 48)
}

export function projectRoots(): string[] {
  const raw = process.env.TOPVIEW3D_PROJECTS?.trim()
  if (!raw) return []
  return raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item))
}

export function listProjects(): LocalProject[] {
  const used = new Set<string>()
  return projectRoots()
    .filter((root) => projectStateDir(root))
    .map((root) => {
      const base = `cli-${slug(path.basename(root))}`
      let id = base
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`
      used.add(id)
      return { id, root }
    })
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

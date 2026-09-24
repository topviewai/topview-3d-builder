// CLI 项目只读入口（仅服务端）。TOPVIEW3D_PROJECTS 列出项目目录（用系统路径分隔符隔开），
// 读取各自 .topview3d/document.json 与 fcurves.json。这两个文件是 CLI 从 entities.json 派生的视图，
// 直接覆写会被下一次 CLI 写入冲掉，所以 Studio 只读打开，修改请走 CLI。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { summarizeDraft, type DraftSummary } from './draftStore'

export interface LocalProject {
  id: string
  root: string
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
    .filter((root) => existsSync(path.join(root, '.topview3d', 'document.json')))
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
    const doc = readJson(path.join(project.root, '.topview3d', 'document.json'))
    const summary = doc ? summarizeDraft(project.id, doc) : null
    if (summary) out.push({ ...summary, name: summary.name === project.id ? path.basename(project.root) : summary.name, root: project.root })
  }
  return out
}

export function readProjectDocument(id: string): unknown | null {
  const project = findProject(id)
  return project ? readJson(path.join(project.root, '.topview3d', 'document.json')) : null
}

export function readProjectFCurves(id: string): unknown | null {
  const project = findProject(id)
  return project ? readJson(path.join(project.root, '.topview3d', 'fcurves.json')) : null
}

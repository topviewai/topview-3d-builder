#!/usr/bin/env node
// Build the Codex plugin upload archive from the committed HEAD.
//
//   node scripts/package-codex-plugin.mjs            # dist/topview-3d-builder-plugin.zip
//   node scripts/package-codex-plugin.mjs --release  # also fail on TODO placeholders
//
// The archive has one root folder, topview-3d-builder/, holding .codex-plugin/, the image files the
// manifest references, and skills/. Everything is read from HEAD (git), so uncommitted changes are
// not packaged. The checks below fail with a message naming the file and the rule.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_NAME = 'topview-3d-builder'
const OUTPUT = path.join(ROOT, 'dist', `${PLUGIN_NAME}-plugin.zip`)
// Codex states its upload limit in decimal MB; single files are capped in MiB.
const MAX_ARCHIVE_BYTES = 100 * 1_000_000
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_MIN = 48
const IMAGE_MAX = 4096
const MAX_SKILL_ID = 64
const MAX_DESCRIPTION = 1024
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const FORBIDDEN_KEYS = ['apps']
const FORBIDDEN_FILES = ['.app.json']

const release = process.argv.includes('--release')
const errors = []
const warnings = []

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, ...options })
}

function headBlob(file) {
  const result = spawnSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : null
}

/** mode, type, size and path of every file under `paths` in HEAD. */
function headTree(paths) {
  const out = git(['ls-tree', '-r', '-l', '-z', 'HEAD', '--', ...paths]).toString('utf8')
  return out.split('\0').filter(Boolean).map((line) => {
    const [meta, file] = line.split('\t')
    const [mode, type, , size] = meta.trim().split(/\s+/)
    return { mode, type, size: Number(size), file }
  })
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function checkImage(field, rel) {
  const blob = headBlob(rel)
  if (!blob) {
    errors.push(`${field}: ${rel} is missing from HEAD. Add a square PNG (see assets/README.md) and commit it.`)
    return
  }
  const size = pngSize(blob)
  if (!size) {
    errors.push(`${field}: ${rel} is not a PNG file.`)
    return
  }
  if (size.width !== size.height) errors.push(`${field}: ${rel} is ${size.width}x${size.height}; it must be square.`)
  if (size.width < IMAGE_MIN || size.width > IMAGE_MAX) {
    errors.push(`${field}: ${rel} is ${size.width}px wide; it must be ${IMAGE_MIN}-${IMAGE_MAX}px.`)
  }
  if (blob.length > MAX_IMAGE_BYTES) {
    errors.push(`${field}: ${rel} is ${(blob.length / 1024 / 1024).toFixed(2)} MiB; the limit is 5 MiB.`)
  }
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return null
  const fields = {}
  let key = null
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair) {
      key = pair[1]
      fields[key] = /^[>|][-+]?$/.test(pair[2]) ? '' : pair[2].replace(/^(['"])(.*)\1$/, '$2')
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim()
    }
  }
  return fields
}

function collectTodos(value, where, out) {
  if (typeof value === 'string') {
    if (/\bTODO\b/.test(value)) out.push(where)
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectTodos(item, `${where}[${index}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) collectTodos(item, where ? `${where}.${key}` : key, out)
  }
}

// —— manifest ——
const manifestBlob = headBlob('.codex-plugin/plugin.json')
if (!manifestBlob) {
  console.error('error: .codex-plugin/plugin.json is missing from HEAD.')
  process.exit(1)
}
let manifest
try {
  manifest = JSON.parse(manifestBlob.toString('utf8'))
} catch (error) {
  console.error(`error: .codex-plugin/plugin.json is not valid JSON: ${error.message}`)
  process.exit(1)
}
if (manifest.name !== PLUGIN_NAME) errors.push(`plugin.json name is ${JSON.stringify(manifest.name)}; expected "${PLUGIN_NAME}".`)
if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
  errors.push(`plugin.json version ${JSON.stringify(manifest.version)} is not a semantic version.`)
}
if (manifest.skills !== './skills/') errors.push(`plugin.json skills is ${JSON.stringify(manifest.skills)}; expected "./skills/".`)
if (manifest.mcpServers !== './.mcp.json') errors.push(`plugin.json mcpServers is ${JSON.stringify(manifest.mcpServers)}; expected "./.mcp.json".`)
if (!headBlob('.mcp.json')) errors.push('.mcp.json is missing from HEAD.')
for (const key of FORBIDDEN_KEYS) {
  if (key in manifest) errors.push(`plugin.json must not declare "${key}".`)
}
const allFiles = git(['ls-tree', '-r', '--name-only', 'HEAD']).toString('utf8').split('\n').filter(Boolean)
for (const file of allFiles) {
  if (FORBIDDEN_FILES.includes(path.posix.basename(file))) errors.push(`${file}: plugins ship no MCP or app config.`)
}
const todos = []
collectTodos(manifest, '', todos)
if (todos.length) {
  const message = `plugin.json still has TODO placeholders: ${todos.join(', ')}`
  if (release) errors.push(message)
  else warnings.push(message)
}

// —— images ——
const imageFields = Object.entries(manifest.interface ?? {}).filter(
  ([key, value]) => typeof value === 'string' && /\.(png|jpe?g|svg|webp)$/i.test(value) && ['composerIcon', 'logo'].includes(key),
)
for (const key of ['composerIcon', 'logo']) {
  if (!imageFields.some(([field]) => field === key)) errors.push(`plugin.json interface.${key} is missing.`)
}
const assetPaths = []
for (const [field, value] of imageFields) {
  const rel = path.posix.normalize(value.replace(/^\.\//, ''))
  if (rel.startsWith('../') || path.posix.isAbsolute(rel) || !rel.startsWith('assets/')) {
    errors.push(`interface.${field}: ${value} must be a path under ./assets/.`)
    continue
  }
  if (!/\.png$/i.test(rel)) errors.push(`interface.${field}: ${value} must be a PNG.`)
  checkImage(`interface.${field}`, rel)
  if (!assetPaths.includes(rel)) assetPaths.push(rel)
}

// —— skills ——
const pluginPaths = ['.codex-plugin', '.mcp.json', ...assetPaths.sort(), 'skills']
const entries = headTree(pluginPaths.filter((p) => allFiles.some((file) => file === p || file.startsWith(`${p}/`))))
const skillDirs = new Set()
for (const entry of entries) {
  if (entry.mode === '120000') errors.push(`${entry.file}: symlinks are not allowed in the plugin.`)
  if (entry.type !== 'blob') errors.push(`${entry.file}: only regular files are allowed (found ${entry.type}).`)
  if (entry.size > MAX_FILE_BYTES) errors.push(`${entry.file}: ${(entry.size / 1024 / 1024).toFixed(1)} MiB exceeds the 100 MiB file limit.`)
  if (!entry.file.startsWith('skills/')) continue
  const parts = entry.file.split('/')
  if (parts.length < 3) {
    errors.push(`${entry.file}: files directly in skills/ are not allowed; put each skill in skills/<name>/.`)
    continue
  }
  if (parts[1].startsWith('.')) errors.push(`${entry.file}: skill directories must not start with ".".`)
  if (parts[parts.length - 1] === 'SKILL.md' && parts.length !== 3) {
    errors.push(`${entry.file}: SKILL.md must sit directly in skills/<name>/ (nested skills are not discovered).`)
  }
  skillDirs.add(parts[1])
}
if (skillDirs.size === 0) errors.push('skills/ has no skills in HEAD.')
for (const dir of [...skillDirs].sort()) {
  const blob = headBlob(`skills/${dir}/SKILL.md`)
  if (!blob) {
    errors.push(`skills/${dir}/ has no SKILL.md.`)
    continue
  }
  const fields = frontmatter(blob.toString('utf8'))
  if (!fields) {
    errors.push(`skills/${dir}/SKILL.md has no YAML frontmatter.`)
    continue
  }
  const name = fields.name || dir
  if (name !== dir) errors.push(`skills/${dir}/SKILL.md name "${name}" does not match its directory.`)
  const id = `${PLUGIN_NAME}:${name}`
  if (id.length > MAX_SKILL_ID) errors.push(`${id} is ${id.length} characters; the limit is ${MAX_SKILL_ID}.`)
  const description = fields.description ?? ''
  if (!description) errors.push(`skills/${dir}/SKILL.md has no description.`)
  if (description.length > MAX_DESCRIPTION) {
    errors.push(`skills/${dir}/SKILL.md description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}.`)
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`)
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`)
  console.error(`\n${errors.length} problem(s); no archive written.`)
  process.exit(1)
}

const dirty = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...pluginPaths], { cwd: ROOT })
if (dirty.status === 1) console.warn('warning: packaging committed HEAD; uncommitted plugin changes are excluded.')

mkdirSync(path.dirname(OUTPUT), { recursive: true })
rmSync(OUTPUT, { force: true })
git(['archive', '--format=zip', `--prefix=${PLUGIN_NAME}/`, '--output', OUTPUT, 'HEAD', '--', ...pluginPaths], { stdio: 'inherit' })
const bytes = statSync(OUTPUT).size
if (bytes > MAX_ARCHIVE_BYTES) {
  rmSync(OUTPUT)
  console.error(`error: the archive is ${(bytes / 1_000_000).toFixed(1)} MB; the upload limit is 100 MB.`)
  process.exit(1)
}
const files = entries.filter((entry) => entry.type === 'blob').length
console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${(bytes / 1_000_000).toFixed(2)} MB, ${files} files, version ${manifest.version}).`)

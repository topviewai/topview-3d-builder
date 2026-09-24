#!/usr/bin/env node
// Stage the renderer for the Python wheel: director-cli sources, the static page, and only the
// files of three / zod / @topview/3d-builder that Node or the headless page actually import.
// Playwright is not staged; `topview-3d-cli browser ensure` installs it into the user cache.
//
//   node scripts/stage-runtime.mjs <outDir> [--assets <builtin-assets dir>]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [outArg, ...rest] = process.argv.slice(2)
if (!outArg) {
  process.stderr.write('usage: stage-runtime.mjs <outDir> [--assets <dir>]\n')
  process.exit(2)
}
const OUT = path.resolve(outArg)
const OUT_CLI = path.join(OUT, 'director-cli')
const assetsIndex = rest.indexOf('--assets')
const ASSETS = assetsIndex >= 0 ? path.resolve(rest[assetsIndex + 1]) : null

// Must match the importmap in static/headless.html.
const IMPORT_MAP = {
  three: 'node_modules/three/build/three.module.js',
  'three/addons/': 'node_modules/three/examples/jsm/',
  zod: 'node_modules/zod/index.js',
}
const NODE_EXTERNAL = new Set(['playwright'])
const IMPORT_RE = [
  /(?:^|[;\s}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[;\s])import\s*['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function specifiers(file) {
  const text = readFileSync(file, 'utf8')
  const found = new Set()
  for (const re of IMPORT_RE) for (const match of text.matchAll(re)) found.add(match[1])
  return [...found]
}

function packageRoot(file) {
  let dir = path.dirname(file)
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
      if (name) return { dir, name }
    }
    dir = path.dirname(dir)
  }
  throw new Error(`no package.json above ${file}`)
}

const copied = new Set()
const packages = new Map()

function stageFile(source, target) {
  if (copied.has(target)) return false
  copied.add(target)
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(realpathSync(source), target)
  return true
}

// Where a resolved file lands in the staged tree.
function stagedPath(file) {
  const real = realpathSync(file)
  const own = realpathSync(ROOT)
  if (real.startsWith(own + path.sep) && !real.includes(`${path.sep}node_modules${path.sep}`)) {
    return path.join(OUT_CLI, path.relative(own, real))
  }
  const { dir, name } = packageRoot(real)
  if (packages.has(name) && packages.get(name) !== dir) {
    throw new Error(`two copies of ${name}: ${packages.get(name)} and ${dir}; align their versions`)
  }
  packages.set(name, dir)
  return path.join(OUT_CLI, 'node_modules', name, path.relative(dir, real))
}

function resolveBrowser(spec, from) {
  if (spec.startsWith('/')) return path.join(ROOT, spec.slice(1))
  if (spec.startsWith('.')) return path.resolve(path.dirname(from), spec)
  if (IMPORT_MAP[spec]) return path.join(ROOT, IMPORT_MAP[spec])
  const prefix = Object.keys(IMPORT_MAP).find((key) => key.endsWith('/') && spec.startsWith(key))
  if (prefix) return path.join(ROOT, IMPORT_MAP[prefix], spec.slice(prefix.length))
  throw new Error(`browser import ${spec} (from ${from}) is not in the importmap`)
}

function resolveNode(spec, from) {
  if (spec.startsWith('node:') || NODE_EXTERNAL.has(spec)) return null
  if (spec.startsWith('.')) return path.resolve(path.dirname(from), spec)
  return fileURLToPath(import.meta.resolve(spec, new URL(`file://${realpathSync(from)}`)))
}

function crawl(entries, resolve) {
  const queue = [...entries]
  const seen = new Set()
  while (queue.length) {
    const file = queue.pop()
    const real = realpathSync(file)
    if (seen.has(real)) continue
    seen.add(real)
    stageFile(file, stagedPath(file))
    if (!/\.(m?js)$/.test(file)) continue
    for (const spec of specifiers(file)) {
      const next = resolve(spec, file)
      if (next) queue.push(next)
    }
  }
}

function inlineModuleImports(html) {
  const text = readFileSync(html, 'utf8')
  const found = []
  for (const block of text.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) {
    for (const re of IMPORT_RE) for (const match of block[1].matchAll(re)) found.push(match[1])
  }
  return found
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT_CLI, { recursive: true })

const nodeEntries = readdirSync(ROOT).filter((name) => name.endsWith('.mjs')).map((name) => path.join(ROOT, name))
crawl(nodeEntries, resolveNode)

const staticDir = path.join(ROOT, 'static')
const html = path.join(staticDir, 'headless.html')
stageFile(html, path.join(OUT_CLI, 'static', 'headless.html'))
const browserEntries = [
  ...readdirSync(staticDir).filter((name) => name.endsWith('.mjs')).map((name) => path.join(staticDir, name)),
  ...inlineModuleImports(html).map((spec) => resolveBrowser(spec, html)),
]
crawl(browserEntries, resolveBrowser)

// Served as /draco/* by render.mjs; the builder dist ships the same files for other hosts.
const threeDraco = path.join(ROOT, 'node_modules/three/examples/jsm/libs/draco')
const builderDraco = path.join(ROOT, 'node_modules/@topview/3d-builder/dist/draco')
for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  stageFile(path.join(threeDraco, name), stagedPath(path.join(threeDraco, name)))
  stageFile(path.join(builderDraco, name), stagedPath(path.join(builderDraco, name)))
}

for (const [name, dir] of packages) {
  stageFile(path.join(dir, 'package.json'), path.join(OUT_CLI, 'node_modules', name, 'package.json'))
  for (const licence of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    if (existsSync(path.join(dir, licence))) stageFile(path.join(dir, licence), path.join(OUT_CLI, 'node_modules', name, licence))
  }
}
const self = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
writeFileSync(path.join(OUT_CLI, 'package.json'),
  `${JSON.stringify({ name: self.name, private: true, type: 'module', license: self.license }, null, 2)}\n`)

const version = (name) => JSON.parse(readFileSync(path.join(packages.get(name), 'package.json'), 'utf8')).version
const runtime = {
  builderVersion: version('@topview/3d-builder'),
  threeVersion: version('three'),
  zodVersion: version('zod'),
  playwrightVersion: self.dependencies.playwright,
}
writeFileSync(path.join(OUT, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`)

if (ASSETS) cpSync(ASSETS, path.join(OUT, 'builtin-assets'), { recursive: true })

let bytes = 0
const walk = (dir) => readdirSync(dir).forEach((name) => {
  const file = path.join(dir, name)
  const stat = statSync(file)
  if (stat.isDirectory()) walk(file)
  else bytes += stat.size
})
walk(OUT)
process.stdout.write(`${JSON.stringify({ ok: true, out: OUT, files: copied.size, bytes, packages: [...packages.keys()], ...runtime })}\n`)

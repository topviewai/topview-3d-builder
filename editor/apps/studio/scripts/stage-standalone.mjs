#!/usr/bin/env node
// Build Studio as a standalone Next.js server and stage it for the Python wheel.
//
//   node scripts/stage-standalone.mjs <outDir>
//
// The result runs with `node <outDir>/server.js` and needs no pnpm or checkout. pnpm's symlinked
// node_modules is flattened into plain directories because a wheel cannot hold symlinks, and
// hidden entries are dropped because setuptools does not package them. sharp is left out: it is
// native per platform and Studio does not optimize images.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = 'next-build'
const SKIP_PACKAGES = new Set(['sharp'])
const SKIP_SCOPES = new Set(['@img'])
const SKIP_APP_ENTRIES = new Set(['node_modules', 'drafts'])

const outArg = process.argv[2]
if (!outArg) {
  process.stderr.write('usage: stage-standalone.mjs <outDir>\n')
  process.exit(2)
}
const OUT = path.resolve(outArg)

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: APP, stdio: ['ignore', 2, 2], env: { ...process.env, ...env } })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function build() {
  const tsconfig = path.join(APP, 'tsconfig.json')
  const before = readFileSync(tsconfig, 'utf8')
  rmSync(path.join(APP, DIST), { recursive: true, force: true })
  run(process.execPath, [path.join(APP, 'scripts', 'copy-draco.cjs')])
  try {
    run(process.execPath, [path.join(APP, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
      STUDIO_STANDALONE: '1',
      NEXT_DIST_DIR: DIST,
      NEXT_TELEMETRY_DISABLED: '1',
    })
  } finally {
    // next build adds its dist dir to tsconfig; keep the checkout clean.
    writeFileSync(tsconfig, before)
  }
}

function hidden(name) {
  return name.startsWith('.')
}

function copyTree(source, target, skipTop = new Set()) {
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(source)) {
    if (hidden(name) || skipTop.has(name)) continue
    const from = path.join(source, name)
    const to = path.join(target, name)
    const real = realpathSync(from)
    if (statSync(real).isDirectory()) copyTree(real, to)
    else cpSync(real, to)
  }
}

function packageDirs(nodeModules) {
  const found = []
  if (!existsSync(nodeModules)) return found
  for (const name of readdirSync(nodeModules)) {
    if (hidden(name)) continue
    const entry = path.join(nodeModules, name)
    if (name.startsWith('@')) {
      if (SKIP_SCOPES.has(name)) continue
      for (const child of readdirSync(entry)) found.push({ name: `${name}/${child}`, dir: path.join(entry, child) })
    } else if (!SKIP_PACKAGES.has(name)) {
      found.push({ name, dir: entry })
    }
  }
  return found
}

function versionOf(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? '?'
  } catch {
    return '?'
  }
}

function collectPackages(standalone) {
  const roots = [path.join(standalone, 'node_modules'), path.join(standalone, 'apps', 'studio', 'node_modules')]
  const store = path.join(standalone, 'node_modules', '.pnpm')
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) roots.push(path.join(store, entry, 'node_modules'))
  }
  const packages = new Map()
  const conflicts = []
  for (const root of roots) {
    for (const { name, dir } of packageDirs(root)) {
      if (!existsSync(dir)) continue
      const real = realpathSync(dir)
      const known = packages.get(name)
      if (!known) packages.set(name, real)
      else if (known !== real && versionOf(known) !== versionOf(real)) {
        conflicts.push(`${name}: ${versionOf(known)} and ${versionOf(real)}`)
      }
    }
  }
  if (conflicts.length) {
    throw new Error(`two versions of the same package cannot share a flat node_modules:\n  ${[...new Set(conflicts)].join('\n  ')}`)
  }
  return packages
}

function sizeOf(dir) {
  let files = 0
  let bytes = 0
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name)
    const info = lstatSync(entry)
    if (info.isDirectory()) {
      const inner = sizeOf(entry)
      files += inner.files
      bytes += inner.bytes
    } else {
      files += 1
      bytes += info.size
    }
  }
  return { files, bytes }
}

build()
const standalone = path.join(APP, DIST, 'standalone')
const packages = collectPackages(standalone)
rmSync(OUT, { recursive: true, force: true })
copyTree(path.join(standalone, 'apps', 'studio'), OUT, SKIP_APP_ENTRIES)
for (const [name, dir] of packages) copyTree(dir, path.join(OUT, 'node_modules', name), new Set(['node_modules']))
copyTree(path.join(APP, DIST, 'static'), path.join(OUT, DIST, 'static'))
copyTree(path.join(APP, 'public'), path.join(OUT, 'public'))
rmSync(path.join(APP, DIST), { recursive: true, force: true })

const { files, bytes } = sizeOf(OUT)
process.stdout.write(`${JSON.stringify({ studio: OUT, packages: packages.size, files, bytes })}\n`)

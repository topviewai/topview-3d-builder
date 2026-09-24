import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// TOPVIEW3D_NODE_PREFIX is an npm prefix (it holds node_modules/playwright), used when the
// renderer ships inside the Python package; otherwise playwright resolves from here.
export function playwrightDir() {
  const prefix = process.env.TOPVIEW3D_NODE_PREFIX
  try {
    if (prefix) {
      const require = createRequire(path.join(path.resolve(prefix), 'package.json'))
      return path.dirname(require.resolve('playwright/package.json'))
    }
    return path.dirname(fileURLToPath(import.meta.resolve('playwright/package.json')))
  } catch {
    throw new Error('PLAYWRIGHT_NOT_INSTALLED')
  }
}

export async function loadPlaywright() {
  const dir = playwrightDir()
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const entry = manifest.exports?.['.']?.import ?? manifest.main ?? 'index.js'
  return import(pathToFileURL(path.join(dir, entry)).href)
}

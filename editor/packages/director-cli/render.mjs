import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlaywright } from './playwright.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const RENDERS_DIR_NAME = 'renders'
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/
const THREE_DRACO = path.join(ROOT, 'node_modules/three/examples/jsm/libs/draco')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}

function resolveServedFile(relative, localFiles) {
  const local = /^local-assets\/(\d+)\/[^/]+$/.exec(relative)
  if (local) return localFiles[Number(local[1])] ?? null
  if (relative === 'draco' || relative.startsWith('draco/')) {
    const rest = relative === 'draco' ? '' : relative.slice('draco/'.length)
    const file = path.normalize(path.join(THREE_DRACO, rest))
    return file.startsWith(THREE_DRACO) ? file : null
  }
  const file = path.normalize(path.join(ROOT, relative))
  return file.startsWith(ROOT) ? file : null
}

function serveRoot(localFiles = []) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'static/headless.html'
      const file = resolveServedFile(relative, localFiles)
      if (!file) {
        res.writeHead(403)
        res.end()
        return
      }
      const stream = createReadStream(file)
      stream.on('error', () => {
        res.writeHead(404)
        res.end()
      })
      stream.on('open', () => {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        stream.pipe(res)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}


// Requests may only reach the local static server and explicitly configured asset
// origins; anything else is aborted and reported, so offline renders stay offline.
export function assetOrigins(body) {
  const base = publicAssetBase(body)
  if (!base) return []
  try { return [new URL(base).origin] } catch { return [] }
}

// body.localAssets maps asset keys to absolute files; only those files are served.
export function localAssetFiles(body) {
  const entries = Object.entries(isPlainObject(body?.localAssets) ? body.localAssets : {})
  for (const [key, file] of entries) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(`LOCAL_ASSET_PATH_INVALID:${key}`)
  }
  return entries
}

function localAssetUrls(entries, origin) {
  return Object.fromEntries(entries.map(([key, file], index) =>
    [key, `${origin}/local-assets/${index}/${encodeURIComponent(path.basename(file))}`]))
}

export async function withPage(work, { allowedOrigins = [], localAssets = [] } = {}) {
  const playwright = await loadPlaywright()
  const { server, origin } = await serveRoot(localAssets.map(([, file]) => path.resolve(file)))
  const network = { blocked: [] }
  let browser
  try {
    browser = await playwright.chromium.launch({
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-dev-shm-usage',
        '--disable-web-security',
      ],
      chromiumSandbox: false,
    })
    const page = await browser.newPage()
    const allowed = new Set([origin, ...allowedOrigins])
    await page.route('**/*', (route) => {
      const url = route.request().url()
      let requestOrigin = 'null'
      try { requestOrigin = new URL(url).origin } catch { /* data:, blob: */ }
      if (allowed.has(requestOrigin) || /^(data|blob):/i.test(url)) return route.continue()
      if (network.blocked.length < 50) {
        try { const parsed = new URL(url); network.blocked.push(parsed.origin + parsed.pathname) }
        catch { network.blocked.push('[unparsable URL]') }
      }
      return route.abort('blockedbyclient')
    })
    const warnings = []
    page.on('console', (message) => {
      if (!['warning', 'error'].includes(message.type()) || warnings.length >= 20) return
      // Preserve asset-load diagnostics without returning signed URL credentials.
      warnings.push(message.text().replace(/https?:\/\/[^\s]+/g, (value) => {
        try { const url = new URL(value); return url.origin + url.pathname }
        catch { return '[asset URL]' }
      }))
    })
    page.on('pageerror', (error) => {
      process.stderr.write(`headless pageerror: ${error.message}\n${error.stack || ''}\n`)
    })
    await page.goto(`${origin}/static/headless.html`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__directorReady === true, null, { timeout: 30_000 })
    return await work(page, origin, warnings, network, localAssetUrls(localAssets, origin))
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function publicAssetBase(body) {
  return body.publicAssetBase
    || process.env.TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE
    || ''
}

// outputDir is `<absolute>/renders/<runId>`: the caller chooses the root (a project's
// .topview3d/renders), the renderer writes exactly one run directory below it.
export function resolveOutputDir(outputDir, pathApi = path) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) {
    throw new Error('RENDER_OUTPUT_DIR_REQUIRED')
  }
  if (!pathApi.isAbsolute(outputDir)) throw new Error('RENDER_OUTPUT_DIR_INVALID')
  if (outputDir.split(/[\\/]+/).some((segment) => segment === '..' || segment === '.')) {
    throw new Error('RENDER_OUTPUT_DIR_INVALID')
  }
  const resolved = pathApi.resolve(outputDir)
  const runId = pathApi.basename(resolved)
  const parent = pathApi.dirname(resolved)
  if (!RUN_ID.test(runId) || pathApi.basename(parent) !== RENDERS_DIR_NAME || parent === resolved) {
    throw new Error('RENDER_OUTPUT_DIR_INVALID')
  }
  return resolved
}

export function resolveRenderSize(body) {
  const requestedWidth = body.width ?? 640
  const requestedHeight = body.height ?? 360
  if (![requestedWidth, requestedHeight].every((value) => Number.isInteger(value) && value >= 64)) {
    throw new Error('render dimensions must be integers >=64')
  }
  const ratio = Math.min(1, 1024 / Math.max(requestedWidth, requestedHeight))
  return {
    width: Math.max(1, Math.round(requestedWidth * ratio)),
    height: Math.max(1, Math.round(requestedHeight * ratio)),
  }
}

export async function renderFrames(body) {
  const frames = body.frames ?? [0]
  if (!frames.length || frames.length > 9) throw new Error('contact sheet requires 1–9 frames')
  const outputDir = resolveOutputDir(body.outputDir)
  const { width, height } = resolveRenderSize(body)
  await mkdir(outputDir, { recursive: true })
  const localAssets = localAssetFiles(body)
  return withPage(async (page, origin, warnings, network, localAssetUrls) => {
    const result = await page.evaluate(async ({
      document, fcurves, frames, width, height, publicAssetBase, dracoDecoderPath, cameraNodeId, sceneSequence,
      localAssetUrls,
    }) => {
      const renderer = await window.createDirectorRenderer({
        document,
        fcurves,
        width,
        height,
        publicAssetBase,
        dracoDecoderPath,
        localAssetUrls,
      })
      try {
        const pngs = []
        for (const frame of frames) {
          const blob = await renderer.renderFrame(frame, cameraNodeId ? { cameraId: cameraNodeId } : undefined)
          const buffer = await blob.arrayBuffer()
          pngs.push({
            frame,
            base64: window.bytesToBase64(buffer),
            bytes: buffer.byteLength,
          })
        }
        const sheet = await window.composeContactSheet(pngs, width, height,
          cameraNodeId ? `${cameraNodeId} · scene ${sceneSequence ?? '?'}` : '')
        return { pngs, sheet }
      } finally {
        renderer.dispose()
      }
    }, {
      document: body.document,
      fcurves: body.fcurves ?? null,
      frames,
      cameraNodeId: body.cameraNodeId,
      sceneSequence: body.sceneSequence,
      width,
      height,
      publicAssetBase: publicAssetBase(body),
      dracoDecoderPath: `${origin}/draco/`,
      localAssetUrls,
    })
    const blank = result.pngs.some((item) => item.bytes < 256)
    const frameEntries = []
    for (const item of result.pngs) {
      const buffer = Buffer.from(item.base64, 'base64')
      const file = path.join(outputDir, `frame-${item.frame}.png`)
      await writeFile(file, buffer)
      frameEntries.push({
        frame: item.frame,
        path: file,
        mimeType: 'image/png',
        sizeBytes: buffer.byteLength,
        sha256: digest(buffer),
      })
    }
    const sheetBuffer = Buffer.from(result.sheet, 'base64')
    const sheetFile = path.join(outputDir, 'contact-sheet.png')
    await writeFile(sheetFile, sheetBuffer)
    const cameraNodeId = body.cameraNodeId ?? body.document?.content?.activeShotCameraNodeId
    const contactSheet = {
      path: sheetFile,
      mimeType: 'image/png',
      sizeBytes: sheetBuffer.byteLength,
      sha256: digest(sheetBuffer),
    }
    const manifestFile = path.join(outputDir, 'render.json')
    await writeFile(manifestFile, `${JSON.stringify({
      version: 1,
      runId: path.basename(outputDir),
      createdAt: new Date().toISOString(),
      width,
      height,
      cameraNodeId,
      sceneSequence: body.sceneSequence,
      frames: frameEntries.map(({ path: file, ...entry }) => ({ ...entry, file: path.basename(file) })),
      contactSheet: { ...contactSheet, path: undefined, file: path.basename(sheetFile) },
      blank,
      blockedRequests: network.blocked,
      ...(isPlainObject(body.metadata) ? { metadata: body.metadata } : {}),
    }, null, 2)}\n`)
    return {
      outputDir,
      manifest: manifestFile,
      cameraNodeId,
      sceneSequence: body.sceneSequence,
      frames: frameEntries,
      contactSheet,
      blank,
      blockedRequests: network.blocked,
      warnings,
    }
  }, { allowedOrigins: assetOrigins(body), localAssets })
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function inspectNodes(body) {
  if (!body || typeof body.document !== 'object' || !Array.isArray(body.nodeIds) || !body.nodeIds.length) {
    throw new Error('document and nodeIds required')
  }
  const localAssets = localAssetFiles(body)
  return withPage(async (page, origin, warnings, network, localAssetUrls) => {
    const nodes = await page.evaluate(async (input) => window.inspectDirectorNodes(input), {
      localAssetUrls,
      document: body.document,
      fcurves: body.fcurves ?? null,
      nodeIds: body.nodeIds,
      frame: body.frames?.[0],
      publicAssetBase: publicAssetBase(body),
      dracoDecoderPath: `${origin}/draco/`,
    })
    return { ok: nodes.every((node) => node.status === 'measured'), nodes, warnings, blockedRequests: network.blocked }
  }, { allowedOrigins: assetOrigins(body), localAssets })
}

export async function applyLibraryPose(body) {
  if (!body || typeof body.document !== 'object') {
    throw new Error('document required')
  }
  const localAssets = localAssetFiles(body)
  return withPage(async (page, origin, warnings, network, localAssetUrls) => page.evaluate(
    (input) => window.compileDirectorPose(input),
    { ...body, localAssets: undefined, localAssetUrls, publicAssetBase: publicAssetBase(body),
      dracoDecoderPath: `${origin}/draco/` },
  ), { allowedOrigins: assetOrigins(body), localAssets })
}

// Compiles several library poses against one loaded page; the document is not modified.
export async function applyLibraryPoses(body) {
  if (!body || typeof body.document !== 'object' || !Array.isArray(body.items) || !body.items.length) {
    throw new Error('document and items required')
  }
  const localAssets = localAssetFiles(body)
  return withPage(async (page, origin, warnings, network, localAssetUrls) => {
    const results = []
    for (const item of body.items) {
      results.push(await page.evaluate((input) => window.compileDirectorPose(input), {
        document: body.document,
        nodeId: item.nodeId,
        libraryId: item.libraryId,
        pose: item.pose,
        localAssetUrls,
        publicAssetBase: publicAssetBase(body),
        dracoDecoderPath: `${origin}/draco/`,
      }))
    }
    return { results, warnings, blockedRequests: network.blocked }
  }, { allowedOrigins: assetOrigins(body), localAssets })
}

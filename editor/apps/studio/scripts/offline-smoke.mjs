// 离线验收：启动已构建的 Studio（next start），浏览器只放行 localhost，
// 走一遍 新建草稿 → 搜索素材 → 放角色 → 套姿势 → 保存，断言没有登录界面、没有外部请求。
// 用法：pnpm --filter @topview/3d-studio build && pnpm --filter @topview/3d-studio test:offline
// 已有服务时设 STUDIO_URL 跳过启动；SMOKE_SCREENSHOT=path 保存最后一帧截图。
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SMOKE_PORT || 3117)
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function fail(message) {
  throw new Error(`offline smoke: ${message}`)
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) fail(`next start exited with ${child.exitCode}`)
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  fail(`server did not start at ${url}`)
}

async function main() {
  let server = null
  const base = process.env.STUDIO_URL || `http://localhost:${PORT}`
  if (!process.env.STUDIO_URL) {
    server = spawn(path.join(studioDir, 'node_modules/.bin/next'), ['start', '--port', String(PORT)], {
      cwd: studioDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, NODE_ENV: 'production' },
      shell: process.platform === 'win32',
    })
  }
  const external = []
  const failed = []
  let draftId = null
  const browser = await chromium.launch()
  try {
    await waitForServer(base, server)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.protocol === 'data:' || url.protocol === 'blob:' || LOCAL_HOSTS.has(url.hostname)) return route.continue()
      external.push(url.href)
      return route.abort('internetdisconnected')
    })
    const page = await context.newPage()
    page.on('response', (res) => {
      if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`)
    })

    await page.goto(base)
    await page.getByRole('button', { name: '新建草稿' }).first().click()
    await page.getByRole('button', { name: '创建并打开' }).click()
    await page.waitForFunction(() => window.__store?.getState?.().ready === true, null, { timeout: 60_000 })
    draftId = new URL(page.url()).searchParams.get('draft')
    if (!draftId) fail('draft id missing from URL')
    if (await page.getByText(/登录|sign in/i).count()) fail('login UI is visible')

    const search = await page.evaluate(async () => {
      const res = await fetch('/api/local-assets/search?kind=pose&keyword=sit&pageNo=1&pageSize=5')
      return res.json()
    })
    if (!search.total) fail('pose search returned nothing')

    const nodesBefore = await page.evaluate(() => window.__store.getState().doc?.content.nodes.length ?? 0)
    await page.getByText('男性', { exact: true }).click()
    await page.waitForFunction(
      (count) => (window.__store.getState().doc?.content.nodes.length ?? 0) > count,
      nodesBefore,
      { timeout: 30_000 },
    )

    await page.locator('.t3d-inspector-tab', { hasText: '姿势' }).click()
    await page.locator('.t3d-pose-tag', { hasText: /坐|sit/i }).first().click()
    const poseCell = page.locator('button.t3d-pose-atlas-cell:not(.is-skel)').first()
    await poseCell.waitFor({ timeout: 30_000 })
    await poseCell.click()
    await page.waitForFunction(() => {
      const ids = [...JSON.stringify(window.__store.getState().doc).matchAll(/"posePresetId":"([^"]+)"/g)].map((m) => m[1])
      return ids.some((id) => id !== 'stand')
    }, null, { timeout: 30_000 })

    const saveError = await page.evaluate(() => window.__store.getState().save({ captureCover: false }))
    if (saveError) fail(`save failed: ${saveError}`)
    const saved = await page.evaluate(async (id) => (await fetch(`/api/drafts/${id}`)).json(), draftId)
    const characters = saved.content.nodes.filter((node) => node.type === 'character')
    if (characters.length < 2) fail(`saved draft has ${characters.length} characters`)
    const poses = [...JSON.stringify(saved).matchAll(/"posePresetId":"([^"]+)"/g)].map((m) => m[1])
    if (!poses.some((id) => id !== 'stand')) fail('saved draft lost the pose')

    await page.locator('.t3d-rail-btn, [role="tab"]', { hasText: '动作' }).first().click().catch(() => undefined)
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT })

    if (external.length) fail(`external requests: ${external.join(', ')}`)
    if (failed.length) fail(`failed responses: ${failed.join(', ')}`)
    console.log(`offline smoke ok: draft ${draftId}, ${characters.length} characters, pose search ${search.total} hits, 0 external requests, poses ${poses.join(',')}`)
  } finally {
    await browser.close()
    if (draftId) {
      await rm(path.join(studioDir, 'drafts', `${draftId}.json`), { force: true })
      await rm(path.join(studioDir, 'drafts', `${draftId}.fcurves.json`), { force: true })
    }
    server?.kill()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

import { spawn } from 'node:child_process'
import path from 'node:path'
import { loadPlaywright, playwrightDir } from './playwright.mjs'

function runPlaywright(args) {
  return new Promise((resolve, reject) => {
    // stdout carries the command's JSON result; installer progress goes to stderr.
    const child = spawn(process.execPath, [path.join(playwrightDir(), 'cli.js'), ...args],
      { stdio: ['ignore', process.stderr, 'inherit'] })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`PLAYWRIGHT_INSTALL_FAILED:${signal || code}`))
    })
  })
}

export async function ensureBrowser({ withDeps = false } = {}) {
  if (withDeps && process.platform !== 'linux') {
    throw new Error('--with-deps is supported on Linux only; macOS and Windows use their native browser dependencies')
  }

  if (withDeps) await runPlaywright(['install-deps', 'chromium'])
  await runPlaywright(['install', 'chromium'])

  const { chromium } = await loadPlaywright()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    return {
      ok: true,
      browser: 'chromium',
      version: browser.version(),
      executablePath: chromium.executablePath(),
      platform: process.platform,
      arch: process.arch,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (process.platform === 'linux' && !withDeps) {
      throw new Error(`CHROMIUM_LAUNCH_FAILED:${detail}\nRetry with: node cli.mjs browser ensure --with-deps`)
    }
    throw new Error(`CHROMIUM_LAUNCH_FAILED:${detail}`)
  } finally {
    if (browser) await browser.close()
  }
}

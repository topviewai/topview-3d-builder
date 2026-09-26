// 本地 Studio 通过 Topview MCP 列出、新建 Canvas，并把渲染结果上传进去。
// 登录态存在用户缓存，和 CLI 的缓存目录同一处。
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const MCP_URL = 'https://mcp-browser.topview.ai'
const AUTH_ISSUER = 'https://mcp.topview.ai'
const PLUGIN_VERSION = '1.0.4'

export class TopviewCanvasAuthError extends Error {
  constructor() {
    super('TOPVIEW_CANVAS_AUTH')
    this.name = 'TopviewCanvasAuthError'
  }
}

export interface TopviewCanvasSummary {
  id: string
  name: string
}

interface OAuthDoc {
  clientId: string
  redirectUris?: string[]
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

interface PendingLogin {
  verifier: string
  state: string
  redirectUri: string
  returnTo: string
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

function authPath(): string {
  return path.join(cacheDir(), 'studio', 'topview-oauth.json')
}

function pendingPath(): string {
  return path.join(cacheDir(), 'studio', 'topview-oauth-pending.json')
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value), 'utf8')
}

async function authMetadata(): Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint: string }> {
  const res = await fetch(`${AUTH_ISSUER}/.well-known/oauth-authorization-server`)
  if (!res.ok) throw new Error(`OAuth metadata HTTP ${res.status}`)
  return res.json() as Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint: string }>
}

/** 授权服务只认注册时登记过的回调地址，所以 localhost 和 127.0.0.1 两种写法都登记上。 */
function loopbackVariants(redirectUri: string): string[] {
  const url = new URL(redirectUri)
  const variants = new Set([url.toString()])
  for (const host of ['localhost', '127.0.0.1']) {
    const copy = new URL(url)
    copy.hostname = host
    variants.add(copy.toString())
  }
  return [...variants]
}

async function clientId(redirectUri: string, meta: { registration_endpoint: string }): Promise<string> {
  const saved = readJson<OAuthDoc>(authPath())
  if (saved?.clientId && saved.redirectUris?.includes(redirectUri)) return saved.clientId
  const redirectUris = loopbackVariants(redirectUri)
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Topview 3D Builder',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) throw new Error(`OAuth register HTTP ${res.status}`)
  const body = (await res.json()) as { client_id?: string }
  if (!body.client_id) throw new Error('OAuth register returned no client_id')
  writeJson(authPath(), { clientId: body.client_id, redirectUris })
  return body.client_id
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export async function beginLogin(origin: string, returnTo: string): Promise<string> {
  const redirectUri = `${origin}/api/topview-canvas/callback`
  const meta = await authMetadata()
  const id = await clientId(redirectUri, meta)
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  const pending: PendingLogin = { verifier, state, redirectUri, returnTo }
  writeJson(pendingPath(), pending)
  const url = new URL(meta.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', id)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'mcp:tools')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', MCP_URL)
  return url.toString()
}

export function cancelLogin(state: string): void {
  const pending = readJson<PendingLogin>(pendingPath())
  if (pending?.state === state) rmSync(pendingPath(), { force: true })
}

export async function finishLogin(code: string, state: string): Promise<string> {
  const pending = readJson<PendingLogin>(pendingPath())
  if (!pending || pending.state !== state) throw new Error('登录状态无效，请重新登录')
  if (!code) throw new Error('授权服务没有返回授权码，请重新登录')
  const saved = readJson<OAuthDoc>(authPath())
  if (!saved?.clientId) throw new Error('缺少 OAuth client')
  const meta = await authMetadata()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: saved.clientId,
    code_verifier: pending.verifier,
    resource: MCP_URL,
  })
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`OAuth token HTTP ${res.status}`)
  const token = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!token.access_token) throw new Error('OAuth token 为空')
  rmSync(pendingPath(), { force: true })
  writeJson(authPath(), {
    clientId: saved.clientId,
    redirectUris: saved.redirectUris,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  })
  return pending.returnTo || '/'
}

async function accessToken(): Promise<string> {
  const saved = readJson<OAuthDoc>(authPath())
  if (!saved?.accessToken) throw new TopviewCanvasAuthError()
  if (saved.expiresAt && saved.expiresAt > Date.now() + 30_000) return saved.accessToken
  if (!saved.refreshToken || !saved.clientId) throw new TopviewCanvasAuthError()
  const meta = await authMetadata()
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: saved.refreshToken,
      client_id: saved.clientId,
      resource: MCP_URL,
    }),
  })
  if (!res.ok) throw new TopviewCanvasAuthError()
  const token = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!token.access_token) throw new TopviewCanvasAuthError()
  writeJson(authPath(), {
    ...saved,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || saved.refreshToken,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  })
  return token.access_token
}

export async function isAuthorized(): Promise<boolean> {
  try {
    await accessToken()
    return true
  } catch (error) {
    if (error instanceof TopviewCanvasAuthError) return false
    throw error
  }
}

interface McpResult {
  content?: { type?: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function parseSse(text: string): unknown {
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1)
  return data ? JSON.parse(data) : JSON.parse(text)
}

async function mcpCall(name: string, args: Record<string, unknown>): Promise<McpResult> {
  const token = await accessToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-03-26',
    'X-Topview-Plugin-Version': PLUGIN_VERSION,
    'X-Topview-Plugin-Client': 'codex',
  }
  const post = async (body: unknown, session?: string) => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: session ? { ...headers, 'Mcp-Session-Id': session } : headers,
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (res.status === 401) throw new TopviewCanvasAuthError()
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 240)}`)
    const payload = (text.includes('data:') ? parseSse(text) : JSON.parse(text)) as {
      result?: McpResult
      error?: { message?: string }
    }
    return { payload, session: res.headers.get('mcp-session-id') || undefined }
  }
  const opened = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'topview-3d-builder', version: PLUGIN_VERSION },
    },
  })
  const called = await post(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    opened.session,
  )
  if (called.payload.error) throw new Error(called.payload.error.message || 'MCP 调用失败')
  const result = called.payload.result
  if (!result) throw new Error('MCP 没有返回结果')
  if (result.isError) {
    const text = result.content?.map((item) => item.text || '').join('\n') || 'MCP 工具失败'
    throw new Error(text)
  }
  return result
}

function textOf(result: McpResult): string {
  return result.content?.map((item) => item.text || '').join('\n') || ''
}

function canvasesFrom(result: McpResult): TopviewCanvasSummary[] {
  const structured = result.structuredContent?.canvases
  const rows = Array.isArray(structured) ? structured : []
  const out: TopviewCanvasSummary[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as { canvasId?: unknown; id?: unknown; name?: unknown }
    const id = typeof item.canvasId === 'string' ? item.canvasId : typeof item.id === 'string' ? item.id : ''
    if (!id) continue
    out.push({ id, name: typeof item.name === 'string' && item.name ? item.name : id })
  }
  if (out.length) return out
  const text = textOf(result)
  for (const match of text.matchAll(/canvasId=([\w.:@-]{1,128})(?:\s+name=([^\n]+))?/g)) {
    out.push({ id: match[1], name: (match[2] || match[1]).trim() })
  }
  return out
}

export async function listCanvases(): Promise<TopviewCanvasSummary[]> {
  return canvasesFrom(await mcpCall('list_topview_canvases', { limit: 20 }))
}

export async function createCanvas(name: string): Promise<TopviewCanvasSummary> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200) throw new Error('Canvas 名称需要 1 到 200 个字符')
  const result = await mcpCall('create_topview_canvas', { name: trimmed })
  const created = canvasesFrom(result)[0]
  if (created) return created
  const id = textOf(result).match(/canvasId=([\w.:@-]{1,128})/)?.[1]
  if (!id) throw new Error('新建 Canvas 没有返回 id')
  return { id, name: trimmed }
}

export async function uploadRender(canvasId: string, fileName: string, mimeType: string, bytes: Buffer): Promise<string> {
  const prepared = await mcpCall('prepare_topview_canvas_media_upload', {
    canvasId,
    fileName,
    fileSize: bytes.byteLength,
  })
  const fields = prepared.structuredContent ?? {}
  const text = textOf(prepared)
  const read = (key: string): string => {
    const value = fields[key]
    if (typeof value === 'string' && value) return value
    return text.match(new RegExp(`${key}=(\\S+)`))?.[1] || ''
  }
  const uploadUrl = read('uploadUrl')
  const objectKey = read('objectKey')
  const mediaType = read('mediaType') || (mimeType.startsWith('video/') ? 'video' : 'image')
  const exactMime = read('mimeType') || mimeType
  if (!uploadUrl || !objectKey) throw new Error('上传准备没有返回地址')
  const required = fields.requiredHeaders
  const headers: Record<string, string> = { 'Content-Type': exactMime }
  if (required && typeof required === 'object') {
    for (const [key, value] of Object.entries(required as Record<string, unknown>)) {
      if (typeof value === 'string') headers[key] = value
    }
  }
  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: new Uint8Array(bytes) })
  if (!put.ok) throw new Error(`上传失败 HTTP ${put.status}`)
  const created = await mcpCall('create_topview_canvas_media_node', {
    canvasId,
    mediaType,
    url: objectKey,
    mimeType: exactMime,
    title: fileName,
    x: 40,
    y: 40,
  })
  return textOf(created).match(/node_[\w-]{1,128}/)?.[0] || objectKey
}

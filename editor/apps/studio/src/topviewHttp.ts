// 访问 Topview 的请求走 node:https，而不是全局 fetch：fetch 的连接超时固定 10 秒，
// 走代理时 TLS 握手可能超过 10 秒。长连接复用后，同一主机后续请求不用再握手。
import https from 'node:https'

const agent = new https.Agent({ keepAlive: true, maxSockets: 8 })
const CONNECT_TIMEOUT_MS = 60_000
const RESPONSE_TIMEOUT_MS = 120_000

export interface TopviewResponse {
  ok: boolean
  status: number
  headers: Record<string, string | string[] | undefined>
  text(): string
  json<T = unknown>(): T
}

export class TopviewNetworkError extends Error {
  constructor(host: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`连不上 ${host}：${detail}。检查网络或代理后重试。`)
    this.name = 'TopviewNetworkError'
  }
}

export function topviewRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal } = {},
): Promise<TopviewResponse> {
  const target = new URL(url)
  const body = typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : init.body
  const headers: Record<string, string | number> = { ...init.headers }
  if (body) headers['Content-Length'] = body.byteLength
  const signal = init.signal
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.aborted ? signal.reason : new TopviewNetworkError(target.host, error))
    }
    const onAbort = () => req.destroy(new Error('已取消'))
    const req = https.request(target, { method: init.method ?? 'GET', headers, agent }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', fail)
      res.on('end', () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        const raw = Buffer.concat(chunks).toString('utf8')
        const status = res.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: res.headers,
          text: () => raw,
          json: <T>() => JSON.parse(raw) as T,
        })
      })
    })
    const connectTimer = setTimeout(() => req.destroy(new Error('连接超时')), CONNECT_TIMEOUT_MS)
    req.on('socket', (socket) => {
      if (!socket.connecting) clearTimeout(connectTimer)
      else socket.once('secureConnect', () => clearTimeout(connectTimer))
    })
    req.setTimeout(RESPONSE_TIMEOUT_MS, () => req.destroy(new Error('响应超时')))
    req.on('error', (error) => {
      clearTimeout(connectTimer)
      fail(error)
    })
    req.on('close', () => clearTimeout(connectTimer))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (body) req.write(body)
    req.end()
  })
}

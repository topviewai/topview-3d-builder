import { NextResponse } from 'next/server'
import { beginLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

/** 登录完成后只回 Studio 自己的页面，不接受外站地址。 */
function localPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/api/topview-canvas/done'
  }
  return value
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const target = await beginLogin(url.origin, localPath(url.searchParams.get('return')))
    return NextResponse.redirect(target)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Topview</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#222">
<p>暂时打不开 TopView 登录页。</p>
<p style="color:#666">${escapeHtml(message)}</p>
<p><a href="${escapeHtml(url.pathname + url.search)}">重试</a></p>
</body>
</html>`
    return new Response(html, { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}

import { NextResponse } from 'next/server'
import { cancelLogin, finishLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

function page(message: string, status: number): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Topview</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#222">
<p>${message}</p>
</body>
</html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  if (url.searchParams.get('error')) {
    cancelLogin(state)
    return page('没有完成 TopView 授权。回到 Studio 的导出窗口，点「注册/登录 TopView」可以重新授权。', 200)
  }
  try {
    const returnTo = await finishLogin(code, state)
    return NextResponse.redirect(new URL(returnTo, url.origin))
  } catch {
    return page('TopView 授权没有完成。回到 Studio 的导出窗口，点「注册/登录 TopView」重新授权。', 400)
  }
}

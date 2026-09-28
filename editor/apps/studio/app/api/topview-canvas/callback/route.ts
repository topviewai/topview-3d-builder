import { NextResponse } from 'next/server'
import { htmlPage, requestT } from '../../../../src/locale/server'
import { cancelLogin, finishLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const { locale, html } = requestT(request)
  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  if (url.searchParams.get('error')) {
    cancelLogin(state)
    return htmlPage(locale, `<p>${html('没有完成 TopView 授权。回到 Studio 的导出窗口，点「注册/登录 TopView」可以重新授权。')}</p>`)
  }
  try {
    const returnTo = await finishLogin(code, state)
    return NextResponse.redirect(new URL(returnTo, url.origin))
  } catch {
    return htmlPage(locale, `<p>${html('TopView 授权没有完成。回到 Studio 的导出窗口，点「注册/登录 TopView」重新授权。')}</p>`, 400)
  }
}

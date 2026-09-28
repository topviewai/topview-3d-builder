import { NextResponse } from 'next/server'
import { escapeHtml, htmlPage, requestT } from '../../../../src/locale/server'
import { beginLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

/** 登录完成后只回 Studio 自己的页面，不接受外站地址。 */
function localPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/api/topview-canvas/done'
  }
  return value
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const target = await beginLogin(url.origin, localPath(url.searchParams.get('return')))
    return NextResponse.redirect(target)
  } catch (failure) {
    const { locale, html, error } = requestT(request)
    return htmlPage(locale, `<p>${html('暂时打不开 TopView 登录页。')}</p>
<p style="color:#666">${escapeHtml(error(failure))}</p>
<p><a href="${escapeHtml(url.pathname + url.search)}">${html('重试')}</a></p>`, 502)
  }
}

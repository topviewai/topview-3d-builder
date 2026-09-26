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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const target = await beginLogin(url.origin, localPath(url.searchParams.get('return')))
    return NextResponse.redirect(target)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

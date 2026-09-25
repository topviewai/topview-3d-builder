import { NextResponse } from 'next/server'
import { beginLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('return') || request.headers.get('referer') || '/'
  try {
    const target = await beginLogin(url.origin, returnTo)
    return NextResponse.redirect(target)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

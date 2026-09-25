import { NextResponse } from 'next/server'
import { finishLogin } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  try {
    const returnTo = await finishLogin(code, state)
    return NextResponse.redirect(returnTo.startsWith('http') ? returnTo : new URL(returnTo, url.origin))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

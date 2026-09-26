import { NextResponse } from 'next/server'
import { isAuthorized } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ authorized: await isAuthorized() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

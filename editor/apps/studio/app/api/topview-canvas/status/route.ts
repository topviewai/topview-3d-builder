import { NextResponse } from 'next/server'
import { requestT } from '../../../../src/locale/server'
import { isAuthorized } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    return NextResponse.json({ authorized: await isAuthorized() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: requestT(request).error(error) }, { status: 502 })
  }
}

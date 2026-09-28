import { NextResponse } from 'next/server'
import { requestT } from '../../../../src/locale/server'
import { StudioError } from '../../../../src/locale/catalog'
import { TopviewCanvasAuthError, createCanvas, listCanvases } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

function fail(request: Request, error: unknown): Response {
  if (error instanceof TopviewCanvasAuthError) {
    return NextResponse.json({ error: 'auth', loginUrl: '/api/topview-canvas/login' }, { status: 401 })
  }
  const status = error instanceof StudioError && error.status ? error.status : 502
  return NextResponse.json({ error: requestT(request).error(error) }, { status })
}

export async function GET(request: Request): Promise<Response> {
  try {
    return NextResponse.json({ canvases: await listCanvases() })
  } catch (error) {
    return fail(request, error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name : ''
    return NextResponse.json({ canvas: await createCanvas(name) })
  } catch (error) {
    return fail(request, error)
  }
}

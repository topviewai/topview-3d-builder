import { NextResponse } from 'next/server'
import { TopviewCanvasAuthError, createCanvas, listCanvases } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

function fail(error: unknown): Response {
  if (error instanceof TopviewCanvasAuthError) {
    return NextResponse.json({ error: 'auth', loginUrl: '/api/topview-canvas/login' }, { status: 401 })
  }
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 502 })
}

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ canvases: await listCanvases() })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { name?: unknown }
    const name = typeof body.name === 'string' ? body.name : ''
    return NextResponse.json({ canvas: await createCanvas(name) })
  } catch (error) {
    return fail(error)
  }
}

import { NextResponse } from 'next/server'
import { TopviewCanvasAuthError, canvasWebUrl, uploadRender } from '../../../../src/topviewCanvas'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData()
    const canvasId = String(form.get('canvasId') || '')
    const file = form.get('file')
    if (!canvasId || !(file instanceof File)) {
      return NextResponse.json({ error: '缺少 canvas 或文件' }, { status: 400 })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const nodeId = await uploadRender(
      canvasId,
      file.name || 'render.png',
      file.type || 'application/octet-stream',
      bytes,
      request.signal,
    )
    return NextResponse.json({ nodeId, canvasUrl: canvasWebUrl(canvasId) })
  } catch (error) {
    if (error instanceof TopviewCanvasAuthError) {
      return NextResponse.json({ error: 'auth', loginUrl: '/api/topview-canvas/login' }, { status: 401 })
    }
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

import { adoptProjectEdit, readProjectFCurves } from '../../../../../src/localProjects'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const data = readProjectFCurves(id)
  if (!data) return Response.json({ error: `项目没有 fcurves: ${id}` }, { status: 404 })
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }
  try {
    adoptProjectEdit(id, { fcurves: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes('项目不存在') ? 404 : 400
    return Response.json({ error: message }, { status })
  }
  return Response.json({ id })
}

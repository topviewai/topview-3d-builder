import { readProjectDocument } from '../../../../src/localProjects'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const doc = readProjectDocument(id)
  if (!doc) return Response.json({ error: `项目不存在: ${id}` }, { status: 404 })
  return Response.json(doc, { headers: { 'Cache-Control': 'no-store' } })
}

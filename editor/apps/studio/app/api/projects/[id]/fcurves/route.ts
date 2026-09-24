import { readProjectFCurves } from '../../../../../src/localProjects'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const data = readProjectFCurves(id)
  if (!data) return Response.json({ error: `项目没有 fcurves: ${id}` }, { status: 404 })
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

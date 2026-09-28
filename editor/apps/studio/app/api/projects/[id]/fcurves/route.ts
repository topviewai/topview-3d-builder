import { adoptProjectEdit, readProjectFCurves } from '../../../../../src/localProjects'
import { errorStatus, requestT } from '../../../../../src/locale/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { t } = requestT(request)
  const { id } = await ctx.params
  const data = readProjectFCurves(id)
  if (!data) return Response.json({ error: t('项目没有 fcurves: {{id}}', { id }) }, { status: 404 })
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { t, error: errorText } = requestT(request)
  const { id } = await ctx.params
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return Response.json({ error: t('请求体不是合法 JSON') }, { status: 400 })
  }
  try {
    adoptProjectEdit(id, { fcurves: data })
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: errorStatus(error, 400) })
  }
  return Response.json({ id })
}

import { readFCurves, writeUserFCurves } from '../../../../../src/draftStore'
import { errorStatus, requestT } from '../../../../../src/locale/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const data = await readFCurves(id)
  if (!data) return Response.json(null, { headers: { 'Cache-Control': 'no-store' } })
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { t, error } = requestT(request)
  const { id } = await ctx.params
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return Response.json({ error: t('请求体不是合法 JSON') }, { status: 400 })
  }
  try {
    await writeUserFCurves(id, data)
  } catch (e) {
    return Response.json({ error: error(e) }, { status: errorStatus(e, 400) })
  }
  return Response.json({ id })
}

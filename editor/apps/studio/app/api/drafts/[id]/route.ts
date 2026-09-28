import { deleteUserDraft, readDraft, writeUserDraft } from '../../../../src/draftStore'
import { errorStatus, requestT } from '../../../../src/locale/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { t } = requestT(request)
  const { id } = await ctx.params
  const doc = await readDraft(id)
  if (!doc) return Response.json({ error: t('草稿不存在: {{detail}}', { detail: id }) }, { status: 404 })
  return Response.json(doc, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { t, error } = requestT(request)
  const { id } = await ctx.params
  let doc: unknown
  try {
    doc = await request.json()
  } catch {
    return Response.json({ error: t('请求体不是合法 JSON') }, { status: 400 })
  }
  try {
    await writeUserDraft(id, doc)
  } catch (e) {
    return Response.json({ error: error(e) }, { status: errorStatus(e, 400) })
  }
  return Response.json({ id })
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { t } = requestT(request)
  const { id } = await ctx.params
  const ok = await deleteUserDraft(id)
  if (!ok) return Response.json({ error: t('草稿不存在: {{detail}}', { detail: id }) }, { status: 404 })
  return Response.json({ id })
}

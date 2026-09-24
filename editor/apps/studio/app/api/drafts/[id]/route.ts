import { deleteUserDraft, readDraft, writeUserDraft } from '../../../../src/draftStore'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const doc = await readDraft(id)
  if (!doc) return Response.json({ error: `草稿不存在: ${id}` }, { status: 404 })
  return Response.json(doc, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  let doc: unknown
  try {
    doc = await request.json()
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }
  try {
    await writeUserDraft(id, doc)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
  return Response.json({ id })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  const ok = await deleteUserDraft(id)
  if (!ok) return Response.json({ error: `草稿不存在: ${id}` }, { status: 404 })
  return Response.json({ id })
}

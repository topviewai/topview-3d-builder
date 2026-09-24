import { isValidDraftId, listUserDrafts, readDraft, writeUserDraft } from '../../../src/draftStore'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await listUserDrafts()
  return Response.json({ user })
}

interface CreateBody {
  id?: string
  doc?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!isValidDraftId(id)) {
    return Response.json({ error: `非法草稿 id: ${id}` }, { status: 400 })
  }
  if (await readDraft(id)) {
    return Response.json({ error: `草稿已存在: ${id}` }, { status: 409 })
  }
  if (!body.doc) {
    return Response.json({ error: '缺少 doc' }, { status: 400 })
  }

  await writeUserDraft(id, body.doc)
  return Response.json({ id }, { status: 201 })
}

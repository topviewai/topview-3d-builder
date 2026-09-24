import { searchAssets } from '../../../../src/localAssets'

export const runtime = 'nodejs'

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams
  const page = searchAssets({
    kind: params.get('kind') ?? '',
    keyword: params.get('keyword') ?? undefined,
    category: params.get('category') ?? undefined,
    tags: params.getAll('tags'),
    pageNo: Number(params.get('pageNo')) || 1,
    pageSize: Number(params.get('pageSize')) || 50,
  })
  return Response.json(page, { headers: { 'Cache-Control': 'no-store' } })
}

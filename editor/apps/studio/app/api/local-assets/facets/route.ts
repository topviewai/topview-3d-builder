import { assetFacets } from '../../../../src/localAssets'

export const runtime = 'nodejs'

export function GET(request: Request): Response {
  const kind = new URL(request.url).searchParams.get('kind') ?? ''
  return Response.json(assetFacets(kind), { headers: { 'Cache-Control': 'no-store' } })
}

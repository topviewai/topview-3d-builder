import { fileResponse, findAssetById } from '../../../../../src/localAssets'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  return fileResponse(findAssetById(decodeURIComponent(id))?.coverPath)
}

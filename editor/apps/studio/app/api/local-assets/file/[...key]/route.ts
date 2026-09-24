import { fileResponse, findAssetByKey } from '../../../../../src/localAssets'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ key: string[] }> }

/** 草稿里记录的素材 key（metadata.modelUrl 等）→ 清单里对应的本地文件。 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { key } = await ctx.params
  return fileResponse(findAssetByKey(key.map(decodeURIComponent).join('/'))?.path)
}

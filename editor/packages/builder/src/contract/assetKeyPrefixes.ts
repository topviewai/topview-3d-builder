/**
 * 官方素材库的 S3 key 前缀。
 *
 * 放在 contract 而不是 host，是因为 engine 与 host 都要用同一份前缀判断，而依赖规则
 * （docs/architecture.md §2.2 与 .eslintrc.cjs）禁止 engine 导入 host。
 *
 * 与后端 `Asset3dService.LIBRARY_PREFIX` 一一对应：素材库（`GET /v2/3d-assets/search`）
 * 落库时用 `validateKey` 强制校验该前缀，改这里必须同步后端。
 */
export const LIBRARY_ASSET_PREFIX = '3d-builder/library/'

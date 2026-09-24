export const DEFAULT_FPS = 24
export const FPS_MIN = 20
export const FPS_MAX = 30
export const DEFAULT_FRAMES = 300

/** 工作台用 query 打开草稿，刷新 / 复制链接都能回到同一份。须与 draftStore ID 规则一致。 */
export const DRAFT_QUERY_KEY = 'draft'
/** CLI 项目可编辑打开，id 由 /api/projects 分配。保存写回项目，Agent 再读就是这份结果。 */
export const PROJECT_QUERY_KEY = 'project'

export const COVER_TONES = [
  ['#1c2438', '#4a6bb5'],
  ['#1a2c24', '#3d8a5a'],
  ['#2a1e38', '#6a5ab8'],
  ['#2c2218', '#c9a227'],
  ['#241c28', '#8a4a72'],
] as const

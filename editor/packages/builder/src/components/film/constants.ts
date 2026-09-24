/** 小于这个位移不算拖拽，避免点击选中时片段抖一下。 */
export const DRAG_THRESHOLD_PX = 4

/** 拖到轨道两端这个范围内开始自动滚动，越靠边越快（px / 帧）。 */
export const AUTO_SCROLL_EDGE_PX = 64
export const AUTO_SCROLL_MAX_PX = 22

/** 片段可见高度的上下限；轨道拉高时片段跟着长，不再在下方留一片空白。 */
export const CLIP_MIN_PX = 56
export const CLIP_MAX_PX = 200

/** 单个片段最多铺几格，避免长片段一次排队上百张缩略图。 */
export const MAX_STRIP_CELLS = 10

/** 低于这个宽度的片段只显示序号。 */
export const COMPACT_CLIP_PX = 96

/** 源条铺满整条源时间轴的胶片格数量。 */
export const SOURCE_STRIP_CELLS = 16

/** 源条时码刻度数量。 */
export const SOURCE_TICK_COUNT = 6

/** 已用分镜轨道固定一行；重叠块写出分镜号，悬停列表里点选。 */
export const USED_LANE_ROW_PX = 24

/** 源条高度，与 film.css 的 .t3d-film-source-lane 保持一致，用于算缩略图分辨率。 */
export const SOURCE_LANE_PX = 60

/** 入/出点缩略图高度，与 film.css 的 .t3d-film-trim-frame 保持一致。 */
export const TRIM_THUMB_PX = 60

/** 胶片格宽高比，缩略图与 CSS 格子都按它算，避免 cover 裁掉画面。 */
export const STRIP_ASPECT = 16 / 9

/**
 * 离屏缩略图按「显示高度 × devicePixelRatio」渲染，所以拉高面板也不糊。
 * 高度向上对齐到 STEP，避免拖动 resize 时每一个像素都生成一套新缓存。
 */
export const THUMB_HEIGHT_STEP = 48
export const THUMB_HEIGHT_MIN = 96
export const THUMB_HEIGHT_MAX = 432

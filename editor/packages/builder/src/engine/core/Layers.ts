export const EDITOR_LAYER = 1
/** 地板网格 + 人偶标签：机位预览和导出能看到，gizmo/坐标轴不在这层 */
export const GRID_LAYER = 2

/** 导出/渲染预览：关掉轨迹、相机 gizmo 等辅助层，保留地面网格与角色标签。 */
export function exportCameraLayerMask(prevMask: number): number {
  return (prevMask & ~(1 << EDITOR_LAYER)) | (1 << GRID_LAYER)
}

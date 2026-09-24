/** 顶栏 / 预览导出共用：默认机位跟预览下拉当前选中的一致。 */
export function resolveDefaultExportCameraId(
  cameras: readonly { id: string }[],
  activeCameraId: string | null,
  fallbackId: string,
): string {
  if (activeCameraId && cameras.some((camera) => camera.id === activeCameraId)) {
    return activeCameraId
  }
  return cameras[0]?.id ?? fallbackId
}

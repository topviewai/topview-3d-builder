/** 按需渲染：同一帧多次 invalidate 只排一次 rAF。门卫含 disposed + webGLContextLost。 */
export class RenderLoop {
  disposed = false
  webGLContextLost = false
  private renderFrameId: number | undefined

  constructor(private readonly forceRender: () => void) {}

  requestRender(): void {
    if (this.disposed || this.webGLContextLost || this.renderFrameId !== undefined) return
    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = undefined
      if (this.disposed || this.webGLContextLost) return
      this.forceRender()
    })
  }

  invalidate(): void {
    this.requestRender()
  }

  stop(): void {
    if (this.renderFrameId === undefined) return
    cancelAnimationFrame(this.renderFrameId)
    this.renderFrameId = undefined
  }
}

/** 仅播放时跑的 rAF 时钟。空闲必须 stop，否则和按需渲染抢 GPU。 */
export class PlaybackClock {
  acc = 0
  running = false
  private id: number | undefined
  private last = 0

  start(tick: (now: number) => void): void {
    if (this.id !== undefined) return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    const loop = (now: number) => {
      this.id = requestAnimationFrame(loop)
      tick(now)
    }
    this.id = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    if (this.id === undefined) return
    cancelAnimationFrame(this.id)
    this.id = undefined
  }

  dt(now: number): number {
    const d = Math.min(0.25, (now - this.last) / 1000)
    this.last = now
    return d
  }
}

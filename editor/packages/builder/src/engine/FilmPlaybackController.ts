export type FilmClockMode = 'idle' | 'sequence' | 'source'

export interface FilmPlaybackSnapshot {
  mode: FilmClockMode
  sequenceFrame: number
  sourcePreviewFrame: number
}

export type FilmPlaybackListener = (snapshot: FilmPlaybackSnapshot) => void

export class FilmPlaybackController {
  private mode: FilmClockMode = 'idle'
  private sequenceFrame = 0
  private sourcePreviewFrame = 0
  private raf = 0
  private acc = 0
  private lastNow = 0
  private fps = 30
  private sequenceDuration = 0
  private sourceStart = 0
  private sourceEnd = 0
  private snapshot: FilmPlaybackSnapshot = {
    mode: 'idle',
    sequenceFrame: 0,
    sourcePreviewFrame: 0,
  }
  private readonly listeners = new Set<FilmPlaybackListener>()

  subscribe(listener: FilmPlaybackListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): FilmPlaybackSnapshot {
    return this.snapshot
  }

  setFps(fps: number): void {
    this.fps = Math.max(1, fps)
  }

  seekSequence(frame: number, duration: number): void {
    this.pauseClock()
    this.sequenceDuration = Math.max(0, duration)
    this.sequenceFrame = clampFrame(frame, this.sequenceDuration)
    this.mode = 'idle'
    this.emit()
  }

  seekSource(frame: number, start: number, end: number): void {
    this.pauseClock()
    this.sourceStart = start
    this.sourceEnd = end
    this.sourcePreviewFrame = clampClosed(frame, start, end)
    this.mode = 'idle'
    this.emit()
  }

  playSequence(duration: number): void {
    this.sequenceDuration = Math.max(0, duration)
    if (this.sequenceDuration <= 0) return
    if (this.sequenceFrame >= this.sequenceDuration - 1) this.sequenceFrame = 0
    this.mode = 'sequence'
    this.startClock()
    this.emit()
  }

  playSource(start: number, end: number): void {
    this.sourceStart = start
    this.sourceEnd = end
    // 播放头落在新区间之外（切换片段 / 改了入点）时回到入点，
    // 否则会从上一段的位置起播，看起来像「没在选区里播」。
    if (this.sourcePreviewFrame < this.sourceStart || this.sourcePreviewFrame >= this.sourceEnd) {
      this.sourcePreviewFrame = this.sourceStart
    }
    this.mode = 'source'
    this.startClock()
    this.emit()
  }

  pause(): void {
    if (this.mode === 'idle' && this.raf === 0) return
    this.pauseClock()
    this.mode = 'idle'
    this.emit()
  }

  reset(): void {
    this.pauseClock()
    this.mode = 'idle'
    this.sequenceFrame = 0
    this.sourcePreviewFrame = 0
    this.sequenceDuration = 0
    this.emit()
  }

  private startClock(): void {
    if (this.raf) return
    this.acc = 0
    this.lastNow = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - this.lastNow) / 1000)
      this.lastNow = now
      this.acc += dt * this.fps
      if (this.acc < 1) return
      const adv = Math.floor(this.acc)
      this.acc -= adv
      if (this.mode === 'sequence') {
        const next = this.sequenceFrame + adv
        if (next >= this.sequenceDuration) {
          this.sequenceFrame = this.sequenceDuration - 1
          this.pauseClock()
          this.mode = 'idle'
        } else {
          this.sequenceFrame = next
        }
        this.emit()
        return
      }
      if (this.mode === 'source') {
        const next = this.sourcePreviewFrame + adv
        if (next > this.sourceEnd) {
          this.sourcePreviewFrame = this.sourceEnd
          this.pauseClock()
          this.mode = 'idle'
        } else {
          this.sourcePreviewFrame = next
        }
        this.emit()
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private pauseClock(): void {
    if (!this.raf) return
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.acc = 0
  }

  private emit(): void {
    const next: FilmPlaybackSnapshot = {
      mode: this.mode,
      sequenceFrame: this.sequenceFrame,
      sourcePreviewFrame: this.sourcePreviewFrame,
    }
    if (
      this.snapshot.mode === next.mode
      && this.snapshot.sequenceFrame === next.sequenceFrame
      && this.snapshot.sourcePreviewFrame === next.sourcePreviewFrame
    ) {
      return
    }
    this.snapshot = next
    for (const listener of this.listeners) listener(this.snapshot)
  }
}

function clampFrame(frame: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.min(Math.max(Math.round(frame), 0), duration - 1)
}

function clampClosed(frame: number, start: number, end: number): number {
  return Math.min(Math.max(Math.round(frame), start), end)
}

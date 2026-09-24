import { describe, expect, test } from 'vitest'
import { EditorStore } from '../EditorStore'

describe('timeline play hint', () => {
  test('collapsed timeline shows the hint once per draft', () => {
    const editor = new EditorStore('draft')
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(true)
    expect(editor.timelinePlayHintUntil).toBeGreaterThan(Date.now())

    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(true)

    editor.dismissTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(false)
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(false)
  })

  test('open timeline does not spend the hint', () => {
    const editor = new EditorStore('draft')
    editor.openTimeline()
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(false)

    editor.toggleTimelinePanel()
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(true)
  })

  test('accepting the hint opens the timeline and does not show again', () => {
    const editor = new EditorStore('draft')
    editor.requestTimelinePlayHint()
    editor.acceptTimelinePlayHint()
    expect(editor.timelineVisible).toBe(true)
    expect(editor.timelinePlayHintVisible).toBe(false)

    editor.toggleTimelinePanel()
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(false)
  })

  test('film mode waits until the scene timeline can be opened', () => {
    const editor = new EditorStore('draft')
    editor.setWorkspaceModeFlag('film')
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(false)
    editor.setWorkspaceModeFlag('scene')
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(true)
  })

  test('a new draft can show the hint again', () => {
    const editor = new EditorStore('draft')
    editor.requestTimelinePlayHint()
    editor.dismissTimelinePlayHint()
    editor.resetForDraft('next')
    editor.requestTimelinePlayHint()
    expect(editor.timelinePlayHintVisible).toBe(true)
  })
})

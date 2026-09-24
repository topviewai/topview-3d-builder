import { useEffect, type RefObject } from 'react'
import {
  claimAppKeyboard,
  isAppKeyboardOwner,
  releaseAppKeyboard,
  useDirector,
} from '../../bridge/DirectorContext'
import { nodeIdsOf } from '../../stores/nodeSelection'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
    return true
  }
  return target.isContentEditable
}

/**
 * 编辑器内部弹窗要吞掉快捷键，但宿主常把整个编辑器塞进一个 `role="dialog"` 容器
 * （`apps/studio` 的 overlay 就是），只看 `closest` 会把整块画布误判成弹窗，
 * F / Delete / 撤销全部失效。只认 root 内部的弹窗。
 */
function isInStudioDialog(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return false
  const dialog = target.closest('[role="dialog"]')
  return !!dialog && dialog !== root && root.contains(dialog)
}

export function useScopedKeyboard(rootRef: RefObject<HTMLDivElement | null>): void {
  const { useStore } = useDirector()

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    claimAppKeyboard(root)

    const onPointerDown = (e: PointerEvent) => {
      claimAppKeyboard(root)
      const target = e.target
      if (target instanceof HTMLCanvasElement) return
      if (
        target instanceof HTMLElement &&
        target.closest('button, input, select, textarea, a, [contenteditable="true"]')
      ) {
        return
      }
      root.focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isAppKeyboardOwner(root)) return
      const s = useStore.getState()
      if (e.key === 'Escape' && s.pathDrawMode) {
        e.preventDefault()
        e.stopPropagation()
        s.setPathDrawMode(false)
        return
      }
      if (isTypingTarget(e.target)) return
      if (isInStudioDialog(e.target, root)) return
      const film = s.workspaceMode === 'film'
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyD') {
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        e.stopPropagation()
        if (isInStudioDialog(e.target, root)) return
        if (
          s.workspaceMode === 'film'
          || s.pathEditingId
          || s.pathDrawMode
          || s.poseEditingId
          || s.lookAtPickingId
          || s.pathApplyPickingId
          || s.followMode
          || s.exporting
          || s.writeLocked
          || s.hostReadOnly
        ) return
        s.duplicateSelection({ kind: 'offset', delta: { position: [0.5, 0, 0] } })
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyV') {
        e.preventDefault()
        e.stopPropagation()
        s.togglePlay()
        return
      }
      if (e.key === 'Escape' && s.cameraPilotId) {
        e.preventDefault()
        e.stopPropagation()
        s.setCameraPilot(null)
      } else if (e.key === 'Escape' && s.lookAtPickingId) {
        e.preventDefault()
        e.stopPropagation()
        s.cancelLookAtPick()
      } else if (e.key === 'Escape' && s.pathApplyPickingId) {
        e.preventDefault()
        e.stopPropagation()
        s.cancelPathApplyPick()
      } else if (e.key === 'Escape' && s.poseEditingId) {
        e.preventDefault()
        e.stopPropagation()
        s.setPoseEditingId(null)
      } else if (e.key === 'Escape' && s.pathEditingId) {
        e.preventDefault()
        e.stopPropagation()
        s.setPathEditingId(null)
      } else if (e.key === 'Escape' && film && (s.filmAddDraft || s.filmDragPreview || s.filmSelection)) {
        e.preventDefault()
        e.stopPropagation()
        // 逐层退出：拖拽 → 新建草稿 → 选中态（回到浏览机位）
        if (s.filmDragPreview) s.cancelFilmDrag()
        else if (s.filmAddDraft) s.cancelFilmAddDraft()
        else s.setFilmSelection(null)
      } else if (e.key === 'Escape' && s.viewportFullscreen) {
        e.preventDefault()
        e.stopPropagation()
        s.toggleViewportFullscreen()
      } else if (e.key === 'Enter' && s.pathDrawMode) {
        e.preventDefault()
        e.stopPropagation()
        s.finishPathDraw()
      } else if (!film && (e.key === 'i' || e.key === 'I')) {
        // 多选时一次给所有选中对象打键，压成一条 undo；通道由节点类型决定。
        const ids = nodeIdsOf(s.selection)
        if (ids.length > 0) {
          e.preventDefault()
          s.addTransformKeyframes(ids)
        }
      } else if (
        !film
        && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
        && (e.key === 'f' || e.key === 'F' || e.code === 'NumpadDecimal')
      ) {
        if (s.selection?.kind === 'node') {
          e.preventDefault()
          s.focusSelection()
        }
      } else if (e.key === 'ArrowLeft') {
        s.stepFrame(-1)
      } else if (e.key === 'ArrowRight') {
        s.stepFrame(1)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && e.code !== 'NumpadDecimal') {
        // 即使没有可删的 3D 对象也必须切断冒泡：宿主可能在 window 上监听删除键并按
        // 「上次选中的节点」兜底，放行会让宿主删掉承载本编辑器的那张画布卡片。
        e.stopPropagation()
        if (film) {
          if (!s.filmSelection || s.filmDragPreview || s.exporting) return
          e.preventDefault()
          s.deleteSelection()
          return
        }
        if (s.pathDrawMode || !s.selection) return
        e.preventDefault()
        s.deleteSelection()
      }
    }

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('keydown', onKey)
      releaseAppKeyboard(root)
    }
  }, [rootRef, useStore])
}

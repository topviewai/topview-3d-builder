import { useEffect, useState, type RefObject } from 'react'
import { useDirector } from '../../../bridge/DirectorContext'
import { cameraMotionActiveAtFrame, cameraPositionDragMoved } from '../../../evaluate/camera/cameraMotionExclusive'
import { buildNodeSelection, isLookAtPickTarget, isPathApplyPickTarget, toggleNodeIds, unlockedNodeIds } from '../../../stores/nodeSelection'
import { attachedGizmoIds, cameraGizmoCommitPatch, isCameraNode, isPathNode, readGizmoTransform } from '../utils'

interface ViewportSelectionBox {
  left: number
  top: number
  width: number
  height: number
}

const DRAW_MIN_STEP_M = 0.1

export function useViewportInteractions(ref: RefObject<HTMLCanvasElement>) {
  const { stage, useStore } = useDirector()
  const film = useStore((s) => s.workspaceMode === 'film')
  const lookAtPickingId = useStore((s) => s.lookAtPickingId)
  const pathApplyPickingId = useStore((s) => s.pathApplyPickingId)
  const [selectionBox, setSelectionBox] = useState<ViewportSelectionBox | null>(null)
  const [lookAtHoverId, setLookAtHoverId] = useState<string | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || film) return

    let gizmoProp: 'position' | 'rotation' | 'scale' | null = null
    const cameraDragStart = new Map<string, number[]>()
    const writeCameraRot = (nodeId: string, commit: boolean) => {
      const v = stage.readAttachedTransform('rotation', nodeId)
      if (v) useStore.getState().writeCameraRotation(nodeId, { x: v[0], y: v[1], z: v[2] }, commit)
    }
    const onGizmoDraggingChanged = (dragging: boolean) => {
      const s = useStore.getState()
      stage.setOrbitEnabled(!dragging)
      const ids = attachedGizmoIds(stage)
      if (s.pathEditingId) {
        if (dragging) {
          gizmoProp = 'position'
          s.beginInteraction()
          return
        }
        gizmoProp = null
        stage.consumeGizmoDuplicateDrag()
        const pos = stage.readAttachedTransform('position')
        const index = s.pathEditPointIndex
        if (pos && index != null) {
          s.commitPathPoint(s.pathEditingId, index, { x: pos[0], y: pos[1], z: pos[2] })
        }
        s.endInteraction('编辑轨迹锚点')
        return
      }
      // 非锚点编辑态：操作轴挂在整条路径的代理体上，落盘写 node.transform，
      // 全部控制点随之协同变换，不走关键帧通道。
      const wholePathId = ids.length === 1 && isPathNode(s.doc, ids[0]) ? ids[0] : null
      if (wholePathId) {
        if (dragging) {
          gizmoProp = stage.gizmoInteractionProp()
          s.beginInteraction()
          return
        }
        gizmoProp = null
        stage.consumeGizmoDuplicateDrag()
        const xf = readGizmoTransform(stage, wholePathId)
        s.commitPathTransform(wholePathId, {
          position: xf.position ? { x: xf.position[0], y: xf.position[1], z: xf.position[2] } : undefined,
          rotation: xf.rotation ? { x: xf.rotation[0], y: xf.rotation[1], z: xf.rotation[2] } : undefined,
          scale: xf.scale ? { x: xf.scale[0], y: xf.scale[1], z: xf.scale[2] } : undefined,
        })
        s.endInteraction('变换轨迹')
        return
      }
      if (dragging) {
        if (stage.gizmoIsDuplicating()) {
          gizmoProp = null
          cameraDragStart.clear()
          return
        }
        gizmoProp = stage.gizmoInteractionProp()
        cameraDragStart.clear()
        if (gizmoProp === 'position') {
          const frame = Math.round(s.frame)
          for (const id of ids) {
            if (!isCameraNode(s.doc, id) || !cameraMotionActiveAtFrame(s.doc, id, frame)) continue
            const pos = stage.readAttachedTransform('position', id)
            if (pos) cameraDragStart.set(id, pos.slice())
          }
        }
        s.beginInteraction()
      } else {
        const prop = gizmoProp
        gizmoProp = null
        const dragStarts = new Map(cameraDragStart)
        cameraDragStart.clear()
        if (stage.consumeGizmoDuplicateDrag()) {
          s.endInteraction('复制')
          return
        }
        // 最终提交发生在 interaction 内，push 被抑制；endInteraction 把整次拖拽
        // 压成一条三合一快照命令。多选时一次提交全部附着节点。
        let label = '拖拽变换'
        let motionDragBlocked = false
        const frame = Math.round(s.frame)
        const items: { nodeId: string; position?: number[]; rotation?: number[]; scale?: number[] }[] = []
        for (const id of ids) {
          if (isCameraNode(s.doc, id)) {
            // 当前帧运镜独占位置：空间轴拖拽不落盘，松手后 gizmo 对齐求值机位形成回弹。
            if (prop === 'position' && cameraMotionActiveAtFrame(s.doc, id, frame)) {
              const end = stage.readAttachedTransform('position', id)
              if (cameraPositionDragMoved(dragStarts.get(id), end)) motionDragBlocked = true
              continue
            }
            const pos = stage.readAttachedTransform('position', id)
            const rot = stage.readAttachedTransform('rotation', id)
            const item = cameraGizmoCommitPatch(id, prop, pos, rot)
            if (item.position || item.rotation) {
              items.push(item)
            }
            label = ids.length > 1 ? '提交多选变换' : prop === 'rotation' ? '旋转相机' : '移动相机'
            continue
          }
          const xf = readGizmoTransform(stage, id)
          const item: { nodeId: string; position?: number[]; rotation?: number[]; scale?: number[] } = { nodeId: id }
          if (xf.position) item.position = xf.position
          if (xf.rotation) item.rotation = xf.rotation
          if (xf.scale) item.scale = xf.scale
          if (!item.position && !item.rotation && !item.scale) continue
          items.push(item)
          label = ids.length > 1 ? '提交多选变换' : '提交变换'
        }
        if (items.length) s.commitNodeTransforms(frame, items)
        s.endInteraction(label)
        if (motionDragBlocked) s.notifyCameraMotionDragBlocked()
      }
    }
    const onGizmoObjectChange = () => {
      if (stage.gizmoIsDuplicating()) return
      const ids = attachedGizmoIds(stage)
      const prop = gizmoProp ?? stage.gizmoInteractionProp()
      if (ids.length === 0) return
      const s = useStore.getState()
      if (s.pathEditingId) {
        stage.applyLivePathStroke?.(s.pathEditingId)
        return
      }
      if (ids.length === 1 && isPathNode(s.doc, ids[0])) {
        stage.applyLivePathTransform?.(ids[0])
        return
      }
      // 拖拽不写文档、不打关键帧。把 gizmo 位姿实时广播并灌进引擎快照，
      // 视口和 Inspector 才能跟上；松手时 commitNodeTransforms 一次落盘。
      for (const id of ids) {
        if (isCameraNode(s.doc, id)) {
          if (prop === 'rotation') writeCameraRot(id, false)
          else if (!(prop === 'position' && cameraMotionActiveAtFrame(s.doc, id, Math.round(s.frame)))) {
            const v = stage.readAttachedTransform('position', id)
            if (v) s.writeCameraWorldPos(id, { x: v[0], y: v[1], z: v[2] }, false)
          }
          continue
        }
        const pos = stage.readAttachedTransform('position', id)
        const rot = stage.readAttachedTransform('rotation', id)
        const scl = stage.readAttachedTransform('scale', id)
        stage.applyLiveNodeTransform(id, {
          position: pos ? { x: pos[0], y: pos[1], z: pos[2] } : undefined,
          rotation: rot ? { x: rot[0], y: rot[1], z: rot[2] } : undefined,
          scale: scl ? { x: scl[0], y: scl[1], z: scl[2] } : undefined,
        })
      }
    }
    const unGizmoDrag = stage.onGizmoDraggingChanged(onGizmoDraggingChanged)
    const unGizmoChange = stage.onGizmoObjectChange(onGizmoObjectChange)

    // 兜底：gizmo 漏发 dragging-changed(false)（拖拽中 HMR、指针被夺、
    // 合成事件等）会让 history 卡在 interaction 里——之后所有提交被静默丢弃、
    // 撤销按钮看似失灵。pointerup/cancel 后下一拍检查：gizmo 已空闲但 interaction
    // 还挂着就强制收尾。正常路径已在同一事件里同步收尾，这里不会误判。
    const onPointerUpFallback = () => {
      setTimeout(() => {
        const s = useStore.getState()
        if (!stage.gizmoBusy() && s.interactionActive) {
          s.endInteraction('拖拽变换')
        }
      }, 0)
    }
    window.addEventListener('pointerup', onPointerUpFallback)
    window.addEventListener('pointercancel', onPointerUpFallback)

    const wrap = canvas.parentElement
    let stroking = false
    let poseDrag: { nodeId: string; pointerId: number } | null = null
    let lastPt: [number, number, number] | null = null
    const pickAtClient = (clientX: number, clientY: number) => {
      const { x, y } = stage.ndcFromClient(canvas, clientX, clientY)
      const body = stage.pickNodeHit(x, y)
      const camHit = stage.pickCameraHit(x, y)
      if (camHit && (!body || camHit.dist <= body.dist)) return { id: camHit.id, camera: true }
      const pathHit = stage.pickPathHit(x, y)
      if (pathHit && (!body || pathHit.dist <= body.dist)) return { id: pathHit.id, camera: false }
      return body ? { id: body.id, camera: false } : null
    }
    const applyClick = (hit: { id: string; camera: boolean } | null, shiftKey: boolean) => {
      const s = useStore.getState()
      if (s.pathEditingId) {
        if (!hit || hit.id === s.pathEditingId) return
      }
      if (hit && s.doc?.content.nodes.find((node) => node.id === hit.id)?.locked) return
      if (s.lookAtPickingId || s.pathApplyPickingId) {
        if (!hit) return
        s.select({ kind: 'node', nodeId: hit.id, nodeIds: [hit.id] })
        return
      }
      if (shiftKey) {
        if (!hit) return
        const current = s.selection?.kind === 'node' ? s.selection : null
        const next = toggleNodeIds(current?.nodeIds, current?.nodeId, hit.id)
        s.select(buildNodeSelection(next))
        if (hit.camera && next.includes(hit.id)) s.setActiveCamera(hit.id)
        return
      }
      if (!hit) {
        if (s.selection?.kind === 'node' || s.selection?.kind === 'clip' || s.selection?.kind === 'timelineBox') {
          s.select(null)
        }
        return
      }
      s.select(buildNodeSelection([hit.id]))
      if (hit.camera) s.setActiveCamera(hit.id)
    }
    stage.setNavPickHandlers({
      onBoxRect: (rect) => setSelectionBox(rect),
      onBoxCommit: (rect) => {
        const s = useStore.getState()
        if (s.cameraPilotId || s.followMode) {
          setSelectionBox(null)
          return
        }
        if (s.pathEditingId) {
          const indices = stage.pickPathPointIndicesInScreenRect?.(
            wrap ?? canvas,
            rect,
            s.pathEditingId,
          ) ?? []
          if (indices.length > 0) s.setPathEditPointIndex(indices[0])
          return
        }
        const pickedIds = stage.pickIdsInScreenRect(wrap ?? canvas, rect)
        if (s.lookAtPickingId || s.pathApplyPickingId) {
          const target = pickedIds.find((id) => {
            const node = s.doc?.content.nodes.find((item) => item.id === id)
            return s.lookAtPickingId
              ? isLookAtPickTarget(node, s.lookAtPickingId)
              : isPathApplyPickTarget(node, s.pathApplyPickingId!)
          })
          if (target) s.select(buildNodeSelection([target]))
          return
        }
        const ids = unlockedNodeIds(s.doc?.content.nodes ?? [], pickedIds)
        if (ids.length === 0) {
          if (s.selection?.kind === 'node' || s.selection?.kind === 'clip' || s.selection?.kind === 'timelineBox') {
            s.select(null)
          }
          return
        }
        s.select(buildNodeSelection(ids))
      },
      onClick: ({ clientX, clientY, shiftKey }) => {
        const s = useStore.getState()
        if (s.pathDrawMode || s.followMode || s.cameraPilotId || stage.gizmoBusy() || stage.poseJointBusy()) return
        if (s.pathEditingId) {
          const { x, y } = stage.ndcFromClient(canvas, clientX, clientY)
          const point = stage.pickPathPointHit?.(x, y, s.pathEditingId)
          if (point && point.id === s.pathEditingId) {
            s.setPathEditPointIndex(point.index)
            return
          }
        }
        applyClick(pickAtClient(clientX, clientY), shiftKey)
      },
    })
    stage.setGizmoDuplicateHandler((items) => {
      // 路径的 gizmo 挂在代理体上，alt 拖拽复制拿不到真实节点位姿。
      if (useStore.getState().pathEditingId) return
      if (items.some((item) => isPathNode(useStore.getState().doc, item.id))) return
      useStore.getState().duplicateSelection({
        kind: 'gizmo',
        items: items.map((item) => ({
          id: item.id,
          from: item.from,
          to: {
            position: item.position,
            rotation: item.rotation,
            scale: item.scale,
          },
        })),
      })
    })
    const onPrePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.target !== canvas) return
      // Ctrl/Cmd 保留给框选，不进关节摆位
      if (e.ctrlKey || e.metaKey) return
      const s = useStore.getState()
      if (s.pathDrawMode || s.followMode || s.cameraPilotId) return
      if (stage.gizmoBusy()) return
      const { x, y } = stage.ndcFromClient(canvas, e.clientX, e.clientY)
      const handle = stage.gizmoHandleHit(x, y)
      const poseId = s.poseEditingId
      const character = poseId ? s.doc?.content.nodes.find((n) => n.id === poseId && n.type === 'character') : null
      if (character && !handle) {
        const joint = stage.poseJointHit(character.id, x, y)
        if (joint && stage.poseJointBegin(character.id, joint.specId, x, y)) {
          e.preventDefault(); e.stopPropagation()
          poseDrag = { nodeId: character.id, pointerId: e.pointerId }
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'grabbing'
          s.beginPoseEdit()
          stage.setOrbitEnabled(false)
        }
      }
    }
    wrap?.addEventListener('pointerdown', onPrePointerDown, true)

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const s = useStore.getState()
      if (!s.pathDrawMode) return
      const { x, y } = stage.ndcFromClient(canvas, e.clientX, e.clientY)
      const gp = stage.groundDrawPoint(x, y)
      if (!gp) return
      if (s.pathDrawStyle === 'click') {
        s.addPathDrawPoint(gp)
        return
      }
      stroking = true
      lastPt = gp
      s.clearPathDrawPoints()
      s.addPathDrawPoint(gp)
    }
    const onDrawMove = (e: PointerEvent) => {
      if (poseDrag) {
        if (e.pointerId !== poseDrag.pointerId) return
        const { x, y } = stage.ndcFromClient(canvas, e.clientX, e.clientY)
        const joints = stage.poseJointDrag(x, y)
        if (joints) useStore.getState().setPoseJoints(poseDrag.nodeId, joints)
        return
      }
      const s = useStore.getState()
      if (s.lookAtPickingId || s.pathApplyPickingId) {
        const hit = pickAtClient(e.clientX, e.clientY)
        const node = hit ? s.doc?.content.nodes.find((item) => item.id === hit.id) : undefined
        const hover = s.lookAtPickingId
          ? hit && isLookAtPickTarget(node, s.lookAtPickingId)
          : hit && isPathApplyPickTarget(node, s.pathApplyPickingId!)
        setLookAtHoverId(hover ? hit!.id : null)
      }
      if (!s.pathDrawMode && !s.followMode && s.poseEditingId) {
        const { x, y } = stage.ndcFromClient(canvas, e.clientX, e.clientY)
        stage.poseJointHover(x, y)
      }
      if (!stroking || !lastPt) return
      if (!s.pathDrawMode || s.pathDrawStyle !== 'draw') return
      const { x, y } = stage.ndcFromClient(canvas, e.clientX, e.clientY)
      const gp = stage.groundDrawPoint(x, y)
      if (!gp) return
      if (Math.hypot(gp[0] - lastPt[0], gp[2] - lastPt[2]) < DRAW_MIN_STEP_M) return
      lastPt = gp
      s.addPathDrawPoint(gp)
    }
    const finishPose = (commit: boolean) => {
      if (!poseDrag) return
      if (canvas.hasPointerCapture(poseDrag.pointerId)) canvas.releasePointerCapture(poseDrag.pointerId)
      if (commit) stage.poseJointEnd()
      else stage.poseJointCancel()
      useStore.getState().endPoseEdit(commit)
      stage.setOrbitEnabled(true)
      canvas.style.cursor = ''
      poseDrag = null
    }
    const onDrawUp = (e: PointerEvent) => {
      if (poseDrag && e.pointerId === poseDrag.pointerId) finishPose(true)
      if (e.button !== 0) return
      stroking = false
      lastPt = null
    }
    const onPoseKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (poseDrag) {
        e.preventDefault()
        e.stopPropagation()
        finishPose(false)
        return
      }
      const s = useStore.getState()
      if (s.lookAtPickingId) {
        e.preventDefault()
        e.stopPropagation()
        s.cancelLookAtPick()
        return
      }
      if (s.pathApplyPickingId) {
        e.preventDefault()
        e.stopPropagation()
        s.cancelPathApplyPick()
        return
      }
      if (s.poseEditingId) {
        e.preventDefault()
        e.stopPropagation()
        s.setPoseEditingId(null)
        return
      }
      if (s.pathEditingId) {
        e.preventDefault()
        e.stopPropagation()
        s.setPathEditingId(null)
      }
    }
    const onDblClick = (e: MouseEvent) => {
      const s = useStore.getState()
      if (s.pathDrawMode) {
        s.finishPathDraw()
        return
      }
      if (s.followMode || s.cameraPilotId || !(e.target instanceof HTMLCanvasElement)) return
      if (s.selection?.kind === 'node') s.focusSelection()
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onDrawMove)
    window.addEventListener('pointerup', onDrawUp)
    window.addEventListener('keydown', onPoseKey, true)
    canvas.addEventListener('dblclick', onDblClick)
    return () => {
      finishPose(false)
      stage.setNavPickHandlers(null)
      stage.setGizmoDuplicateHandler(null)
      setSelectionBox(null)
      wrap?.removeEventListener('pointerdown', onPrePointerDown, true)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onDrawMove)
      window.removeEventListener('pointerup', onDrawUp)
      window.removeEventListener('keydown', onPoseKey, true)
      canvas.removeEventListener('dblclick', onDblClick)
      unGizmoDrag()
      unGizmoChange()
      window.removeEventListener('pointerup', onPointerUpFallback)
      window.removeEventListener('pointercancel', onPointerUpFallback)
    }
  }, [stage, useStore, film, ref])

  useEffect(() => {
    if (!lookAtPickingId && !pathApplyPickingId) setLookAtHoverId(null)
  }, [lookAtPickingId, pathApplyPickingId])

  return { selectionBox, lookAtHoverId }
}

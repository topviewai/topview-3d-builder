import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { Bone, BoxGeometry, Group, Mesh } from 'three'
import { resolveGizmoPivotWorld, resolveMultiSelectionPivotWorld } from '../gumball/gizmoPivot'

describe('resolveGizmoPivotWorld', () => {
  it('普通网格取世界 AABB 中心', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2))
    mesh.position.set(0, 1, 0)
    mesh.updateMatrixWorld(true)
    const pivot = resolveGizmoPivotWorld(mesh)
    assert.ok(Math.abs(pivot.x) < 1e-6)
    assert.ok(Math.abs(pivot.y - 1) < 1e-6)
    assert.ok(Math.abs(pivot.z) < 1e-6)
  })

  it('骨骼角色取当前姿势骨骼包围盒中心，不用脚底', () => {
    const root = new Group()
    root.userData.isRiggedCharacter = true
    const hip = new Bone()
    hip.position.set(0, 1, 0)
    const head = new Bone()
    head.position.set(0, 2, 0)
    root.add(hip)
    hip.add(head)
    root.updateMatrixWorld(true)
    const pivot = resolveGizmoPivotWorld(root)
    assert.ok(Math.abs(pivot.y - 2) < 1e-6)
  })
})

describe('resolveMultiSelectionPivotWorld', () => {
  it('用各对象几何中心的平均，不用并集包围盒中心', () => {
    const small = new Mesh(new BoxGeometry(2, 2, 2))
    small.position.set(0, 0, 0)
    const wide = new Mesh(new BoxGeometry(20, 2, 2))
    wide.position.set(10, 0, 0)
    small.updateMatrixWorld(true)
    wide.updateMatrixWorld(true)
    const avg = resolveMultiSelectionPivotWorld([small, wide])
    assert.ok(avg)
    assert.ok(Math.abs(avg!.x - 5) < 1e-6)
    const unionCenterX = ((0 - 1) + (10 + 10)) / 2
    assert.ok(Math.abs(avg!.x - unionCenterX) > 3)
  })
})

import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { applyPoseLibraryBoneRotations } from '../applyPose'

function bone(name: string): THREE.Bone {
  const b = new THREE.Bone()
  b.name = name
  return b
}

function captureLocals(root: THREE.Object3D): Map<string, number[]> {
  const out = new Map<string, number[]>()
  root.traverse((obj) => {
    if (!obj.name) return
    const q = obj.quaternion
    out.set(obj.name, [q.x, q.y, q.z, q.w])
  })
  return out
}

test('姿势库世界增量在根已有 yaw 时不拧局部姿势', () => {
  const root = new THREE.Group()
  root.name = 'char'
  const hips = bone('mixamorigHips')
  const arm = bone('mixamorigLeftArm')
  arm.position.set(1, 0, 0)
  root.add(hips)
  hips.add(arm)

  const restPose = new Map<string, THREE.Quaternion>()
  root.traverse((obj) => {
    if (obj.name) restPose.set(obj.name, obj.quaternion.clone())
  })

  // 绕世界 X 抬臂 90°：单位朝向上手臂应指 +Y
  const raise = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  const bones = { mixamorigLeftArm: [raise.x, raise.y, raise.z, raise.w] as const }

  applyPoseLibraryBoneRotations(root, restPose, bones)
  const identityLocals = captureLocals(root)
  assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) > 1, '库增量应写进手臂局部旋转')

  root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  applyPoseLibraryBoneRotations(root, restPose, bones)
  const yawedLocals = captureLocals(root)

  for (const [name, q] of identityLocals) {
    if (name === 'char') continue
    const got = yawedLocals.get(name)
    assert.ok(got, name)
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.abs(got![i] - q[i]) < 1e-6,
        `${name}[${i}] yaw 后局部 ${got![i]} ≠ 单位朝向 ${q[i]}`,
      )
    }
  }
})

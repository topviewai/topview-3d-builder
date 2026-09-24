import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { clearSkinnedRaycastBounds } from '../objects/skinnedBounds'

/** 站姿：0.5 宽 / 1.8 高的躯干，单骨骼全权重，与角色实例同构。 */
function buildRig() {
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  root.add(bone)

  const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.35)
  geometry.translate(0, 0.9, 0)
  const count = geometry.attributes.position.count
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) skinWeight[i * 4] = 1
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([bone]))
  return { root, bone, mesh }
}

function hitCount(root: THREE.Object3D, target: THREE.Vector3): number {
  root.updateMatrixWorld(true)
  const origin = new THREE.Vector3(target.x, target.y, target.z + 5)
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(root, true).length
}

test('量完标签高度残留的静止姿势包围盒会让摆姿后的人物点不中', () => {
  const { root, bone, mesh } = buildRig()
  // CharacterObject 量标签高度这一下会把静止姿势的体积写死在 SkinnedMesh 上。
  new THREE.Box3().setFromObject(root)
  assert.notEqual(mesh.boundingBox, null)

  // 坐下：髋骨侧移 + 下沉 + 前倾，躯干横向已越出原包围盒。
  bone.position.set(0.3, -0.4, 0.2)
  const visualCenter = new THREE.Vector3(0.3, 0.5, 0.2)

  assert.equal(hitCount(root, visualCenter), 0)
  // 包围球是本次 raycast 按当前骨骼现算的，挡住射线的是那份旧包围盒。
  assert.ok((mesh.boundingSphere?.radius ?? 0) > 0.9)

  clearSkinnedRaycastBounds(root)
  assert.equal(hitCount(root, visualCenter), 1)
})

test('静止姿势不受影响', () => {
  const { root } = buildRig()
  new THREE.Box3().setFromObject(root)
  assert.equal(hitCount(root, new THREE.Vector3(0, 0.9, 0)), 1)
})

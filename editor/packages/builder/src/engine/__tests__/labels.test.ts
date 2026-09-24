import * as THREE from 'three'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { topYInParent } from '../objects/labels'

test('人物标签锚在模型包围盒顶部而不是包围盒高度', () => {
  const root = new THREE.Group()
  root.position.set(4, 2, -3)
  root.scale.set(2, 3, 2)
  const model = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2))
  model.position.y = -1
  root.add(model)

  // 模型局部范围是 [-3, 1]，顶部应为 1；包围盒高度会错误地给出 4。
  assert.ok(Math.abs(topYInParent(model, root) - 1) < 1e-9)
  model.geometry.dispose()
})

test('旋转骨架的蒙皮克隆，标签锚在站立后的包围盒顶部', () => {
  const root = new THREE.Group()
  const armature = new THREE.Group()
  armature.rotation.x = Math.PI / 2
  const bone = new THREE.Bone()
  armature.add(bone)
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.3)
  geometry.translate(0, 0.9, 0)
  const count = geometry.attributes.position.count
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) skinWeight[i * 4] = 1
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  armature.add(mesh)
  root.add(armature)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([bone]), new THREE.Matrix4())
  // clone 之后 inverse 回到 GLTF bindMatrix，不再等于当前世界矩阵的逆。
  mesh.bindMatrixInverse.identity()

  const y = topYInParent(armature, root)
  assert.ok(y > 1.5, `expected visual top, got ${y}`)
  geometry.dispose()
  ;(mesh.material as THREE.Material).dispose()
})

import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { disposeSceneChildren } from '../objects/environment'
import { markTemplateShared } from '../objects/templateShared'

function spyDispose(target: { dispose: () => void }): { count: number } {
  const counter = { count: 0 }
  const original = target.dispose.bind(target)
  target.dispose = () => {
    counter.count += 1
    original()
  }
  return counter
}

test('disposeSceneChildren 对模板派生 mesh 跳过 geometry 与贴图，仍释放每实例材质', () => {
  const scene = new THREE.Scene()
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const map = new THREE.Texture()
  const templateMaterial = new THREE.MeshStandardMaterial({ map })
  const mesh = new THREE.Mesh(geometry, templateMaterial)
  markTemplateShared(mesh)
  // 复刻 CharacterObject / PropObject：标记之后给 mesh 换上每实例材质。
  const instanceMaterial = templateMaterial.clone()
  mesh.material = instanceMaterial
  scene.add(mesh)

  const geo = spyDispose(geometry)
  const tex = spyDispose(map)
  const templateMat = spyDispose(templateMaterial)
  const instanceMat = spyDispose(instanceMaterial)

  disposeSceneChildren(scene)

  assert.equal(geo.count, 0)
  assert.equal(tex.count, 0)
  assert.equal(templateMat.count, 0)
  assert.equal(instanceMat.count, 1)
  assert.equal(scene.children.length, 0)
})

test('disposeSceneChildren 不释放模板上未被换掉的非 Mesh 材质', () => {
  // 官方库 GLB 里的 Line / Points 不会走 isMesh 换材质分支，材质仍与模板共享。
  // 模板现在常驻模块级缓存，这里 dispose 掉会让下一张草稿拿到已销毁的材质。
  const template = new THREE.Group()
  template.add(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()))

  const inner = skeletonClone(template)
  markTemplateShared(inner)

  const templateLine = template.children[0] as THREE.LineSegments
  const lineMat = spyDispose(templateLine.material as THREE.Material)
  const lineGeo = spyDispose(templateLine.geometry)

  const scene = new THREE.Scene()
  scene.add(inner)
  disposeSceneChildren(scene)

  assert.equal(lineMat.count, 0)
  assert.equal(lineGeo.count, 0)
})

test('disposeSceneChildren 对自造 mesh 全清 geometry、贴图和 material', () => {
  const scene = new THREE.Scene()
  const geometry = new THREE.PlaneGeometry(2, 2)
  const map = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map })
  scene.add(new THREE.Mesh(geometry, material))

  const geo = spyDispose(geometry)
  const tex = spyDispose(map)
  const mat = spyDispose(material)

  disposeSceneChildren(scene)

  assert.equal(geo.count, 1)
  assert.equal(tex.count, 1)
  assert.equal(mat.count, 1)
})

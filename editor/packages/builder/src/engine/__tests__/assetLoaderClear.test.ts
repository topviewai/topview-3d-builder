import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { AssetLoader } from '../io/AssetLoader'

function templateWithSpies(): {
  root: THREE.Object3D
  counts: { geometry: number; map: number; material: number }
} {
  const counts = { geometry: 0, map: 0, material: 0 }
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const map = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map })
  geometry.dispose = () => { counts.geometry += 1 }
  map.dispose = () => { counts.map += 1 }
  material.dispose = () => { counts.material += 1 }
  return { root: new THREE.Mesh(geometry, material), counts }
}

test('clear() 释放私有素材模板的 GPU 资源', () => {
  const loader = new AssetLoader(async (ref) => String(ref))
  const character = templateWithSpies()
  const prop = templateWithSpies()
  loader.characterTemplates.set('canvas/3d-builder/user/u1/char.glb', character.root)
  loader.propTemplates.set('canvas/3d-builder/user/u1/prop.glb', prop.root)

  loader.clear()

  for (const { counts } of [character, prop]) {
    assert.equal(counts.geometry, 1)
    assert.equal(counts.map, 1)
    assert.equal(counts.material, 1)
  }
  assert.equal(loader.characterTemplates.size, 0)
  assert.equal(loader.propTemplates.size, 0)
})

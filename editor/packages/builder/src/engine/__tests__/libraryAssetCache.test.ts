import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { lookupLibraryProp, libraryAssetCacheKey, storeLibraryProp } from '../io/libraryAssetCache'
import { isTemplateShared, markTemplateShared } from '../objects/templateShared'

test('libraryAssetCacheKey 还原 CloudFront 签名 URL 里的素材 key', () => {
  // 后端 CloudFrontService 用 URLEncoder.encode(key)，斜杠会变成 %2F。
  assert.equal(
    libraryAssetCacheKey(
      'https://cdn.example.com/3d-builder%2Flibrary%2Fprops%2Fa3d_prop_abc-1234.glb?Expires=1&Signature=x',
    ),
    '3d-builder/library/props/a3d_prop_abc-1234.glb',
  )
  assert.equal(
    libraryAssetCacheKey('https://cdn.example.com/3d-builder/library/props/a3d_prop_abc-1234.glb?Signature=1'),
    '3d-builder/library/props/a3d_prop_abc-1234.glb',
  )
  assert.equal(
    libraryAssetCacheKey('3d-builder/library/motions/a3d_motion_abc-1234.fbx'),
    '3d-builder/library/motions/a3d_motion_abc-1234.fbx',
  )
})

test('libraryAssetCacheKey 只认素材库前缀', () => {
  assert.equal(libraryAssetCacheKey('canvas/u1/a.glb'), null)
  assert.equal(libraryAssetCacheKey('3d-builder/user/u1/a.glb'), null)
  // 历史公共 CDN 约定已随 public API 一起移除
  assert.equal(libraryAssetCacheKey('3d-builder/public/props/volleyball.glb'), null)
  assert.equal(libraryAssetCacheKey(''), null)
})

test('libraryAssetCacheKey 对裸 % 不抛异常', () => {
  assert.equal(libraryAssetCacheKey('3d-builder/library/props/100%-off.glb'), '3d-builder/library/props/100%-off.glb')
})

test('LRU 淘汰后解除 templateShared，使场景销毁能回收该模板资源', () => {
  const evicted = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  const key = '3d-builder/library/props/a3d_prop_evicted-0000.glb'
  storeLibraryProp(key, evicted)
  markTemplateShared(evicted)
  assert.equal(isTemplateShared(evicted.geometry), true)
  assert.equal(lookupLibraryProp(key), evicted)

  // 塞满 LRU（上限 48）把它挤出去
  for (let i = 0; i < 60; i += 1) {
    storeLibraryProp(`3d-builder/library/props/a3d_prop_filler${i}-0000.glb`, new THREE.Object3D())
  }

  assert.equal(lookupLibraryProp(key), undefined)
  // 标记已解除，disposeSceneChildren 之后就会释放它，而不是留到 context lost
  assert.equal(isTemplateShared(evicted.geometry), false)
})

test('同 key 被覆盖时，旧模板同样解除 templateShared', () => {
  const key = '3d-builder/library/props/a3d_prop_dup-0000.glb'
  const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  storeLibraryProp(key, first)
  markTemplateShared(first)

  // 同一 URL 并发加载各下一份，后者覆盖前者
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  storeLibraryProp(key, second)
  markTemplateShared(second)

  assert.equal(lookupLibraryProp(key), second)
  assert.equal(isTemplateShared(first.geometry), false)
  assert.equal(isTemplateShared(second.geometry), true)
})

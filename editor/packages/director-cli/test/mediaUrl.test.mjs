import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveHeadlessMediaUrl } from '../mediaUrl.mjs'

test('https passthrough', () => {
  assert.equal(
    resolveHeadlessMediaUrl('https://signed.example/a.glb', ''),
    'https://signed.example/a.glb',
  )
  assert.equal(
    resolveHeadlessMediaUrl({ kind: 'prop', sourceUrl: 'https://signed.example/b.glb' }, ''),
    'https://signed.example/b.glb',
  )
})

test('public keys join the public asset base', () => {
  assert.equal(
    resolveHeadlessMediaUrl(
      { kind: 'character', sourceUrl: '3d-builder/public/characters/female.glb' },
      'https://cdn.example/3d-builder/public',
    ),
    'https://cdn.example/3d-builder/public/characters/female.glb',
  )
})

test('unavailable library keys throw instead of returning empty', () => {
  assert.throws(
    () => resolveHeadlessMediaUrl({
      kind: 'character',
      sourceUrl: '3d-builder/library/characters/a3d_char_1.glb',
    }, ''),
    /ASSET_NOT_AVAILABLE:3d-builder\/library\/characters\/a3d_char_1.glb/,
  )
})

test('local asset map wins over the public base', () => {
  const local = { '3d-builder/library/characters/a3d_char_1.glb': 'http://127.0.0.1:1/local-assets/0/a.glb' }
  assert.equal(
    resolveHeadlessMediaUrl({ kind: 'character', sourceUrl: '/3d-builder/library/characters/a3d_char_1.glb?x=1' },
      'https://cdn.example/3d-builder/public', local),
    'http://127.0.0.1:1/local-assets/0/a.glb',
  )
})

test('missing motions resolve to empty so the scene still loads', () => {
  assert.equal(
    resolveHeadlessMediaUrl({ kind: 'motion', assetId: 'm', sourceUrl: '3d-builder/library/motions/m.fbx' }, ''),
    '',
  )
})

test('user characters need a local file or a public base', () => {
  assert.throws(() => resolveHeadlessMediaUrl({ kind: 'character', sourcePath: 'user', assetId: 'u1' }, ''),
    /ASSET_NOT_AVAILABLE:user:u1/)
  assert.equal(
    resolveHeadlessMediaUrl({ kind: 'character', sourcePath: 'user', assetId: 'u1' }, '', { 'user:u1': 'http://l/u.glb' }),
    'http://l/u.glb',
  )
})

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { assetOrigins, localAssetFiles, resolveOutputDir } from '../render.mjs'

test('outputDir is required and must be absolute', () => {
  assert.throws(() => resolveOutputDir(undefined), /RENDER_OUTPUT_DIR_REQUIRED/)
  assert.throws(() => resolveOutputDir(''), /RENDER_OUTPUT_DIR_REQUIRED/)
  assert.throws(() => resolveOutputDir('renders/x'), /RENDER_OUTPUT_DIR_INVALID/)
})

test('outputDir must be exactly one run directory below a renders directory', () => {
  for (const bad of [
    '/tmp/director/out',
    '/project/.topview-3d/renders',
    '/project/.topview-3d/renders/',
    '/project/.topview-3d/renders/abc/def',
    '/project/.topview-3d/renders/../renders/abc',
    '/project/.topview-3d/renders/./abc',
    '/project/.topview-3d/renders/a b',
    '/renders/..',
  ]) {
    assert.throws(() => resolveOutputDir(bad), /RENDER_OUTPUT_DIR_INVALID/, bad)
  }
})

test('project and legacy run dirs are accepted', () => {
  assert.equal(resolveOutputDir('/project/.topview-3d/renders/abc'), path.resolve('/project/.topview-3d/renders/abc'))
  assert.equal(
    resolveOutputDir('/tmp/director/renders/47133e066d7044bda947da4914741c36'),
    path.resolve('/tmp/director/renders/47133e066d7044bda947da4914741c36'),
  )
})

test('Windows paths follow the same rules', () => {
  const win = path.win32
  assert.equal(resolveOutputDir('C:\\Users\\me\\scene\\.topview-3d\\renders\\run_1', win),
    'C:\\Users\\me\\scene\\.topview-3d\\renders\\run_1')
  assert.throws(() => resolveOutputDir('C:\\Users\\me\\scene\\.topview-3d\\renders\\..\\x', win), /RENDER_OUTPUT_DIR_INVALID/)
  assert.throws(() => resolveOutputDir('scene\\.topview-3d\\renders\\run_1', win), /RENDER_OUTPUT_DIR_INVALID/)
})

test('only an explicit public asset base opens a network origin', () => {
  const previous = process.env.TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE
  delete process.env.TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE
  try {
    assert.deepEqual(assetOrigins({}), [])
    assert.deepEqual(assetOrigins({ publicAssetBase: 'https://cdn.example/3d-builder/public' }), ['https://cdn.example'])
  } finally {
    if (previous !== undefined) process.env.TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE = previous
  }
})

test('local assets must be absolute file paths', () => {
  assert.deepEqual(localAssetFiles({}), [])
  assert.deepEqual(localAssetFiles({ localAssets: { k: '/a/b.glb' } }), [['k', '/a/b.glb']])
  assert.throws(() => localAssetFiles({ localAssets: { k: 'b.glb' } }), /LOCAL_ASSET_PATH_INVALID:k/)
})

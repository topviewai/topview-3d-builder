import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import {
  buildSample,
  collectSampleFrames,
  diffSamples,
  formatHashMismatch,
  hashFrame,
  type GoldenFile,
} from './goldenCodec'
import { DRAFT_FILES, evalAt, loadDraft, loadFcurves, samplesDir, sceneOf } from './helpers'

function loadGolden(draft: string): GoldenFile {
  const path = join(samplesDir(), 'golden', draft)
  assert.ok(existsSync(path), `missing golden ${draft}`)
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenFile
}

function firstMismatchDetails(golden: GoldenFile, draft: string, frame: number, scene: ReturnType<typeof sceneOf>): string[] {
  const sample = golden.samples.find((s) => s.frame === frame)
  if (sample) return diffSamples(draft, sample, buildSample(frame, evalAt(scene, frame)))
  const later = golden.samples.find((s) => s.frame > frame)
  if (!later) return []
  const live = buildSample(later.frame, evalAt(scene, later.frame))
  return [
    `no full sample at frame ${frame}; nearest later sample frame ${later.frame}`,
    ...diffSamples(draft, later, live),
  ]
}

test('evaluateFrame golden 逐帧 hash', () => {
  for (const file of DRAFT_FILES) {
    const golden = loadGolden(file.draft)
    const scene = sceneOf(loadDraft(file.draft), file.fcurves ? loadFcurves(file.fcurves) : null)
    assert.equal(golden.draft, file.draft)
    assert.equal(golden.frameStart, scene.meta.frameStart)
    assert.equal(golden.frameEnd, scene.meta.frameEnd)
    const span = scene.meta.frameEnd - scene.meta.frameStart + 1
    assert.equal(golden.hashes.length, span, `${file.draft}: hash count`)
    const expectedSamples = collectSampleFrames(scene)
    assert.deepEqual(golden.samples.map((s) => s.frame), expectedSamples, `${file.draft}: sample frames`)

    for (let i = 0; i < span; i++) {
      const frame = scene.meta.frameStart + i
      const actual = hashFrame(evalAt(scene, frame))
      if (actual === golden.hashes[i]) continue
      throw new Error(formatHashMismatch({
        draft: file.draft,
        frame,
        expectedHash: golden.hashes[i] ?? '',
        actualHash: actual,
        details: firstMismatchDetails(golden, file.draft, frame, scene),
      }))
    }
  }
})

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSample,
  collectSampleFrames,
  hashFrame,
  type GoldenFile,
} from './goldenCodec'
import { DRAFT_FILES, evalAt, loadDraft, loadFcurves, samplesDir, sceneOf } from './helpers'

const NOTE =
  'Locks current evaluateFrame output (status quo), not correctness. Do not regenerate silently.'

function goldenOf(draft: string, fcurves: string | null): GoldenFile {
  const scene = sceneOf(loadDraft(draft), fcurves ? loadFcurves(fcurves) : null)
  const start = scene.meta.frameStart
  const end = scene.meta.frameEnd
  const sampleSet = new Set(collectSampleFrames(scene))
  const hashes: string[] = []
  const samples: GoldenFile['samples'] = []
  for (let frame = start; frame <= end; frame++) {
    const snap = evalAt(scene, frame)
    hashes.push(hashFrame(snap))
    if (sampleSet.has(frame)) samples.push(buildSample(frame, snap))
  }
  return { draft, note: NOTE, frameStart: start, frameEnd: end, hashes, samples }
}

function main(): void {
  const dir = join(samplesDir(), 'golden')
  mkdirSync(dir, { recursive: true })
  for (const file of DRAFT_FILES) {
    const golden = goldenOf(file.draft, file.fcurves)
    const path = join(dir, file.draft)
    writeFileSync(path, `${JSON.stringify(golden)}\n`, 'utf8')
    process.stdout.write(`${file.draft} frames=${golden.hashes.length} samples=${golden.samples.length}\n`)
  }
}

main()

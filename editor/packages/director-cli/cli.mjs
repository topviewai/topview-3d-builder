import { readFileSync } from 'node:fs'
import { bakeCameraMotion, evaluateDocumentFrames, validateDirectorDocument } from './evaluate.mjs'
import { applyEditSequenceOps } from './editSequence.mjs'
import { applyStudioIntentCommand, applyStudioIntentsCommand, listCameraPresetsCommand } from './applyIntent.mjs'

import { evaluateStaticPlan } from './staticIntent.mjs'

const command = process.argv[2]
const inputPath = command === 'browser' ? undefined : process.argv[3]
if (!command || (command === 'browser' && process.argv[3] !== 'ensure')
  || (command !== 'browser' && command !== 'list-camera-presets' && !inputPath)) {
  process.stderr.write('usage: node cli.mjs bake|evaluate|evaluate-plan|inspect-nodes|apply-library-pose|apply-library-poses|render-frames|validate|edit-sequence|apply-intent|apply-intents|list-camera-presets <payload.json> | browser ensure [--with-deps]\n')
  process.exit(2)
}

const body = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : {}

const handlers = {
  bake: () => bakeCameraMotion(body),
  'evaluate-plan': () => evaluateStaticPlan(body),
  'inspect-nodes': async () => (await import('./render.mjs')).inspectNodes(body),
  'apply-library-pose': async () => (await import('./render.mjs')).applyLibraryPose(body),
  'apply-library-poses': async () => (await import('./render.mjs')).applyLibraryPoses(body),
  evaluate: () => evaluateDocumentFrames(body),
  validate: () => validateDirectorDocument(body),
  'edit-sequence': () => applyEditSequenceOps(body),
  'apply-intent': () => applyStudioIntentCommand(body),
  'apply-intents': () => applyStudioIntentsCommand(body),
  'list-camera-presets': () => listCameraPresetsCommand(),
  browser: async () => {
    const args = process.argv.slice(4)
    if (args.some((arg) => arg !== '--with-deps')) throw new Error('BROWSER_OPTION_INVALID')
    const { ensureBrowser } = await import('./browser.mjs')
    return ensureBrowser({ withDeps: args.includes('--with-deps') })
  },
  'render-frames': async () => {
    const { renderFrames } = await import('./render.mjs')
    return renderFrames(body)
  },
}

if (!handlers[command]) {
  process.stderr.write(`unknown command ${command}\n`)
  process.exit(2)
}

try {
  const result = await handlers[command]()
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  const text = error instanceof Error
    ? `${error.message}\n${error.stack || ''}`
    : String(error)
  process.stderr.write(`${text}\n`)
  process.exit(1)
}

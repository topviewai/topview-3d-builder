import { listStudioCameraPresets } from '@topview/3d-builder/evaluate'

import { applyStaticIntent } from './staticIntent.mjs'

export function applyStudioIntentCommand(body) {
  if (!body || typeof body.document !== 'object' || !body.intent) {
    throw new Error('document and intent required')
  }
  return applyStaticIntent({
    document: body.document,
    intent: body.intent,
    fcurves: body.fcurves,
  })
}

// Applies intents in order; a failure names the caller's index so nothing partial is used.
export function applyStudioIntentsCommand(body) {
  if (!body || typeof body.document !== 'object' || !Array.isArray(body.intents) || !body.intents.length) {
    throw new Error('document and intents required')
  }
  let document = body.document
  for (const [position, entry] of body.intents.entries()) {
    try {
      document = applyStaticIntent({ document, intent: entry.intent, fcurves: body.fcurves }).document
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`INTENT_REJECTED:${entry.index ?? position}:${message}`)
    }
  }
  return { document }
}

export function listCameraPresetsCommand() {
  return { ok: true, presets: listStudioCameraPresets() }
}

import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { DEFAULT_SKY_COLOR, hydrateSkyColor } from '../../contract/skyColor'
import type { DraftNode } from '../../contract/types'
import { parseDirectorDocument } from '../../contract/validate'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

const PROP: DraftNode = {
  id: 'prop_1',
  type: 'prop',
  name: 'Box',
  visible: true,
  locked: false,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
  prop: { category: 'box' },
}

test('legacy package default hydrates to RGB 30,30,30', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.environment.background.skyColor = '#060608'
  hydrateSkyColor(doc)
  assert.equal(doc.content.environment.background.skyColor, '#1e1e1e')
})

test('empty draft sky is the package default', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  assert.equal(doc.content.environment.background.skyColor, DEFAULT_SKY_COLOR)
})

test('invalid sky hydrates to the package default', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.environment.background.skyColor = 'not-a-color'
  hydrateSkyColor(doc)
  assert.equal(doc.content.environment.background.skyColor, DEFAULT_SKY_COLOR)
})

test('empty genesis leaked browser blue hydrates to the package default', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.environment.background.skyColor = '#0000ff'
  hydrateSkyColor(doc)
  assert.equal(doc.content.environment.background.skyColor, DEFAULT_SKY_COLOR)
})

test('empty genesis #00f leak hydrates to the package default', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.environment.background.skyColor = '#00f'
  hydrateSkyColor(doc)
  assert.equal(doc.content.environment.background.skyColor, DEFAULT_SKY_COLOR)
})

test('non-empty document keeps an intentional blue sky', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.nodes.push(PROP)
  doc.content.environment.background.skyColor = '#0000ff'
  hydrateSkyColor(doc)
  assert.equal(doc.content.environment.background.skyColor, '#0000ff')
})

test('parseDirectorDocument coerces leaked empty-genesis blue', () => {
  const doc = makeEmptyDraft('sky', 30, 120, CAM)
  doc.content.environment.background.skyColor = '#0000ff'
  const parsed = parseDirectorDocument(doc)
  assert.equal(parsed.content.environment.background.skyColor, DEFAULT_SKY_COLOR)
})

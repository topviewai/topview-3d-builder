import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { rectsIntersect } from '../selectionBox'

describe('rectsIntersect', () => {
  it('detects overlapping projected bounds', () => {
    assert.equal(
      rectsIntersect(
        { left: 0, top: 0, width: 40, height: 40 },
        { left: 20, top: 20, width: 40, height: 40 },
      ),
      true,
    )
  })

  it('rejects separated bounds', () => {
    assert.equal(
      rectsIntersect(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 20, top: 0, width: 10, height: 10 },
      ),
      false,
    )
  })
})

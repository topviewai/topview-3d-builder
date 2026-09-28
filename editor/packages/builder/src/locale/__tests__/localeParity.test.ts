import { describe, expect, it } from 'vitest'
import { getFallbackDict, getLocaleDict, listLocales } from '../catalog'
import { LOCALE_NAMES } from '../names'
import type { LocaleDict } from '../types'

function leafKeys(dict: LocaleDict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([key, value]) =>
    typeof value === 'string' ? [prefix + key] : leafKeys(value, `${prefix}${key}.`),
  )
}

describe('locale catalog', () => {
  const english = leafKeys(getFallbackDict()).sort()

  it.each(listLocales())('%s has exactly the English keys', (locale) => {
    expect(leafKeys(getLocaleDict(locale)).sort()).toEqual(english)
  })

  it('names every locale', () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual(listLocales())
  })
})

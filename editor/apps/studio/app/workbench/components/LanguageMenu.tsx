'use client'

import { localeName, orderedLocales } from '@topview/3d-builder'
import { useStudioT } from '../../../src/locale'
import { setStudioLocale, useStudioLocale } from '../../../src/devtools/localePreference'

export function LanguageMenu() {
  const t = useStudioT()
  const locale = useStudioLocale()
  return (
    <label className="wb-language" title={t('界面语言')}>
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1.8 9h14.4M9 1.6c2 2.1 3 4.6 3 7.4s-1 5.3-3 7.4c-2-2.1-3-4.6-3-7.4s1-5.3 3-7.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <select aria-label={t('界面语言')} value={locale} onChange={(event) => setStudioLocale(event.target.value)}>
        {orderedLocales().map((id) => (
          <option key={id} value={id} lang={id}>
            {localeName(id)}
          </option>
        ))}
      </select>
    </label>
  )
}

import { useCallback } from 'react'
import { getStudioLocale, useStudioLocale } from '../devtools/localePreference'
import { errorText, formatStudio } from './catalog'

export { StudioError } from './catalog'

export function translateStudio(key: string, params?: Record<string, string | number>, locale = getStudioLocale()): string {
  return formatStudio(locale, key, params)
}

/** Use the server snapshot during hydration, then update without remounting the editor. */
export function useStudioT() {
  const locale = useStudioLocale()
  return useCallback((key: string, params?: Record<string, string | number>) => formatStudio(locale, key, params), [locale])
}

/** Text of an error for the current UI language. */
export function studioErrorText(error: unknown): string {
  return errorText(error, getStudioLocale())
}

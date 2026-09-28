import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getFallbackDict, getLocaleDict, resolveLocale } from './catalog'
import { translate } from './t'
import type { TranslateFn } from './types'

const LocaleContext = createContext<TranslateFn>((key) => key)
const LanguageContext = createContext('en')
const LocaleChangeContext = createContext<((locale: string) => void) | undefined>(undefined)

export function LocaleProvider({
  locale,
  onLocaleChange,
  children,
}: {
  locale?: string
  onLocaleChange?: (locale: string) => void
  children: ReactNode
}) {
  const t = useMemo<TranslateFn>(() => {
    const dict = getLocaleDict(locale)
    const fallback = getFallbackDict()
    return (key, params) => translate(dict, fallback, key, params)
  }, [locale])

  return (
    <LanguageContext.Provider value={resolveLocale(locale)}>
      <LocaleChangeContext.Provider value={onLocaleChange}>
        <LocaleContext.Provider value={t}>{children}</LocaleContext.Provider>
      </LocaleChangeContext.Provider>
    </LanguageContext.Provider>
  )
}

export function useLocale(): string {
  return useContext(LanguageContext)
}

/** The host's language setter; undefined when the host keeps the language fixed. */
export function useLocaleChange(): ((locale: string) => void) | undefined {
  return useContext(LocaleChangeContext)
}

export function useT(): TranslateFn {
  return useContext(LocaleContext)
}

export function useResolvedLocale(locale?: string): string {
  return resolveLocale(locale)
}

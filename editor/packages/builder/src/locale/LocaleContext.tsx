import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getFallbackDict, getLocaleDict, resolveLocale } from './catalog'
import { translate } from './t'
import type { TranslateFn } from './types'

const LocaleContext = createContext<TranslateFn>((key) => key)
const LanguageContext = createContext('en')

export function LocaleProvider({
  locale,
  children,
}: {
  locale?: string
  children: ReactNode
}) {
  const t = useMemo<TranslateFn>(() => {
    const dict = getLocaleDict(locale)
    const fallback = getFallbackDict()
    return (key, params) => translate(dict, fallback, key, params)
  }, [locale])

  return (
    <LanguageContext.Provider value={resolveLocale(locale)}>
      <LocaleContext.Provider value={t}>{children}</LocaleContext.Provider>
    </LanguageContext.Provider>
  )
}

export function useLocale(): string {
  return useContext(LanguageContext)
}

export function useT(): TranslateFn {
  return useContext(LocaleContext)
}

export function useResolvedLocale(locale?: string): string {
  return resolveLocale(locale)
}

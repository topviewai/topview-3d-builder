import { listLocales } from './catalog'

/** Each language in its own script; these are never translated. */
export const LOCALE_NAMES: Record<string, string> = {
  ar: 'العربية',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  id: 'Bahasa Indonesia',
  ja: '日本語',
  ko: '한국어',
  ms: 'Bahasa Melayu',
  pt: 'Português',
  ru: 'Русский',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
}

const LEADING = ['en', 'zh-CN', 'zh-TW']

/** Every registered locale for a language menu: English and Chinese first, then by id. */
export function orderedLocales(): string[] {
  const ids = listLocales()
  return [...LEADING.filter((id) => ids.includes(id)), ...ids.filter((id) => !LEADING.includes(id))]
}

export function localeName(locale: string): string {
  return LOCALE_NAMES[locale] ?? locale
}

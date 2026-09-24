import type { LocaleDict } from './types'
import { ar } from './strings/ar'
import { de } from './strings/de'
import { en } from './strings/en'
import { es } from './strings/es'
import { fr } from './strings/fr'
import { id } from './strings/id'
import { ja } from './strings/ja'
import { ko } from './strings/ko'
import { ms } from './strings/ms'
import { pt } from './strings/pt'
import { ru } from './strings/ru'
import { tr } from './strings/tr'
import { vi } from './strings/vi'
import { zhCN } from './strings/zh-CN'
import { zhTW } from './strings/zh-TW'

export const DEFAULT_LOCALE = 'en'

const DICTS: Record<string, LocaleDict> = {
  ar,
  de,
  en,
  es,
  fr,
  id,
  ja,
  ko,
  ms,
  pt,
  ru,
  tr,
  vi,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

const ALIASES: Record<string, string> = {
  zh: 'zh-CN',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  'en-US': 'en',
  'en-GB': 'en',
  'pt-BR': 'pt',
  'pt-br': 'pt',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ru-RU': 'ru',
  'vi-VN': 'vi',
  'ms-MY': 'ms',
  'id-ID': 'id',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'tr-TR': 'tr',
}

export function resolveLocale(locale?: string): string {
  if (!locale) return DEFAULT_LOCALE
  if (DICTS[locale]) return locale
  const normalized = locale.replace(/_/g, '-').toLowerCase()
  const exact = Object.keys(DICTS).find((id) => id.toLowerCase() === normalized)
  if (exact) return exact
  const aliased = ALIASES[locale]
  if (aliased && DICTS[aliased]) return aliased
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(normalized)) return 'zh-TW'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  const language = normalized.split('-')[0]
  if (DICTS[language]) return language
  return DEFAULT_LOCALE
}

export function getLocaleDict(locale?: string): LocaleDict {
  return DICTS[resolveLocale(locale)] ?? en
}

export function getFallbackDict(): LocaleDict {
  return en
}

export function registerLocale(locale: string, dict: LocaleDict): void {
  DICTS[locale] = dict
}

export function listLocales(): string[] {
  return Object.keys(DICTS).sort((a, b) => a.localeCompare(b))
}

import ar from './ar.json'
import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import id from './id.json'
import ja from './ja.json'
import ko from './ko.json'
import ms from './ms.json'
import pt from './pt.json'
import ru from './ru.json'
import tr from './tr.json'
import vi from './vi.json'
import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'

type Params = Record<string, string | number | StudioError>

const messages: Record<string, Record<string, string>> = {'ar': ar, 'de': de, 'en': en, 'es': es, 'fr': fr, 'id': id, 'ja': ja, 'ko': ko, 'ms': ms, 'pt': pt, 'ru': ru, 'tr': tr, 'vi': vi, 'zh-CN': zhCN, 'zh-TW': zhTW}

export const DEFAULT_LOCALE = 'en'

/** Same rules as the builder's resolveLocale, over Studio's catalog, without loading the builder. */
export function resolveLocale(locale?: string | null): string {
  if (!locale) return DEFAULT_LOCALE
  if (messages[locale]) return locale
  const normalized = locale.replace(/_/g, '-').toLowerCase()
  const exact = Object.keys(messages).find((id) => id.toLowerCase() === normalized)
  if (exact) return exact
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(normalized)) return 'zh-TW'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  const language = normalized.split('-')[0]
  return messages[language] ? language : DEFAULT_LOCALE
}

/** Holds the language the user picked, so server-rendered pages follow it too. */
export const STUDIO_LOCALE_COOKIE = 't3d-studio-locale'

/** Message keys are the Simplified Chinese source text; `{{name}}` marks a parameter. */
export function formatStudio(locale: string, key: string, params?: Params): string {
  for (const prefix of ['草稿不存在: ', '非法草稿 id: ', '草稿已存在: ']) {
    if (key.startsWith(prefix) && key !== `${prefix}{{detail}}`) {
      return formatStudio(locale, `${prefix}{{detail}}`, { detail: key.slice(prefix.length) })
    }
  }
  const template = messages[locale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (token, name: string) => {
    const value = params?.[name]
    if (value === undefined) return token
    return value instanceof StudioError ? formatStudio(locale, value.key, value.params) : String(value)
  })
}

/** First candidate the catalog supports (a bare `en` counts), else English. */
export function pickLocale(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    const resolved = resolveLocale(candidate)
    if (resolved !== DEFAULT_LOCALE || candidate.toLowerCase().startsWith(DEFAULT_LOCALE)) return resolved
  }
  return DEFAULT_LOCALE
}

/** Language tags of an Accept-Language header, highest quality first. */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...options] = part.trim().split(';')
      const q = options.map((option) => option.trim()).find((option) => option.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((item) => item.tag && item.tag !== '*' && Number.isFinite(item.q) && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((item) => item.tag)
}

/** The stored choice when it is a supported locale, else the best Accept-Language match. */
export function negotiateLocale(stored: string | null | undefined, acceptLanguage: string | null | undefined): string {
  if (stored) {
    const resolved = resolveLocale(stored)
    if (resolved === stored) return resolved
  }
  return pickLocale(acceptedLanguages(acceptLanguage))
}

/**
 * An error whose text is a catalog key, translated where it reaches the user (an API response or
 * the UI). `message` is the English text for logs.
 */
export class StudioError extends Error {
  constructor(
    readonly key: string,
    readonly params?: Params,
    readonly status?: number,
  ) {
    super(formatStudio(DEFAULT_LOCALE, key, params))
    this.name = 'StudioError'
  }
}

export function errorText(error: unknown, locale: string): string {
  if (error instanceof StudioError) return formatStudio(locale, error.key, error.params)
  return error instanceof Error ? error.message : String(error)
}

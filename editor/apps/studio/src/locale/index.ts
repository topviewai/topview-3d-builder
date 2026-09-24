import { useCallback } from 'react'
import { getStudioLocale, useStudioLocale } from '../devtools/localePreference'
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

const messages: Record<string, Record<string, string>> = {'ar': ar, 'de': de, 'en': en, 'es': es, 'fr': fr, 'id': id, 'ja': ja, 'ko': ko, 'ms': ms, 'pt': pt, 'ru': ru, 'tr': tr, 'vi': vi, 'zh-CN': zhCN, 'zh-TW': zhTW}

export function translateStudio(key: string, params?: Record<string, string | number>, locale = getStudioLocale()): string {
  for (const prefix of ['草稿不存在: ', '非法草稿 id: ', '草稿已存在: ']) {
    if (key.startsWith(prefix) && key !== `${prefix}{{detail}}`) {
      return translateStudio(`${prefix}{{detail}}`, { detail: key.slice(prefix.length) }, locale)
    }
  }
  const template = messages[locale]?.[key] ?? en[key as keyof typeof en] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (token, name: string) => params?.[name] === undefined ? token : String(params[name]))
}

/** Use the server snapshot during hydration, then update without remounting the editor. */
export function useStudioT() {
  const locale = useStudioLocale()
  return useCallback((key: string, params?: Record<string, string | number>) => translateStudio(key, params, locale), [locale])
}

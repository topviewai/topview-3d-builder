'use client'

import { useStudioT } from '../../locale'


import { listLocales } from '@topview/3d-builder'
import { setStudioLocale, STUDIO_DEFAULT_LOCALE, useStudioLocale } from '../localePreference'

const PREFERRED_LOCALES = ['zh-CN', 'zh-TW', 'en'] as const

const LOCALE_LABELS: Record<string, string> = {
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

function orderLocales(ids: string[]): string[] {
  const preferredSet = new Set<string>(PREFERRED_LOCALES)
  const preferred = PREFERRED_LOCALES.filter((id) => ids.includes(id))
  const rest = ids.filter((id) => !preferredSet.has(id))
  return [...preferred, ...rest]
}

export function LocaleSwitchPanel() {
  const t = useStudioT()
  const locale = useStudioLocale()
  const locales = orderLocales(listLocales())
  const currentLabel = LOCALE_LABELS[locale] ?? locale

  return (
    <div className="studio-devtools-upload">
      <p className="studio-devtools-hint">{t("切换导演台界面语言。只影响本调试宿主，刷新后仍保留，不会重建 3D 引擎。")}</p>
      <p className="studio-devtools-hint">
        {t('当前：{{label}}（{{locale}}）', { label: currentLabel, locale })}
      </p>
      <div className="studio-devtools-locale-grid">
        {locales.map((id) => (
          <button
            key={id}
            type="button"
            className={id === locale ? 'studio-devtools-locale-btn is-active' : 'studio-devtools-locale-btn'}
            aria-pressed={id === locale}
            onClick={() => setStudioLocale(id)}
          >
            <span>{LOCALE_LABELS[id] ?? id}</span>
            <small>{id}</small>
          </button>
        ))}
      </div>
      {locale !== STUDIO_DEFAULT_LOCALE ? (
        <button type="button" className="studio-devtools-linkish" onClick={() => setStudioLocale(STUDIO_DEFAULT_LOCALE)}>{t("恢复默认（简体中文）")}</button>
      ) : null}
    </div>
  )
}

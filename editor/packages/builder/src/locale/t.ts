import type { LocaleDict } from './types'

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (all, name: string) => {
    const value = params[name]
    return value === undefined ? all : String(value)
  })
}

export function lookup(dict: LocaleDict, key: string): string | undefined {
  let current: string | LocaleDict | undefined = dict
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = current[part]
  }
  return typeof current === 'string' ? current : undefined
}

export function translate(
  dict: LocaleDict,
  fallback: LocaleDict,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = lookup(dict, key) ?? lookup(fallback, key) ?? key
  return interpolate(raw, params)
}

export type LocaleDict = {
  [key: string]: string | LocaleDict
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

import { errorText, formatStudio, negotiateLocale, STUDIO_LOCALE_COOKIE, StudioError } from './catalog'

type Params = Parameters<typeof formatStudio>[2]

function cookieValue(header: string | null, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** The language for a server response: the user's stored choice, else Accept-Language. */
export function localeFromHeaders(headers: Headers): string {
  return negotiateLocale(cookieValue(headers.get('cookie'), STUDIO_LOCALE_COOKIE), headers.get('accept-language'))
}

export function requestLocale(request: Request): string {
  return localeFromHeaders(request.headers)
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** A small standalone HTML page (login flow) in the request's language. */
export function htmlPage(locale: string, bodyHtml: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>Topview</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#222">
${bodyHtml}
</body>
</html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

/** Status carried by a StudioError, else the fallback. */
export function errorStatus(error: unknown, fallback: number): number {
  return error instanceof StudioError && error.status ? error.status : fallback
}

/** Translator bound to one request. */
export function requestT(request: Request) {
  const locale = requestLocale(request)
  return {
    locale,
    t: (key: string, params?: Params) => formatStudio(locale, key, params),
    html: (key: string, params?: Params) => escapeHtml(formatStudio(locale, key, params)),
    error: (error: unknown) => errorText(error, locale),
  }
}

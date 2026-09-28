import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import '@topview/3d-builder/styles.css'
import './globals.css'
import { DevToolsDock } from '../src/devtools/DevToolsDock'
import { StudioLocaleRoot } from '../src/devtools/localePreference'
import { localeFromHeaders } from '../src/locale/server'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = localeFromHeaders(await headers())
  return (
    <html lang={locale}>
      <body>
        <StudioLocaleRoot serverLocale={locale}>
          {children}
          <DevToolsDock />
        </StudioLocaleRoot>
      </body>
    </html>
  )
}

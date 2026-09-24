import type { ReactNode } from 'react'
import '@topview/3d-builder/styles.css'
import './globals.css'
import { DevToolsDock } from '../src/devtools/DevToolsDock'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <DevToolsDock />
      </body>
    </html>
  )
}

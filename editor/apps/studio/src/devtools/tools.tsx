'use client'

import type { ReactNode } from 'react'
import { ExportDraftPanel } from './tools/ExportDraftPanel'
import { LocaleSwitchPanel } from './tools/LocaleSwitchPanel'
export interface DevToolDefinition {
  id: string
  title: string
  description: string
  render: () => ReactNode
}

export const DEV_TOOLS: DevToolDefinition[] = [
  {
    id: 'locale-switch',
    title: '界面语言',
    description: '切换导演台 UI 语言，刷新后仍保留。',
    render: () => <LocaleSwitchPanel />,
  },
  {
    id: 'export-draft',
    title: '导出草稿',
    description: '下载当前打开草稿的 JSON 与用户关键帧。',
    render: () => <ExportDraftPanel />,
  },
]

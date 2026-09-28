'use client'

import { useState } from 'react'
import { useStudioT } from '../locale'
import { DEV_TOOLS } from './tools'
import './styles.css'

export function DevToolsDock() {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(DEV_TOOLS[0]?.id ?? null)
  const t = useStudioT()
  const active = DEV_TOOLS.find((tool) => tool.id === activeId) ?? null

  return (
    <div className="studio-devtools">
      {open ? (
        <div className="studio-devtools-panel" role="dialog" aria-label={t('Studio 开发者工具')}>
          <div className="studio-devtools-header">
            <strong>{t('开发者工具')}</strong>
            <button type="button" className="studio-devtools-icon-btn" onClick={() => setOpen(false)}>{t('关闭')}</button>
          </div>
          <div className="studio-devtools-body">
            <nav className="studio-devtools-nav">
              {DEV_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={
                    tool.id === activeId
                      ? 'studio-devtools-nav-item is-active'
                      : 'studio-devtools-nav-item'
                  }
                  onClick={() => setActiveId(tool.id)}
                >
                  <span>{t(tool.title)}</span>
                  <small>{t(tool.description)}</small>
                </button>
              ))}
            </nav>
            <div className="studio-devtools-content">{active ? active.render() : null}</div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="studio-devtools-fab"
        aria-label={t('打开 Studio 开发者工具')}
        title={t('开发者工具')}
        onClick={() => setOpen((value) => !value)}
      >{t('工具')}</button>
    </div>
  )
}

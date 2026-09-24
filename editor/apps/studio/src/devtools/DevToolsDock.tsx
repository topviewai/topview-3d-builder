'use client'

import { useEffect, useState } from 'react'
import { useStudioLocale } from './localePreference'
import { DEV_TOOLS } from './tools'
import './styles.css'

export function DevToolsDock() {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(DEV_TOOLS[0]?.id ?? null)
  const locale = useStudioLocale()
  const active = DEV_TOOLS.find((tool) => tool.id === activeId) ?? null

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <div className="studio-devtools">
      {open ? (
        <div className="studio-devtools-panel" role="dialog" aria-label="Studio 开发者工具">
          <div className="studio-devtools-header">
            <strong>开发者工具</strong>
            <button type="button" className="studio-devtools-icon-btn" onClick={() => setOpen(false)}>关闭</button>
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
                  <span>{tool.title}</span>
                  <small>{tool.description}</small>
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
        aria-label="打开 Studio 开发者工具"
        title="开发者工具"
        onClick={() => setOpen((value) => !value)}
      >工具</button>
    </div>
  )
}

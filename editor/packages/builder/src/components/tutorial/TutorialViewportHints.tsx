import { useT } from '../../locale'

function MouseGlyph({ kind }: { kind: 'left' | 'middle' | 'wheel' }) {
  return (
    <svg className="t3d-tutorial-mouse-svg" viewBox="0 0 20 28" fill="none" aria-hidden>
      <rect x="3.2" y="1.8" width="13.6" height="24.4" rx="6.8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 2v8.4" stroke="currentColor" strokeWidth="1.4" />
      {kind === 'left' ? <path d="M4.6 3.4C5.2 2.4 7.1 1.8 10 1.8V10.4H4.4V9.2c0-2.2.05-4.1.2-5.8Z" fill="currentColor" /> : null}
      {kind === 'middle' ? <rect x="8.7" y="3.6" width="2.6" height="5.4" rx="1.3" fill="currentColor" /> : null}
      {kind === 'wheel' ? (
        <>
          <path d="M10 3.3v6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M7.8 5.1c.9-.8 1.6-1.6 2.2-1.6s1.3.8 2.2 1.6M12.2 8c-.9.8-1.6 1.6-2.2 1.6S8.7 8.8 7.8 8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  )
}

function Key({ children }: { children: string }) {
  return <kbd>{children}</kbd>
}

export function TutorialViewportHints() {
  const t = useT()
  return (
    <div className="t3d-tutorial-hints">
      <div className="t3d-tutorial-hint-group">
        <span className="t3d-tutorial-hint">
          <span className="t3d-tutorial-mouse">
            <MouseGlyph kind="left" />
          </span>
          <span>{t('tutorial.viewportLook')}</span>
        </span>
        <span className="t3d-tutorial-hint">
          <span className="t3d-tutorial-mouse">
            <MouseGlyph kind="middle" />
          </span>
          <span>{t('tutorial.viewportPan')}</span>
        </span>
        <span className="t3d-tutorial-hint">
          <span className="t3d-tutorial-mouse">
            <MouseGlyph kind="wheel" />
          </span>
          <span>{t('tutorial.viewportZoom')}</span>
        </span>
      </div>
      <div className="t3d-tutorial-hint-group">
        <span className="t3d-tutorial-hint">
          <span className="t3d-tutorial-keys" aria-hidden>
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
          </span>
          <span>{t('tutorial.viewportMove')}</span>
        </span>
        <span className="t3d-tutorial-hint">
          <Key>E</Key>
          <span>{t('tutorial.viewportUp')}</span>
        </span>
        <span className="t3d-tutorial-hint">
          <Key>Q</Key>
          <span>{t('tutorial.viewportDown')}</span>
        </span>
      </div>
    </div>
  )
}

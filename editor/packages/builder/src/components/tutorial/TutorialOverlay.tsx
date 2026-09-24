import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../locale'
import { usePortalRoot } from '../overlay/PortalRoot'
import { cx } from '../common/cx'
import {
  TUTORIAL_CARD_MIN_HEIGHT,
  TUTORIAL_CARD_WIDTH,
  TUTORIAL_HOLE_PAD,
} from './constants'
import type { BoxRect, CardPlacement, TutorialCardSide } from './types'
import { TutorialViewportHints } from './TutorialViewportHints'
import { clientRectOf, padRect, placeCard } from './utils'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )
}

export function TutorialOverlay({
  stepIndex,
  stepCount,
  title,
  body,
  isFirst,
  isLast,
  onClose,
  onPrev,
  onNext,
  onJump,
  anchorId,
  side,
}: {
  stepIndex: number
  stepCount: number
  title: string
  body: string
  isFirst: boolean
  isLast: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onJump: (index: number) => void
  anchorId: string
  side: TutorialCardSide
}) {
  const t = useT()
  const portal = usePortalRoot()
  const cardRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [hole, setHole] = useState<BoxRect | null>(null)
  const [placement, setPlacement] = useState<CardPlacement>({ left: 24, top: 24, side: 'right' })

  if (restoreRef.current === null && document.activeElement instanceof HTMLElement) {
    restoreRef.current = document.activeElement
  }

  useLayoutEffect(() => {
    const root = portal?.closest<HTMLElement>('.t3d-root')
    if (!root) return undefined

    const measure = () => {
      const target = root.querySelector(`[data-tutorial-anchor="${anchorId}"]`)
      if (!target) return
      const targetRect = clientRectOf(target)
      const rootRect = clientRectOf(root)
      const cardRect = cardRef.current?.getBoundingClientRect()
      const card = {
        width: cardRect?.width || TUTORIAL_CARD_WIDTH,
        height: cardRect?.height || TUTORIAL_CARD_MIN_HEIGHT,
      }
      setHole(padRect(targetRect, TUTORIAL_HOLE_PAD))
      setPlacement(placeCard(targetRect, rootRect, card, side))
    }

    measure()
    const frame = window.requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    const target = root.querySelector(`[data-tutorial-anchor="${anchorId}"]`)
    if (target) ro.observe(target)
    window.addEventListener('resize', measure)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
        return
      }
      if (e.key !== 'Tab' || !cardRef.current) return
      const items = listFocusable(cardRef.current)
      if (items.length === 0) {
        e.preventDefault()
        cardRef.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !cardRef.current.contains(active)
      if (e.shiftKey) {
        if (active === first || outside) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || outside) {
        e.preventDefault()
        first.focus()
      }
    }

    root.addEventListener('keydown', onKey)
    const preferred = cardRef.current?.querySelector<HTMLElement>('[data-tutorial-primary]')
    ;(preferred ?? cardRef.current)?.focus()

    return () => {
      window.cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', measure)
      root.removeEventListener('keydown', onKey)
      restoreRef.current?.focus()
    }
  }, [anchorId, onClose, onNext, onPrev, portal, side])

  if (!portal) return null

  return createPortal(
    <div className="t3d-tutorial" role="presentation">
      {hole ? (
        <div
          className="t3d-tutorial-hole"
          style={{
            left: hole.left,
            top: hole.top,
            width: hole.width,
            height: hole.height,
          }}
          aria-hidden
        />
      ) : null}
      <div
        ref={cardRef}
        className={cx('t3d-tutorial-card', anchorId === 'viewport' && 'is-viewport')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="t3d-tutorial-title"
        tabIndex={-1}
        style={{ left: placement.left, top: placement.top }}
      >
        <div className="t3d-tutorial-head">
          {stepCount > 1 ? <div className="t3d-tutorial-progress">
            <span>{t('tutorial.stepOf', { current: stepIndex + 1, total: stepCount })}</span>
            <div className="t3d-tutorial-dots" role="tablist" aria-label={t('tutorial.title')}>
              {Array.from({ length: stepCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={index === stepIndex}
                  className={cx('t3d-tutorial-dot', index === stepIndex && 'is-active')}
                  onClick={() => onJump(index)}
                />
              ))}
            </div>
          </div> : <span />}
          <button type="button" className="t3d-tutorial-close" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <h2 id="t3d-tutorial-title" className="t3d-tutorial-title">{title}</h2>
        <p className="t3d-tutorial-body">{body}</p>
        {anchorId === 'viewport' ? <TutorialViewportHints /> : null}
        <div className="t3d-tutorial-footer">
          {stepCount > 1 ? <button type="button" className="t3d-tutorial-skip" onClick={onClose}>
            {t('tutorial.skip')}
          </button> : <span />}
          <div className="t3d-tutorial-nav">
            {stepCount > 1 ? <button type="button" className="t3d-tutorial-back" onClick={onPrev} disabled={isFirst}>
              {t('tutorial.back')}
            </button> : null}
            <button type="button" className="t3d-tutorial-next" data-tutorial-primary onClick={onNext}>
              {isLast ? t('tutorial.done') : t('tutorial.next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portal,
  )
}

import { useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'
import { TutorialOverlay } from './TutorialOverlay'
import { useTutorialTour } from './hooks/useTutorialTour'

export function TutorialGlyph() {
  return (
    <svg className="t3d-topbar-glyph t3d-topbar-glyph-tutorial" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3.2 7.15 9 4.4l5.8 2.75L9 9.9 3.2 7.15Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M5.15 8.2v3.15c0 .7 1.72 1.7 3.85 1.7s3.85-1 3.85-1.7V8.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path d="M14.8 7.3v4.15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function TutorialButton({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const tour = useTutorialTour()

  return (
    <>
      <Tooltip label={t('tutorial.title')}>
        <button
          type="button"
          className="t3d-topbar-icon-btn"
          aria-label={t('tutorial.title')}
          aria-pressed={tour.open}
          disabled={disabled}
          onClick={(event) => (tour.open ? tour.stop() : tour.start(event.currentTarget))}
        >
          <TutorialGlyph />
        </button>
      </Tooltip>
      {tour.open && tour.step ? (
        <TutorialOverlay
          stepIndex={tour.stepIndex}
          stepCount={tour.steps.length}
          title={t(tour.step.titleKey)}
          body={t(tour.step.bodyKey)}
          isFirst={tour.isFirst}
          isLast={tour.isLast}
          onClose={tour.stop}
          onPrev={tour.prev}
          onNext={tour.next}
          onJump={tour.goTo}
          anchorId={tour.step.id}
          side={tour.step.side}
        />
      ) : null}
    </>
  )
}

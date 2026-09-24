import { Tooltip } from './Tooltip'

export function FieldHelp({ text }: { text: string }) {
  return (
    <Tooltip label={text} side="top" variant="description" showOnFocus>
      <span className="t3d-field-help" tabIndex={0} role="img" aria-label={text}
        onClick={(event) => event.preventDefault()}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" />
          <path d="M6.3 6a1.7 1.7 0 0 1 3.4 0c0 1.2-1.7 1.3-1.7 2.6" stroke="currentColor" strokeLinecap="round" />
          <circle cx="8" cy="11" r=".7" fill="currentColor" />
        </svg>
      </span>
    </Tooltip>
  )
}

import { useEffect, useState } from 'react'
import { formatTimecode, parseTimecode } from '../../evaluate/timecode'
import { useT } from '../../locale'

export function FilmTimecodeField({
  label,
  value,
  fps,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  fps: number
  disabled?: boolean
  onCommit: (frame: number) => void
}) {
  const t = useT()
  const [text, setText] = useState(formatTimecode(value, fps))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(formatTimecode(value, fps))
    setInvalid(false)
  }, [value, fps])
  return (
    <label className="t3d-film-field">
      <span className="t3d-film-field-label">{label}</span>
      <input
        className="t3d-film-timecode"
        data-tc={label}
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        aria-label={label}
        onFocus={() => setText(formatTimecode(value, fps))}
        onChange={(event) => {
          setText(event.target.value)
          setInvalid(parseTimecode(event.target.value, fps) == null)
        }}
        onBlur={() => {
          const parsed = parseTimecode(text, fps)
          if (parsed == null) {
            setInvalid(true)
            setText(formatTimecode(value, fps))
            return
          }
          setInvalid(false)
          onCommit(parsed)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {invalid ? <span className="t3d-film-field-error">{t('film.invalidTimecode')}</span> : null}
    </label>
  )
}

import type { ReactElement } from 'react'
import { IconSearch } from './icons'

export function SearchField({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
}): ReactElement {
  return (
    <label className="t3d-leftrail-search">
      <IconSearch className="t3d-leftrail-search-icon" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

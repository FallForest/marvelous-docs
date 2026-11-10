import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { LANGUAGES, canonicalLanguage, languageLabel } from '../../lib/languages'

type Props = {
  /** Current language token as stored on the node (may be an alias or unknown). */
  value: string
  /** Called with the canonical id when the user picks an entry. */
  onChange: (id: string) => void
}

/**
 * Language picker for a code block.
 *
 * A native <select> cannot be styled consistently (the popup is drawn by the
 * OS), so this renders a button plus a listbox. The list shows canonical
 * languages only; the current value may be an alias (`js`) or an unknown fence
 * language, in which case it is displayed verbatim and marked as unrecognised
 * instead of leaving the control blank.
 */
export default function LanguagePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canonical = canonicalLanguage(value)
  const label = languageLabel(value)
  const unknown = !canonical && Boolean(value && value.trim())

  // Keep the highlighted row on the current language each time it opens.
  const selectedIndex = useMemo(
    () => Math.max(0, LANGUAGES.findIndex((entry) => entry.id === canonical)),
    [canonical],
  )

  useEffect(() => {
    if (open) setActive(selectedIndex)
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, LANGUAGES.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
      if (event.key === 'Enter') {
        event.preventDefault()
        const entry = LANGUAGES[active]
        if (entry) { onChange(entry.id); setOpen(false) }
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, active, onChange])

  return <div className="lang-picker" ref={rootRef}>
    <button
      type="button"
      className={'lang-picker-button' + (open ? ' is-open' : '')}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={'代码语言：' + label}
      title={unknown ? label + '（未识别）' : '更改代码语言'}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="lang-picker-label">{label}</span>
      {unknown && <span className="lang-picker-flag">未识别</span>}
      <ChevronDown size={12} />
    </button>
    {open && <div className="lang-picker-panel" role="listbox" aria-label="选择代码语言">
      {LANGUAGES.map((entry, index) => <button
        key={entry.id}
        type="button"
        role="option"
        aria-selected={entry.id === canonical}
        className={'lang-picker-item' + (index === active ? ' active' : '') + (entry.id === canonical ? ' selected' : '')}
        onMouseEnter={() => setActive(index)}
        onClick={() => { onChange(entry.id); setOpen(false) }}
      >
        <span>{entry.label}</span>
        {entry.id === canonical && <Check size={13} />}
      </button>)}
    </div>}
  </div>
}

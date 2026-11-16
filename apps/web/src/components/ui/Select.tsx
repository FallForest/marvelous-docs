import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Popover from './Popover'

export type SelectOption = { value: string; label: string; disabled?: boolean }

type SelectProps = {
  value: string
  onValueChange: (value: string) => void
  options: readonly SelectOption[]
  label: string
  disabled?: boolean
  className?: string
}

/**
 * Select-only combobox shared by both appearances. The popup is real HTML, so
 * its paper and pencil skin covers the options as well as the closed control.
 * Focus stays on the trigger while aria-activedescendant announces the current
 * row. This also preserves a containing dialog's focus trap across the portal.
 */
export default function Select({ value, onValueChange, options, label, disabled = false, className = '' }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState(value)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef({ text: '', at: 0 })
  const listId = useId()
  const enabled = options.filter((option) => !option.disabled)
  const available = !disabled && enabled.length > 0
  const expanded = open && available
  const selected = options.find((option) => option.value === value)
  const active = enabled.find((option) => option.value === activeValue) ?? enabled.find((option) => option.value === value) ?? enabled[0]
  const activeIndex = options.findIndex((option) => option.value === active?.value)
  const optionId = (index: number) => listId + '-option-' + index

  function show() {
    if (!available) return
    search.current = { text: '', at: 0 }
    setActiveValue(enabled.find((option) => option.value === value)?.value ?? enabled[0]!.value)
    trigger.current?.focus({ preventScroll: true })
    setOpen(true)
  }

  function commit(option: SelectOption | undefined) {
    if (!option || option.disabled || !available) return
    setOpen(false)
    if (option.value !== value) onValueChange(option.value)
    trigger.current?.focus({ preventScroll: true })
  }

  // Window capture runs before modal Escape handlers on document. Dismissing an
  // option list must leave its share/invite dialog in place.
  useEffect(() => {
    if (!expanded) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded])

  useEffect(() => { if (!available) setOpen(false) }, [available])

  useLayoutEffect(() => {
    if (!expanded || activeIndex < 0) return
    document.getElementById(listId + '-option-' + activeIndex)?.scrollIntoView({ block: 'nearest' })
  }, [expanded, activeIndex, listId])

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!available || event.nativeEvent.isComposing) return
    const { key } = event
    if (key === 'Tab') { setOpen(false); return }
    if (key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      search.current = { text: '', at: 0 }
      if (!expanded) {
        show()
        if (key === 'Home') setActiveValue(enabled[0]!.value)
        if (key === 'End') setActiveValue(enabled[enabled.length - 1]!.value)
        return
      }
      const index = enabled.findIndex((option) => option.value === active?.value)
      const next = key === 'Home' ? 0 : key === 'End' ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))
      setActiveValue(enabled[next]!.value)
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      if (expanded) commit(active)
      else show()
      return
    }
    if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    const now = Date.now()
    const text = (now - search.current.at < 700 ? search.current.text : '') + key.toLocaleLowerCase()
    search.current = { text, at: now }
    // Repeated letters cycle through matching names, like a native select.
    const repeated = [...text].every((character) => character === text[0])
    const query = repeated ? text[0]! : text
    const start = enabled.findIndex((option) => option.value === (expanded ? active?.value : value))
    const ordered = repeated ? [...enabled.slice(start + 1), ...enabled.slice(0, start + 1)] : enabled
    const match = ordered.find((option) => option.label.toLocaleLowerCase().startsWith(query))
    if (!match) return
    setActiveValue(match.value)
    if (!expanded && match.value !== value) onValueChange(match.value)
  }

  return <span className="select-control">
    <button
      ref={trigger}
      type="button"
      role="combobox"
      className={'select-trigger sketch-frame' + (className ? ' ' + className : '')}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
      disabled={!available}
      onKeyDown={onKeyDown}
      onClick={() => { if (expanded) setOpen(false); else show() }}
      onBlur={() => setOpen(false)}
    >
      <span className="select-value">{selected?.label ?? value}</span>
      <ChevronDown className="select-chevron" size={14} aria-hidden="true" />
    </button>
    <Popover open={expanded} onClose={() => setOpen(false)} align="left" className="select-panel sketch-frame" role="listbox" id={listId} label={label} focusOnOpen={false}>
      <div className="select-options">
        {options.map((option, index) => <div
          key={option.value}
          id={optionId(index)}
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled || undefined}
          data-value={option.value}
          data-active={option.value === active?.value || undefined}
          className="select-option"
          // Pointer selection leaves focus on the combobox for modal traps.
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={() => { if (!option.disabled) setActiveValue(option.value) }}
          onClick={() => commit(option)}
        >
          <span>{option.label}</span>
          <Check size={14} className="select-check" aria-hidden="true" />
        </div>)}
      </div>
    </Popover>
  </span>
}

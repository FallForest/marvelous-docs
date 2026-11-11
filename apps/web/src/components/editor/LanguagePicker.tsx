import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { LANGUAGES, canonicalLanguage, languageLabel } from '../../lib/languages'
import { DURATION } from '../../lib/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

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
 *
 * Motion: the panel is portaled to <body> and re-measured on every scroll, so
 * it enters with the shared .motion-rise animation rather than a transition.
 * When the chosen language changes, the button acknowledges the commit once.
 */
export default function LanguagePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // The list is portaled to body, so it is outside rootRef; track it separately
  // or every click inside the panel counts as "outside" and closes it before
  // the item's click handler can run.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const reduced = useReducedMotion()
  // True for one beat after a commit. The ring has to come off again or the
  // shared .is-acknowledged rule would be a permanent halo instead of feedback.
  const [ack, setAck] = useState(false)
  const ackTimer = useRef<number | undefined>(undefined)
  const previousValue = useRef(value)

  // The code block clips its own overflow, so the list is portaled to body and
  // positioned from the button's rect, flipping up when there is no room below.
  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return }
    const measure = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const flip = below < 200 && above > below
      const maxHeight = Math.max(120, Math.min(264, flip ? above : below))
      setPanelPos({ top: flip ? Math.max(8, rect.top - Math.min(264, maxHeight) - 4) : rect.bottom + 4, left: rect.left, maxHeight })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure) }
  }, [open])

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

  /*
   * Acknowledge the commit, not the hover: when `value` actually changes, the
   * trigger plays a ring once so the choice lands even though the panel closes
   * in the same tick. The timer clears the class again, otherwise a second
   * identical pick would reuse the finished animation and show nothing.
   */
  useEffect(() => {
    if (previousValue.current === value) return
    previousValue.current = value
    // Under reduced motion the ring is suppressed by motion.css, but the flag is
    // still set so the acknowledgement does not linger for a later motion-on frame.
    setAck(true)
    window.clearTimeout(ackTimer.current)
    ackTimer.current = window.setTimeout(() => setAck(false), DURATION.slow)
    return () => window.clearTimeout(ackTimer.current)
  }, [value])

  /*
   * The panel is scrolled while the pointer travels down a long language list,
   * so the highlighted row is kept fully visible with block:'nearest'. It is a
   * no-op when the row is already in view, which is what stops the list from
   * jumping under the cursor; smooth scrolling is dropped under reduced motion.
   */
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const row = panel?.children[active] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [open, active, reduced])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
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
      ref={buttonRef}
      type="button"
      className={'lang-picker-button' + (open ? ' is-open' : '') + (ack ? ' is-acknowledged' : '')}
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
    {open && panelPos && createPortal(<div ref={panelRef} className="lang-picker-panel motion-rise" role="listbox" aria-label="选择代码语言" style={{ top: panelPos.top, left: panelPos.left, maxHeight: panelPos.maxHeight }}>
      {LANGUAGES.map((entry, index) => <button
        key={entry.id}
        type="button"
        role="option"
        aria-selected={entry.id === canonical}
        className={'lang-picker-item' + (index === active ? ' active' : '') + (entry.id === canonical ? ' selected' : '') + (entry.id === canonical && ack ? ' is-acknowledged' : '')}
        onMouseEnter={() => setActive(index)}
        onClick={() => { onChange(entry.id); setOpen(false) }}
      >
        <span>{entry.label}</span>
        {entry.id === canonical && <Check size={13} />}
      </button>)}
    </div>, document.body)}
  </div>
}
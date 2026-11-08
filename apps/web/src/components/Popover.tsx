import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type PopoverProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
  label: string
}

/**
 * A non-modal popover: no full-screen scrim, closes on outside pointerdown or
 * Escape, and keeps focus inside the menu while it is open. This replaces the
 * old menu-scrim pattern that intercepted clicks on unrelated buttons.
 */
export default function Popover({ open, onClose, children, align = 'right', className = '', label }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!ref.current || !target) return
      if (ref.current.contains(target)) return
      const anchor = ref.current.parentElement
      if (anchor && anchor.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !ref.current) return
    const first = ref.current.querySelector<HTMLElement>('[role="menuitem"], button, [tabindex="0"]')
    first?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return <div
    ref={ref}
    className={'popover popover-' + align + (className ? ' ' + className : '')}
    role="menu"
    aria-label={label}
  >{children}</div>
}

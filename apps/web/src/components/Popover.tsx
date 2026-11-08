import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

type PopoverProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
  label: string
}

type Position = { top: number; left: number; minWidth: number; maxHeight: number; placement: 'below' | 'above' }

const GAP = 6
const EDGE = 8

/**
 * Non-modal popover rendered in a portal on document.body with fixed
 * positioning. Portals are required because the trigger often lives inside a
 * scroll container (sidebar, document tree); an absolutely positioned menu
 * there gets clipped by that container's overflow.
 */
export default function Popover({ open, onClose, children, align = 'right', className = '', label }: PopoverProps) {
  const marker = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [position, setPosition] = useState<Position | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const measure = () => {
      const anchor = marker.current?.parentElement
      const node = panel.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = node?.offsetWidth || 180
      const height = node?.offsetHeight || 240
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const spaceBelow = viewportHeight - rect.bottom - GAP - EDGE
      const spaceAbove = rect.top - GAP - EDGE
      const placement: 'below' | 'above' = spaceBelow >= height || spaceBelow >= spaceAbove ? 'below' : 'above'
      const top = placement === 'below' ? rect.bottom + GAP : Math.max(EDGE, rect.top - height - GAP)
      let left = align === 'right' ? rect.right - width : rect.left
      left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewportWidth - width - EDGE))
      setPosition({
        top,
        left,
        minWidth: Math.max(rect.width, 180),
        maxHeight: Math.max(120, placement === 'below' ? spaceBelow : spaceAbove),
        placement,
      })
    }
    measure()
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panel.current?.contains(target)) return
      const anchor = marker.current?.parentElement
      if (anchor?.contains(target)) return
      closeRef.current()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || !panel.current) return
    const first = panel.current.querySelector<HTMLElement>('[role="menuitem"], button, [tabindex="0"]')
    first?.focus({ preventScroll: true })
  }, [open])

  return <>
    <span ref={marker} hidden aria-hidden="true" />
    {open && createPortal(<div
      ref={panel}
      className={'popover popover-' + align + (className ? ' ' + className : '') + (position?.placement === 'above' ? ' popover-above' : '')}
      role="menu"
      aria-label={label}
      style={position ? { top: position.top, left: position.left, minWidth: position.minWidth, maxHeight: position.maxHeight } : { visibility: 'hidden', top: 0, left: 0 }}
    >{children}</div>, document.body)}
  </>
}

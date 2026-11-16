import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { markAnimating, staggerDelay } from '../../lib/motion'

type PopoverProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
  label: string
  role?: 'menu' | 'listbox'
  id?: string
  /** Select-only comboboxes keep DOM focus on their trigger. */
  focusOnOpen?: boolean
}

type Position = { top: number; left: number; width: number; minWidth: number; maxWidth: number; maxHeight: number; placement: 'below' | 'above' }

type PlacementInput = {
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'width'>
  panel: { width: number; height: number }
  viewport: { left: number; top: number; width: number; height: number }
  align: 'left' | 'right'
  scale?: number
}

const GAP = 6
const EDGE = 8
/** Rows past this index all share the last delay, so a long menu stays synchronous. */
const STAGGER_LIMIT = 8

/** Measure in viewport coordinates, then convert to the portal's CSS units. */
export function getPopoverPosition({ anchor, panel, viewport, align, scale = 1 }: PlacementInput): Position {
  const maxWidth = Math.max(0, viewport.width - EDGE * 2)
  const maxHeight = Math.max(0, viewport.height - EDGE * 2)
  const width = Math.min(Math.max(panel.width, anchor.width), maxWidth)
  const spaceBelow = Math.max(0, Math.min(maxHeight, viewport.top + viewport.height - EDGE - anchor.bottom - GAP))
  const spaceAbove = Math.max(0, Math.min(maxHeight, anchor.top - GAP - viewport.top - EDGE))
  const placement = spaceBelow >= panel.height || spaceBelow >= spaceAbove ? 'below' : 'above'
  const availableHeight = placement === 'below' ? spaceBelow : spaceAbove
  const height = Math.min(panel.height, availableHeight)
  const left = Math.min(Math.max(viewport.left + EDGE, align === 'right' ? anchor.right - width : anchor.left), viewport.left + viewport.width - EDGE - width)
  const top = Math.min(Math.max(viewport.top + EDGE, placement === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height), viewport.top + viewport.height - EDGE - height)
  return {
    top: top / scale,
    left: left / scale,
    width: width / scale,
    minWidth: Math.min(anchor.width, maxWidth) / scale,
    maxWidth: maxWidth / scale,
    maxHeight: availableHeight / scale,
    placement,
  }
}

/**
 * Non-modal popover rendered in a portal on document.body with fixed
 * positioning. Portals are required because the trigger often lives inside a
 * scroll container (sidebar, document tree); an absolutely positioned menu
 * there gets clipped by that container's overflow.
 */
export default function Popover({ open, onClose, children, align = 'right', className = '', label, role = 'menu', id, focusOnOpen = true }: PopoverProps) {
  const marker = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [position, setPosition] = useState<Position | null>(null)
  const positioned = position !== null

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const measure = () => {
      const anchor = marker.current?.parentElement
      const node = panel.current
      if (!anchor || !node) return
      const rect = anchor.getBoundingClientRect()
      // An old viewport constraint must not become the next natural size.
      // Restore class-based sizing for this synchronous measurement, including
      // after a resize or a move from a cramped part of the screen.
      const previous = { width: node.style.width, minWidth: node.style.minWidth, maxWidth: node.style.maxWidth }
      node.style.width = ''
      node.style.minWidth = ''
      node.style.maxWidth = ''
      const bounds = node.getBoundingClientRect()
      const styles = getComputedStyle(node)
      const transform = styles.transform === 'none' ? null : new DOMMatrixReadOnly(styles.transform)
      const entranceScale = transform ? Math.hypot(transform.a, transform.b) : 1
      // The entrance animation also scales the panel. It must not be mistaken
      // for CSS zoom or become the panel's standing width after the animation.
      const scale = (node as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom
        || (node.offsetWidth ? bounds.width / node.offsetWidth / entranceScale : 1)
      const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth)
      const height = Math.max(node.offsetHeight, node.scrollHeight + border) * scale
      Object.assign(node.style, previous)
      const visual = window.visualViewport
      const next = getPopoverPosition({
        anchor: rect,
        panel: { width: node.offsetWidth * scale, height },
        viewport: { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0, width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight },
        align,
        scale,
      })
      setPosition((current) => current && Object.keys(next).every((key) => current[key as keyof Position] === next[key as keyof Position]) ? current : next)
    }
    measure()
    let frame = requestAnimationFrame(measure)
    const scheduleMeasure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(scheduleMeasure)
    if (marker.current?.parentElement) observer.observe(marker.current.parentElement)
    if (panel.current) observer.observe(panel.current)
    if (panel.current?.firstElementChild) observer.observe(panel.current.firstElementChild)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
    }
  }, [open, align, children])

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
    if (!open || !positioned || !panel.current || !focusOnOpen) return
    const first = panel.current.querySelector<HTMLElement>('[role="menuitem"], button, [tabindex="0"]')
    first?.focus({ preventScroll: true })
  }, [open, positioned, focusOnOpen])

  // Stagger lives on the rows, not on a wrapper: the menu itself slides in as
  // one surface while its rows settle 20ms apart, like a UIKit contextual menu.
  // Layout effect, so the class lands before the first paint and the rows never
  // flash fully opaque for a frame before animating.
  useLayoutEffect(() => {
    if (!open) return
    const node = panel.current
    if (!node) return
    const rows = Array.from(node.querySelectorAll<HTMLElement>('.menu-item, .tb-menu-item, [role="menuitem"], [role="option"]'))
    rows.forEach((row, index) => {
      if (index >= STAGGER_LIMIT) return
      row.style.animationDelay = staggerDelay(index, 20, 140) + 'ms'
      row.classList.add('popover-item-enter')
    })
    // Promote the panel only while it is arriving. A standing will-change on a
    // menu would keep a layer alive for every popover the page has ever opened.
    return markAnimating(node)
  }, [open])

  return <>
    <span ref={marker} hidden aria-hidden="true" />
    {open && createPortal(<div
      ref={panel}
      className={'popover popover-' + align + ' popover-' + (position?.placement ?? 'below') + (className ? ' ' + className : '')}
      role={role}
      id={id}
      aria-label={label}
      style={position ? { top: position.top, left: position.left, width: position.width, minWidth: position.minWidth, maxWidth: position.maxWidth, maxHeight: position.maxHeight } : { visibility: 'hidden', top: 0, left: 0 }}
    >{children}</div>, document.body)}
  </>
}

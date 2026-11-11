import type { CSSProperties, ReactNode } from 'react'
import { staggerStyle } from '../../lib/motion'

/**
 * Staggered entry props for page-level lists.
 *
 * The delay is a CSS variable read by .stagger in styles/motion.css, so the
 * step and the curve stay owned by the motion layer instead of drifting per
 * screen. Indexes past the cap reuse the last delay: the tail of a long list
 * should arrive together rather than turn the page into a slow cascade.
 */
const MAX_STAGGERED_INDEX = 10

/**
 * Props to spread onto an existing element.
 *
 * Spreading keeps the element's own tag and role, which matters where the page
 * CSS targets direct children (.command-list > button) or :last-child borders.
 * The entry animation is worth no extra wrapper element for a list this dense.
 */
export function staggerItemProps(index: number, className = '', style?: CSSProperties): { className: string; style: CSSProperties } {
  const capped = Math.min(Math.max(index, 0), MAX_STAGGERED_INDEX)
  return {
    className: className ? 'stagger ' + className : 'stagger',
    style: style ? { ...staggerStyle(capped), ...style } : staggerStyle(capped),
  }
}

/** Wrapper for lists whose markup can tolerate an extra block element. */
export function StaggerItem({ index, className, style, children }: { index: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const props = staggerItemProps(index, className, style)
  return <div className={props.className} style={props.style}>{children}</div>
}

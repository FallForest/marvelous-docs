/**
 * Motion contract shared by every animated surface.
 *
 * CSS owns the animation itself (styles/motion.css); this module owns the parts
 * JavaScript has to agree with CSS about:
 *
 *   - duration/easing names, so a React timer and a CSS transition cannot drift
 *   - spring presets, so a JS-driven spring matches the CSS curve
 *   - the reduced-motion check, so JS never animates when the user asked not to
 *
 * Rule of thumb: if a value here has a CSS twin, the CSS twin is authoritative
 * and this number only mirrors it. Change both, or change tokens.css and let
 * these read from it.
 */

import type { CSSProperties } from 'react'

/** Milliseconds, mirroring --duration-* in styles/tokens.css. */
export const DURATION = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 320,
  lazy: 420,
} as const

export type DurationName = keyof typeof DURATION

/**
 * Spring presets, sampled from a damped harmonic oscillator.
 *
 * `response` is the period in seconds, `damping` the damping ratio. 1 means
 * critically damped (no overshoot); anything below 1 overshoots. These are the
 * same numbers the CSS --ease-spring-* curves were generated from, so a CSS
 * animation and a requestAnimationFrame animation feel identical.
 */
export const SPRING = {
  snappy: { response: 0.28, damping: 0.86 },
  bouncy: { response: 0.52, damping: 0.66 },
  gentle: { response: 0.62, damping: 0.95 },
} as const

export type SpringName = keyof typeof SPRING

/** True when the operating system asked for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Per-item delay for a staggered list.
 *
 * CSS reads the same number from --i, so a list only needs to set the index and
 * pick up .stagger; this helper exists for the cases where React has to know
 * the delay (a timer, a focus move) rather than the animation.
 */
export function staggerDelay(index: number, step = 28, max = 280): number {
  return Math.min(index * step, max)
}

/**
 * Inline style that drives .stagger without a per-item class name.
 *
 * Typed as React.CSSProperties with the custom property asserted, because
 * CSSProperties has no index signature for `--*` keys and spreading a loose
 * `Record<string, number>` into `style` would erase the checking on every
 * other property in the same object.
 */
export function staggerStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties
}

/** Damped spring position at time t (seconds), normalised to 0..1. */
export function springValue(t: number, { response, damping }: { response: number; damping: number }): number {
  const w0 = (2 * Math.PI) / response
  const zeta = damping
  const wd = w0 * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
}

/**
 * Reference type for the View Transitions API, which is not in TypeScript's
 * DOM lib yet. Only the surface this module calls is described.
 */
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void> }
}

/**
 * Runs a React state update inside a browser view transition when possible.
 *
 * The whole cross-fade is skipped when the user asked for reduced motion: the
 * update still happens, just without the animation. Browsers without the API
 * (and any environment where the call throws) fall back to a plain update, so
 * this can wrap every navigation without a feature-detection branch at the
 * call site.
 */
export function withViewTransition(update: () => void): void {
  const target = typeof document === 'undefined' ? null : (document as ViewTransitionDocument)
  if (!target?.startViewTransition || prefersReducedMotion()) { update(); return }

  const root = document.documentElement
  // Suppression has to cover the whole transition, not just the synchronous
  // update. startViewTransition() runs its callback immediately, but the new
  // DOM is not painted until the snapshot phase ends — measured at ~300ms here,
  // long after a double requestAnimationFrame would have cleared the flag. The
  // swapped-in page then replayed its entrance on top of the cross-fade, which
  // is the flash at the end of the animation.
  root.setAttribute('data-vt-swapping', '')
  const release = () => root.removeAttribute('data-vt-swapping')

  try {
    const transition = target.startViewTransition(() => update())
    transition.finished.then(release, release)
  } catch {
    // A browser that reports the API but throws (or a page without a transition)
    // still has to perform the update.
    release()
    update()
    return
  }
  // Belt and braces: a transition interrupted by another one never resolves its
  // finished promise, and a flag left behind would mute every later entrance.
  window.setTimeout(release, 2000)
}/**
 * Adds the compositing hint for the duration of one animation, then removes it.
 *
 * A permanent `will-change` keeps an element on its own layer forever, which for
 * chrome that is always mounted means a layer per surface and a rendering mode
 * that can differ from its idle state by a subpixel — visible as a flash when
 * the animation ends. Promoting only while the animation runs gets the same
 * smoothness without the standing cost.
 *
 * Returns a disposer, so a caller can cancel the listener when it unmounts
 * mid-animation.
 */
export function markAnimating(element: Element | null): () => void {
  if (!element || prefersReducedMotion()) return () => undefined
  const node = element as HTMLElement
  node.classList.add('is-animating')
  let frame = 0
  const done = (event: Event) => {
    if (event.target !== node) return
    node.classList.remove('is-animating')
    node.removeEventListener('animationend', done)
    node.removeEventListener('animationcancel', done)
    if (frame) cancelAnimationFrame(frame)
  }
  node.addEventListener('animationend', done)
  node.addEventListener('animationcancel', done)
  // A CSS animation is cancelled rather than ended when the element is replaced;
  // this is the belt-and-braces path for a component that unmounts mid-run.
  frame = requestAnimationFrame(() => {
    if (!node.getAnimations().some((animation) => animation.playState === 'running')) node.classList.remove('is-animating')
  })
  return () => {
    node.classList.remove('is-animating')
    node.removeEventListener('animationend', done)
    node.removeEventListener('animationcancel', done)
    if (frame) cancelAnimationFrame(frame)
  }
}

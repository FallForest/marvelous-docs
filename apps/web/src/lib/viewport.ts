/**
 * The part of the window the user can actually see.
 *
 * On a phone the software keyboard does not resize the layout viewport: `innerHeight`
 * keeps its value and a panel positioned against it lands underneath the keyboard.
 * `visualViewport` is the rectangle that shrinks. The fallbacks keep desktop and
 * older browsers on the values they already had, so this is additive.
 */
export type VisualViewportRect = { left: number; top: number; width: number; height: number }

export function visualViewportRect(): VisualViewportRect {
  const visual = typeof window === 'undefined' ? null : window.visualViewport
  if (!visual) {
    return {
      left: 0,
      top: 0,
      width: typeof window === 'undefined' ? 0 : window.innerWidth,
      height: typeof window === 'undefined' ? 0 : window.innerHeight,
    }
  }
  return { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
}

/** True when the keyboard or a pinch has changed what is visible. */
export function visualViewportDiffersFromLayout(): boolean {
  if (typeof window === 'undefined' || !window.visualViewport) return false
  return window.visualViewport.height !== window.innerHeight || window.visualViewport.offsetTop !== 0
}

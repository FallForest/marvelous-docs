/**
 * Focus return: where focus goes when an overlay closes.
 *
 * CONTRACTS §4 says opening an overlay records the element that had focus and
 * closing it returns focus there, or to the editor when the recorded element is
 * gone. `document.body` is never an acceptable resting place.
 *
 * Why this module exists instead of a line in each component: every overlay in
 * the app hits the same failure. The panel is portalled to <body>; when it
 * unmounts, the browser moves focus to the element that was focused *inside* the
 * panel — which no longer exists — and focus silently lands on <body>. That is
 * one bug with one cause, so it gets one implementation:
 *
 *   record()  capture document.activeElement when the surface opens
 *   restore() decide, then focus
 *
 * The decision is a pure function (`chooseFocusReturn`) so it can be unit
 * tested without a DOM; everything below it is the thin adapter. Nothing here
 * imports React: styles and components may use it, and `lib` stays framework
 * free.
 *
 * What only a browser can prove is listed in test/focus-return.test.ts.
 */

/**
 * The element an overlay falls back to when its own node is gone.
 *
 * Ordered most-specific first: the editing host is the `.tiptap-content`
 * element itself (editorProps puts that class on the ProseMirror node), but a
 * wrapper that carries the class around the host is also acceptable, so the
 * selector falls back to it rather than reporting "no editor on this page".
 */
const EDITOR_SELECTORS = [
  '.tiptap-content.ProseMirror',
  '.ProseMirror[contenteditable="true"]',
  '.tiptap-content[contenteditable="true"]',
  '.tiptap-content',
]

/** One candidate in the decision, reduced to the two facts that matter. */
export type FocusCandidate = {
  /** The node, or null for "nowhere" (body, documentElement, nothing focused). */
  node: Element | null
  /** Connected, rendered, visible, not inert, not disabled. */
  usable: boolean
}

export type FocusReturnChoice = 'recorded' | 'fallback' | null

export type FocusReturnInput = {
  recorded: FocusCandidate
  /** document.activeElement right now, reduced the same way. */
  current: FocusCandidate
  fallback: FocusCandidate
  /** True when `current` sits inside the surface that is being removed. */
  currentInsideOverlay: boolean
}

/**
 * Decide where focus goes. Pure: no DOM, no React, no timers.
 *
 * Order matters, and each step is a bug someone can reintroduce:
 *
 *   1. Focus is on a real element outside the closing surface, and it is not the
 *      element we recorded → the writer moved there on purpose (clicked a row
 *      that focuses the editor, tabbed into a field). Restoring would steal it,
 *      and for the editor that means stealing a caret. Return null and do
 *      nothing.
 *   2. The recorded element is still usable → that is where the writer was, so
 *      that is where focus goes back. Most closes end here.
 *   3. The recorded element is gone or detached (the menu row that opened a
 *      dialog was itself deleted, the trigger was conditionally unmounted) →
 *      the caller-supplied fallback, normally the editor.
 *   4. Nothing usable → null. Focusing nothing is honest; focusing <body> is not
 *      a resting place, it is the absence of one.
 *
 * A null `current.node` (focus on body) deliberately falls through to 2 and 3:
 * "focus is nowhere" is exactly the state a restore exists to repair.
 */
export function chooseFocusReturn(input: FocusReturnInput): FocusReturnChoice {
  const { recorded, current, fallback, currentInsideOverlay } = input

  if (current.node && current.node !== recorded.node && !currentInsideOverlay) return null
  if (recorded.node && recorded.usable) return 'recorded'
  if (fallback.node && fallback.usable) return 'fallback'
  return null
}

/** True when the platform will let focus land on this node and paint it. */
function isUsable(node: Element | null): boolean {
  if (!node || !node.isConnected) return false
  const element = node as HTMLElement
  if (element.hasAttribute('disabled')) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  // A surface inside an inert subtree cannot take focus; asking would leave
  // focus on body, which is the state this module exists to avoid.
  if (element.closest('[inert]')) return false
  const check = (element as HTMLElement & { checkVisibility?: (options?: Record<string, boolean>) => boolean }).checkVisibility
  if (typeof check === 'function') {
    // `visibilityProperty` matters here: a collapsed menu section keeps its box
    // but sets visibility:hidden, and focus() on it is a silent no-op.
    if (!check.call(element, { visibilityProperty: true, checkVisibilityCSS: true })) return false
    return true
  }
  // No checkVisibility (older engines, jsdom): a displayed box, or a fixed one.
  if (element.offsetParent !== null) return true
  return element.isConnected && typeof getComputedStyle === 'function' && getComputedStyle(element).position === 'fixed'
}

/** activeElement, with "nowhere" normalised to null. */
function currentFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const node = document.activeElement as HTMLElement | null
  if (!node || node === document.body || node === document.documentElement) return null
  return node
}

/**
 * The editor surface on this page, if there is one.
 *
 * CONTRACTS §4 names the editor as the fallback because it is where the writer
 * was working. Resolving it by selector rather than by prop means the overlays
 * in files this batch does not own (the toolbar menus, the tree overflow menu)
 * get the same fallback without a call-site change.
 */
export function resolveEditorSurface(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  for (const selector of EDITOR_SELECTORS) {
    const node = document.querySelector<HTMLElement>(selector)
    if (node && node.isConnected) return node
  }
  return null
}

/**
 * Would focusing `target` throw away a selection the writer made elsewhere?
 *
 * A live non-collapsed selection whose anchor is outside the target is the
 * writer highlighting text somewhere else — most often inside the editor while
 * an overlay holds DOM focus. Focusing the target would collapse it. There is
 * no way to ask the browser "may I focus without touching the selection", so
 * the honest answer is to not focus.
 */
function selectionWouldBeStolen(target: HTMLElement): boolean {
  if (typeof document === 'undefined' || typeof document.getSelection !== 'function') return false
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  return !target.contains(selection.getRangeAt(0).commonAncestorContainer)
}

/**
 * Focus without scrolling and without disturbing a caret.
 *
 * The contenteditable case is the delicate one, and it is handled by *not*
 * handling it:
 *
 *   - the editor's selection lives in ProseMirror's `state.selection`, not in the
 *     DOM, so `element.focus()` cannot move it and cannot dispatch a
 *     transaction. This deliberately calls `HTMLElement.focus`, never
 *     `editor.commands.focus()`, because the latter *is* a selection command.
 *   - a composition cannot be in flight on `target` at this point: an IME
 *     composition requires the editing host to hold DOM focus, and the only way
 *     to reach this function with the editor as the target is for focus to be
 *     somewhere else. So no `compositionstart`/`compositionend` pair can be
 *     open, and focusing cannot abort one.
 *   - an already-focused target is left alone entirely: re-focusing is where a
 *     stray focus event, a `:focus-within` repaint or a selection reset would
 *     come from, and it buys nothing.
 */
function focusQuietly(target: HTMLElement): boolean {
  if (typeof document !== 'undefined' && document.activeElement === target) return true
  if (selectionWouldBeStolen(target)) return false
  try {
    target.focus({ preventScroll: true })
  } catch {
    // Safari < 15 throws on the options object rather than ignoring it.
    target.focus()
  }
  return true
}

export type FocusReturnController = {
  /**
   * Capture the element that has focus now. Call once, as the surface opens —
   * before the surface commits, so an `autoFocus` child cannot make the
   * recorded element be the surface's own first button.
   */
  record: () => void
  /**
   * Hand focus back. Safe to call when nothing was recorded, which is the
   * "closed on first mount" case: without the armed flag the editor fallback
   * would fire on every popover that never opened and drag focus into the
   * document.
   *
   * `overlay` is the surface being removed, so focus that is *inside* it counts
   * as destroyed rather than as a deliberate destination. `fallback` overrides
   * the editor when the caller knows better.
   */
  restore: (options?: { overlay?: Element | null; fallback?: HTMLElement | null }) => HTMLElement | null
}

export function createFocusReturn(): FocusReturnController {
  let recorded: HTMLElement | null = null
  /** True between record() and restore(). */
  let armed = false

  return {
    record() {
      recorded = currentFocus()
      armed = true
    },
    restore({ overlay = null, fallback = null } = {}) {
      if (!armed) return null
      armed = false
      const active = currentFocus()
      const fallbackNode = fallback && isUsable(fallback) ? fallback : resolveEditorSurface()
      const choice = chooseFocusReturn({
        recorded: { node: recorded, usable: isUsable(recorded) },
        current: { node: active, usable: active !== null },
        fallback: { node: fallbackNode, usable: isUsable(fallbackNode) },
        currentInsideOverlay: Boolean(overlay && active && overlay.contains(active)),
      })
      const target = choice === 'recorded' ? recorded : choice === 'fallback' ? fallbackNode : null
      recorded = null
      if (!target) return null
      return focusQuietly(target) ? target : null
    },
  }
}

/**
 * Guard for keyboard handlers that must not run while an input method is
 * composing.
 *
 * A Chinese (and Japanese/Korean) writer types `/biaoti`, sees a candidate
 * window, and presses Enter to accept the candidate. The browser dispatches that
 * Enter to the document with `isComposing: true`, and a handler that only
 * listens for `event.key === 'Enter'` cannot tell it apart from "insert this
 * command" — the slash menu inserted a block and the candidate the writer wanted
 * was thrown away.
 *
 * `isComposing` is the honest signal, but it is not universal:
 *
 *   - Safari historically reported `keyCode: 229` on the Enter that confirms a
 *     candidate without setting `isComposing`;
 *   - some IMEs dispatch `compositionend` *before* the final `keydown`, so the
 *     flag is already false by the time the key arrives.
 *
 * The second case is why there is a timestamp rather than just a boolean. Writing
 * text out of the composition window is a follow-up key event within a few
 * milliseconds; `COMPOSITION_GRACE` is deliberately short (a human cannot press a
 * deliberate Enter and have it land inside it) and it is only consulted for keys
 * that are ambiguous — never for ordinary character input.
 */

/** How long after `compositionend` a stray confirm key is still treated as IME. */
export const COMPOSITION_GRACE = 60

export type CompositionLikeEvent = {
  isComposing?: boolean
  keyCode?: number
  key?: string
}

/** True when this event belongs to an input method rather than to the writer. */
export function isComposingEvent(event: CompositionLikeEvent): boolean {
  if (event.isComposing) return true
  // The legacy Safari/older-WebKit signal for "this key is consumed by the IME".
  if (event.keyCode === 229) return true
  return false
}

/**
 * A composition tracker for one editable surface.
 *
 * Handlers ask `blocked(event)` instead of reading `isComposing` themselves, so
 * the grace window and the tracked boolean live in one place and every caller
 * gets the same answer.
 */
export function compositionGuard() {
  let composing = false
  let endedAt = 0

  return {
    start() {
      composing = true
    },
    end() {
      composing = false
      endedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    },
    /** The composition is over, but a confirm key may still be in flight. */
    isSettling() {
      const now = typeof performance === 'undefined' ? Date.now() : performance.now()
      return now - endedAt < COMPOSITION_GRACE
    },
    /**
     * True when the handler must stand down.
     *
     * Only keys an IME uses to commit or cancel are held; a writer who is still
     * inside the candidate window and presses a letter must not be blocked,
     * because that letter belongs to the composition and the editor sees it as
     * part of the text anyway.
     */
    blocked(event: CompositionLikeEvent): boolean {
      if (isComposingEvent(event)) return true
      const key = event.key
      if (key === 'Enter' || key === 'Escape' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab') {
        return composing || this.isSettling()
      }
      return composing
    },
  }
}

export type CompositionGuard = ReturnType<typeof compositionGuard>

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimationEvent } from 'react'
import { DURATION, prefersReducedMotion } from '../lib/motion'

/**
 * Keyframes name that marks the end of a modal's exit animation.
 *
 * The hook listens for this exact name (styles/surfaces.css owns the
 * keyframes), so an animation bubbling up from a child — a staggered row, a
 * tab cross-fade — can never unmount the dialog halfway through its exit.
 */
export const LEAVE_ANIMATION = 'modal-leave'

/** Hard stop for the exit timer; the animation is 140ms, the slack covers a dropped frame. */
const EXIT_FALLBACK = DURATION.fast + 100

export type Presence = {
  closing: boolean
  requestClose: () => void
  onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void
}

/**
 * Keeps a modal mounted for one exit frame instead of unmounting on close.
 *
 * The owner renders until requestClose() resolves: the flag flips, CSS plays
 * the 140ms exit, and only then does the parent get its onClose. Reduced motion
 * skips straight to onClose because there is no travel to finish.
 */
export function usePresence(onClose: () => void): Presence {
  const [closing, setClosing] = useState(false)
  const settled = useRef(false)
  const timer = useRef<number | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const settle = useCallback(() => {
    if (settled.current) return
    settled.current = true
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    closeRef.current()
  }, [])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const requestClose = useCallback(() => {
    if (settled.current) return
    if (prefersReducedMotion()) {
      settle()
      return
    }
    setClosing(true)
    // Timer is a fallback only; animationend normally wins and clears it.
    if (timer.current === null) timer.current = window.setTimeout(settle, EXIT_FALLBACK)
  }, [settle])

  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.animationName !== LEAVE_ANIMATION) return
    settle()
  }, [settle])

  return { closing, requestClose, onAnimationEnd }
}
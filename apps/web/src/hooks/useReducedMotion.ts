import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'

/**
 * Tracks prefers-reduced-motion and keeps up with live changes.
 *
 * Components use this when they would otherwise animate in JavaScript (a
 * measured transform, a scroll, a delayed state flip). CSS-only animation does
 * not need the hook: styles/motion.css already collapses travel to a fade.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return reduced
}

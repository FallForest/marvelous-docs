import { useCallback, useEffect, useState } from 'react'
import { applyTheme, readStoredTheme, storeTheme, themeById } from '../lib/theme'
import type { Theme } from '../lib/theme'

/**
 * The active theme, and the one action that changes it.
 *
 * The boot value is read from the same key the inline script in index.html uses,
 * so React starts on the palette the page is already painted with — reading it
 * twice is what keeps the switcher from showing "纸本" over a dark page for one
 * frame.
 *
 * Applying is an attribute write on <html>, not state the app renders: the
 * palette lives entirely in CSS, so nothing re-renders and no component needs to
 * know a theme exists.
 */
export function useTheme() {
  const [themeId, setThemeId] = useState(() => readStoredTheme())

  useEffect(() => {
    // The inline script has already painted this, so this only matters when the
    // module is loaded without index.html (tests, a hosted bundle).
    applyTheme(themeId)
  }, [themeId])

  const setTheme = useCallback((id: string) => {
    const theme: Theme = themeById(id)
    setThemeId(theme.id)
    storeTheme(theme.id)
    applyTheme(theme.id)
  }, [])

  return { themeId, theme: themeById(themeId), setTheme }
}

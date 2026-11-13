import { useCallback, useEffect, useState } from 'react'
import { applyTheme, readStoredTheme, storeTheme, themeById, THEME_STORAGE_KEY } from '../lib/theme'
import type { Theme } from '../lib/theme'

/**
 * The active theme, and the one action that changes it.
 *
 * The boot value is read from the same key the inline script in index.html uses,
 * so React starts on the palette the page is already painted with — reading it
 * twice is what keeps the switcher from showing "纸本" over a dark page for one
 * frame.
 *
 * Applying writes one attribute on <html>. React updates the selected menu row,
 * while the same mounted editor keeps its content, selection and undo history.
 */
export function useTheme() {
  const [themeId, setThemeId] = useState(() => readStoredTheme())

  useEffect(() => {
    // The inline script has already painted this, so this only matters when the
    // module is loaded without index.html (tests, a hosted bundle).
    applyTheme(themeId)
  }, [themeId])

  useEffect(() => {
    // A second tab can choose an appearance or clear the stored preference.
    // Reuse the same validation/fallback as first paint, and ignore sessionStorage.
    const syncTheme = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return
      } catch { return }
      const id = readStoredTheme()
      applyTheme(id)
      setThemeId(id)
    }
    window.addEventListener('storage', syncTheme)
    return () => window.removeEventListener('storage', syncTheme)
  }, [])

  const setTheme = useCallback((id: string) => {
    const theme: Theme = themeById(id)
    setThemeId(theme.id)
    storeTheme(theme.id)
    applyTheme(theme.id)
  }, [])

  return { themeId, theme: themeById(themeId), setTheme }
}

/**
 * Copies text to the clipboard.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
 * The app is commonly served over plain HTTP on an IP address, where the API is
 * undefined; there the old `execCommand('copy')` path still works. This helper
 * tries the modern API first and falls back, returning whether the text really
 * landed on the clipboard so callers can report success honestly instead of
 * showing "已复制" when nothing happened.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }

  // Legacy path: a hidden textarea plus execCommand. Works in non-secure
  // contexts, which is why it is the primary route over plain HTTP.
  try {
    const area = document.createElement('textarea')
    area.value = text
    // Keep it off-screen without moving the page or showing a scrollbar.
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    const selection = document.getSelection()
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    area.select()
    area.setSelectionRange(0, area.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    return ok
  } catch {
    return false
  }
}

/**
 * Browser-side file delivery for document exports.
 *
 * Kept free of React so the export path stays unit-testable and every caller
 * (menu, keyboard shortcut, editor toolbar) shares one implementation.
 */

export const EXPORT_MIME: Record<'markdown' | 'html' | 'json', { ext: string; type: string }> = {
  markdown: { ext: 'md', type: 'text/markdown;charset=utf-8' },
  html: { ext: 'html', type: 'text/html;charset=utf-8' },
  json: { ext: 'json', type: 'application/json' },
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printHtmlDocument(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(frame)
  const fallback = () => {
    frame.remove()
    const popup = window.open('', '_blank')
    if (!popup) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '浏览器阻止了打印窗口，请允许弹窗后重试' }))
      return
    }
    popup.document.write(html)
    popup.document.close()
    popup.focus()
    popup.print()
  }
  const frameDocument = frame.contentDocument
  if (!frameDocument) { fallback(); return }
  try {
    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()
  } catch {
    fallback()
    return
  }
  window.setTimeout(() => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      fallback()
      return
    }
    window.setTimeout(() => frame.remove(), 4000)
  }, 150)
}

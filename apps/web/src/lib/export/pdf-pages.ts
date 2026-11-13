/**
 * Page geometry for PDF export.
 *
 * Kept as pure functions so the pagination arithmetic — the part that silently
 * produces a blank last page, a cut line through a table, or a document that
 * runs off the right edge — is unit-testable without a canvas or a browser.
 *
 * Units: the canvas is measured in device pixels (CSS pixels multiplied by the
 * render scale), the page in PostScript points. A4 is 595.28 × 841.89 pt, which
 * is 210 × 297 mm, and 1 pt = 1/72 inch.
 */

export const A4 = { width: 595.28, height: 841.89 } as const

/** Page margins in points: generous sides, extra room at the foot for the folio. */
export const PDF_MARGIN = { top: 48, right: 44, bottom: 56, left: 44 } as const

/** Width available for content, in points. */
export const PDF_CONTENT_WIDTH = A4.width - PDF_MARGIN.left - PDF_MARGIN.right

/** Height available for content on one page, in points. */
export const PDF_CONTENT_HEIGHT = A4.height - PDF_MARGIN.top - PDF_MARGIN.bottom

export type Slice = {
  /** Source y offset in canvas pixels. */
  y: number
  /** Slice height in canvas pixels (the last slice is shorter). */
  height: number
  /** Destination height in points. */
  heightPt: number
}

export type SliceLayout = {
  /** Points per canvas pixel, so a slice keeps the rendered aspect ratio. */
  ratio: number
  /** How many canvas pixels fit on one page. */
  sliceHeightPx: number
  slices: Slice[]
}

/**
 * Cuts a rendered canvas into page-sized slices.
 *
 * The image is always scaled to the content width — a document rendered at a
 * narrower width is widened rather than left with an empty right margin, which
 * is what a print dialog does at 100% but a naive exporter forgets.
 */
export function slicePages(canvasWidth: number, canvasHeight: number): SliceLayout {
  const safeWidth = Math.max(1, canvasWidth)
  const safeHeight = Math.max(0, canvasHeight)
  const ratio = PDF_CONTENT_WIDTH / safeWidth
  const sliceHeightPx = Math.max(1, Math.floor(PDF_CONTENT_HEIGHT / ratio))
  const slices: Slice[] = []
  for (let y = 0; y < safeHeight; y += sliceHeightPx) {
    const height = Math.min(sliceHeightPx, safeHeight - y)
    slices.push({ y, height, heightPt: height * ratio })
  }
  // A document of zero height still produces one (blank) page, so the download
  // opens instead of failing with an empty PDF.
  if (!slices.length) slices.push({ y: 0, height: Math.max(1, sliceHeightPx), heightPt: PDF_CONTENT_HEIGHT })
  return { ratio, sliceHeightPx, slices }
}

/** `3 / 7`, centred under the content. */
export function folioLabel(page: number, total: number): string {
  return page + ' / ' + total
}

/** Turns a title into a download-safe file name ending in `.pdf`. */
export function pdfFilename(title: string): string {
  const clean = (title || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (clean || 'document') + '.pdf'
}

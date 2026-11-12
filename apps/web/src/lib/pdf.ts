import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { parseExportHtml, scopeCss } from './export-css'
import { A4, folioLabel, PDF_MARGIN, slicePages } from './pdf-pages'

/**
 * HTML → PDF, entirely in the browser.
 *
 * Why raster: a real text PDF needs a font that covers Chinese, and jsPDF only
 * ships Latin faces. Embedding a CJK face would add several megabytes to the
 * bundle for one menu item, and drawing every block by hand would still not
 * reproduce tables, syntax-highlighted code and inline marks the way the editor
 * renders them. Rasterising the export HTML the server already produces — the
 * same document the print button sends to the printer — keeps the PDF identical
 * to the app at the cost of selectable text.
 *
 * Why in-document and not an iframe: html2canvas clones the target into its own
 * frame to rasterise it. A source inside a cross-document iframe produces a
 * blank clone, and copying the iframe's markup out of it on every export is the
 * same work with a layout round trip attached. The export is therefore injected
 * into the live document under a scoped class, rendered, and removed.
 *
 * The page arithmetic lives in pdf-pages.ts and the stylesheet rewriting in
 * export-css.ts, both pure and unit-tested. This module only owns the browser
 * choreography.
 */

const RENDER_SCALE = 2
/** A4 at 96 CSS px/inch. The export renders at this width, so 1 CSS px ≈ 1 pt / 0.72. */
const RENDER_WIDTH_PX = 794
const EXPORT_ROOT_CLASS = 'mdoc-export-root'

/** Resolves when every image inside `root` has settled, or after `timeout`. */
async function settleImages(root: ParentNode, timeout: number): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (!images.length) return
  await Promise.race([
    Promise.all(images.map((image) => (image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })))),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeout)),
  ])
}

/** Waits for webfonts so the raster does not fall back to a default face. */
async function settleFonts(timeout: number): Promise<void> {
  const fonts = document.fonts
  if (!fonts?.ready) return
  await Promise.race([
    fonts.ready.catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeout)),
  ])
}

/** One animation frame, so a style change has been laid out before measuring. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export type PdfOptions = {
  /** Receives 0..1 as the work proceeds. */
  onProgress?: (fraction: number) => void
  /** How long to wait for fonts and images before rendering anyway. */
  prepareTimeout?: number
}

export type RenderedExport = { canvas: HTMLCanvasElement; title: string }

/**
 * Lays the export HTML out in the live document and rasterises it.
 *
 * Split out from {@link htmlToPdf} because the canvas is the thing worth
 * checking: it is what gets sliced, so a check that the document survives
 * layout (fonts loaded, images settled, tables and code at full width) belongs
 * here rather than on the finished PDF.
 */
export async function renderExportCanvas(html: string, prepareTimeout = 15000): Promise<RenderedExport> {
  const parts = parseExportHtml(html)
  if (!parts) throw new Error('导出内容为空，无法生成 PDF')

  const host = document.createElement('div')
  host.className = EXPORT_ROOT_CLASS
  host.setAttribute('aria-hidden', 'true')
  // Off-screen rather than `display:none`: html2canvas measures the element, and
  // a hidden element has no layout to measure. Fixed + translated keeps it out
  // of the scroll box so it cannot shift the page while it is open.
  host.style.cssText = 'position:fixed;top:0;left:-20000px;width:' + RENDER_WIDTH_PX + 'px;background:#fff;color:#1f2329;pointer-events:none;z-index:-1'

  const style = document.createElement('style')
  // The export's own rules, scoped so they cannot touch the running app.
  style.textContent = scopeCss(parts.css, '.' + EXPORT_ROOT_CLASS)

  const article = document.createElement('article')
  article.innerHTML = parts.html

  host.appendChild(article)
  document.body.append(style, host)

  try {
    await settleFonts(prepareTimeout)
    await settleImages(host, prepareTimeout)
    // Images that failed to load must not leave a stretched placeholder band in
    // the PDF; the alt text is the honest rendering of a broken source.
    host.querySelectorAll('img').forEach((image) => {
      if (image.complete && image.naturalWidth === 0) image.style.display = 'none'
    })
    await nextFrame()

    const canvas = await html2canvas(host, {
      scale: RENDER_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: RENDER_WIDTH_PX,
      windowWidth: RENDER_WIDTH_PX,
      height: Math.max(1, host.scrollHeight),
    })
    return { canvas, title: parts.title }
  } finally {
    host.remove()
    style.remove()
  }
}

/**
 * Renders the server's `format=html` export into a PDF blob.
 *
 * Throws when the export has no `<article>`; callers surface the message and
 * leave the print path as the fallback.
 */
export async function htmlToPdf(html: string, options: PdfOptions = {}): Promise<Blob> {
  const { onProgress, prepareTimeout } = options
  onProgress?.(0.05)
  const { canvas, title } = await renderExportCanvas(html, prepareTimeout)
  onProgress?.(0.6)

  const { slices } = slicePages(canvas.width, canvas.height)
  const pageWidth = Math.max(1, Math.round(canvas.width))
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
  doc.setProperties({ title: title || 'Document', creator: 'Marvelous Docs' })

  // One scratch canvas, reused per page: peak memory stays at two canvases
  // instead of one per page of a long document.
  const sliceCanvas = document.createElement('canvas')
  const context = sliceCanvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建绘图上下文')

  slices.forEach((slice, index) => {
    const height = Math.max(1, Math.round(slice.height))
    sliceCanvas.width = pageWidth
    sliceCanvas.height = height
    context.clearRect(0, 0, pageWidth, height)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pageWidth, height)
    context.drawImage(canvas, 0, Math.round(slice.y), pageWidth, height, 0, 0, pageWidth, height)

    if (index > 0) doc.addPage('a4', 'portrait')
    doc.addImage(
      sliceCanvas.toDataURL('image/jpeg', 0.92),
      'JPEG',
      PDF_MARGIN.left,
      PDF_MARGIN.top,
      A4.width - PDF_MARGIN.left - PDF_MARGIN.right,
      slice.heightPt,
      undefined,
      'FAST',
    )
    doc.setFontSize(8)
    doc.setTextColor(140, 146, 158)
    doc.text(folioLabel(index + 1, slices.length), A4.width / 2, A4.height - PDF_MARGIN.bottom / 2, { align: 'center' })
    onProgress?.(0.6 + (0.4 * (index + 1)) / slices.length)
  })

  return doc.output('blob')
}

/** Hands a blob to the browser as a download. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

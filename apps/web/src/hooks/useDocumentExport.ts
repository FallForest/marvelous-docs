import { useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import { api } from '../lib/endpoints'
import { downloadTextFile, EXPORT_MIME, printHtmlDocument } from '../lib/export/download'
import { pdfFilename } from '../lib/export/pdf-pages'
import type { Doc, ExportTarget } from '../lib/types'

type Options = {
  token: string
  /** The open document, read through a ref so the callback stays stable. */
  activeRef: MutableRefObject<Doc | null>
  notify: (message: string) => void
  closeMenu: () => void
}

/**
 * The export menu's work: markdown/html/json download, print, and PDF.
 *
 * PDF and print share the server's `html` export — one rendering, two
 * destinations — and the rasteriser is a dynamic import, so the editor's first
 * paint never pays for jsPDF and html2canvas. It lives in a hook because the
 * progress value is real UI state, but nothing else in the shell needs to know
 * how an export is produced.
 */
export function useDocumentExport({ token, activeRef, notify, closeMenu }: Options) {
  /** 0..1 while a PDF renders; null when idle. */
  const [pdfProgress, setPdfProgress] = useState<number | null>(null)

  const exportActive = useCallback(async (format: ExportTarget) => {
    closeMenu()
    const doc = activeRef.current
    if (!doc || doc.kind === 'folder') { notify('请先打开一个文档'); return }

    if (format === 'print') {
      try {
        const result = await api.exportDocument(token, doc.id, 'html')
        printHtmlDocument(result.content)
      } catch (error) {
        notify('打印失败：' + (error as Error).message)
      }
      return
    }

    if (format === 'pdf') {
      // A text PDF with Chinese content would need a multi-megabyte font in the
      // bundle, so the browser rasterises the HTML export instead.
      setPdfProgress(0)
      try {
        const [result, pdf] = await Promise.all([
          api.exportDocument(token, doc.id, 'html'),
          import('../lib/export/pdf'),
        ])
        const blob = await pdf.htmlToPdf(result.content, {
          // An export blocks long enough to need a determinate bar, not a spinner.
          onProgress: setPdfProgress,
        })
        const filename = pdfFilename(doc.title || result.filename || 'document')
        pdf.downloadBlob(filename, blob)
        notify('已导出 ' + filename)
      } catch (error) {
        notify('PDF 导出失败：' + (error as Error).message)
      } finally {
        setPdfProgress(null)
      }
      return
    }

    try {
      const result = await api.exportDocument(token, doc.id, format)
      const filename = result.filename || (doc.title || 'document') + '.' + EXPORT_MIME[format].ext
      downloadTextFile(filename, result.content, EXPORT_MIME[format].type)
      notify('已导出 ' + filename)
    } catch (error) {
      notify('导出失败：' + (error as Error).message)
    }
  }, [token, activeRef, notify, closeMenu])

  return { pdfProgress, exportActive }
}

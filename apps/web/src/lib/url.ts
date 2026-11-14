/**
 * The document address.
 *
 * A document used to have no address at all: a reload reopened whatever the
 * bootstrap picked first, the back button did nothing, and a reader could not
 * send a link to a colleague. The id lives in `?doc=` rather than a path
 * segment because the server already answers every path with `index.html`
 * (nginx `try_files`), so a path segment buys nothing and would need a router.
 *
 * Everything here is pure string handling except `syncDocumentUrl`, so the
 * parsing rules are unit-tested without a DOM.
 */

export const DOC_PARAM = 'doc'

/** The document id named by a `location.search`, or null. */
export function readDocumentId(search: string): string | null {
  const id = new URLSearchParams(search).get(DOC_PARAM)
  return id && id.trim() ? id : null
}

/** The same href with `doc` set (or removed when null); other params survive. */
export function hrefWithDocument(href: string, docId: string | null): string {
  // A base is required to parse a relative href; the origin is never emitted
  // because only path, query and hash are rebuilt below.
  const url = new URL(href, 'http://address.invalid')
  if (docId) url.searchParams.set(DOC_PARAM, docId)
  else url.searchParams.delete(DOC_PARAM)
  return url.pathname + url.search + url.hash
}

/**
 * Points the address bar at the open document without adding a history entry.
 *
 * pushState would turn every document switch into a navigation, so "back" would
 * walk a trail of documents the reader has already left. replaceState keeps the
 * address honest and leaves "back" meaning what it meant before documents had
 * URLs. The existing history state is preserved: the shell is not the only
 * writer of `history.state`.
 */
export function syncDocumentUrl(docId: string | null): void {
  if (typeof window === 'undefined') return
  const next = hrefWithDocument(window.location.href, docId)
  const current = window.location.pathname + window.location.search + window.location.hash
  if (next === current) return
  try {
    window.history.replaceState(window.history.state, '', next)
  } catch {
    // A frame that refuses the rewrite must not take the document switch down
    // with it; the address bar is the only thing lost.
  }
}

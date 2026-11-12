/**
 * Scoping the export stylesheet.
 *
 * The server's `format=html` export is a complete standalone document with its
 * own `<style>` block full of element selectors (`body`, `article`, `h1`,
 * `table`, `pre code`, …). Two things make it unusable as-is once it is injected
 * into the running app:
 *
 *   1. `body{...}` would restyle the application itself.
 *   2. Even the element rules would leak — the app has its own `h1` and `table`
 *      styles, and whichever came last would win by accident.
 *
 * So every selector is prefixed with the export root's class, and the document
 * selectors (`html`, `body`, `article`) map onto that root. The result renders
 * inside the app's stylesheet with the export's own typography intact.
 *
 * Kept pure and here rather than inline in `pdf.ts` because it is the part that
 * is easy to get wrong and can be checked without a browser.
 */

/** Wraps each selector in `list` so it only matches inside `scope`. */
function scopeSelector(selector: string, scope: string): string {
  const trimmed = selector.trim()
  if (!trimmed) return ''
  // `html`, `body` and `article` *are* the root once injected; a descendant
  // prefix would match nothing.
  if (/^(html|body|article)$/i.test(trimmed)) return scope
  // `:root` custom properties must stay on the document or they inherit nowhere.
  if (trimmed === ':root') return ':root'
  return scope + ' ' + trimmed
}

/** Splits a selector list on commas that are not inside parentheses. */
function splitSelectors(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) { out.push(current); current = ''; continue }
    current += char
  }
  out.push(current)
  return out.map((part) => part.trim()).filter(Boolean)
}

/**
 * Scopes a stylesheet's rules under `scope`.
 *
 * At-rule blocks are kept and their inner rules are scoped recursively
 * (`@media`, `@supports`); `@font-face`, `@keyframes` and `@page` are copied
 * verbatim, because their bodies are not selectors.
 */
export function scopeCss(css: string, scope: string): string {
  const out: string[] = []
  let index = 0
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')

  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    const prelude = source.slice(index, open).trim()

    // Find the matching close brace, tracking nesting.
    let depth = 1
    let cursor = open + 1
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1
      else if (source[cursor] === '}') depth -= 1
      cursor += 1
    }
    const body = source.slice(open + 1, cursor - 1)
    index = cursor

    if (!prelude) continue
    if (prelude.startsWith('@')) {
      const name = prelude.slice(1).split(/[\s({]/)[0]!.toLowerCase()
      if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container') {
        out.push(prelude + '{' + scopeCss(body, scope) + '}')
      } else {
        // @font-face, @keyframes, @page: the body is declarations or keyframe
        // selectors, neither of which may be prefixed.
        out.push(prelude + '{' + body + '}')
      }
      continue
    }

    const selectors = splitSelectors(prelude).map((selector) => scopeSelector(selector, scope)).filter(Boolean)
    if (!selectors.length) continue
    out.push(selectors.join(',') + '{' + body + '}')
  }

  return out.join('\n')
}

export type ExportParts = { css: string; title: string; html: string }

/**
 * Splits the export document into the pieces that can be injected: the
 * stylesheet, the title, and the article markup.
 *
 * Returns null when the input has no article, so the caller can fall back to the
 * print dialog instead of rendering a blank PDF.
 */
export function parseExportHtml(html: string): ExportParts | null {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const article = document.querySelector('article')
  if (!article) return null
  const css = Array.from(document.querySelectorAll('style')).map((node) => node.textContent || '').join('\n')
  return { css, title: document.title || '', html: article.innerHTML }
}

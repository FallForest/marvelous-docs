/**
 * Renders stored Tiptap JSON to static HTML for the public share page.
 *
 * Any URL in the document is untrusted: the page is rendered anonymously and
 * injected with dangerouslySetInnerHTML, so a `javascript:` href would execute.
 * Every URL therefore goes through safeHref, which allows only http(s), mailto,
 * tel and relative references.
 *
 * This is intentionally a small, closed renderer: it only understands the node
 * types the server schema allows, and escapes every text value, so a shared
 * document cannot inject markup.
 */

/** The only URL shapes a document may contain, mirroring the server export path. */
function safeHref(value: unknown): string {
  const href = typeof value === 'string' ? value.trim() : ''
  if (!href) return ''
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|\?)/i.test(href)) return href
  // Anything with another scheme (javascript:, data:, vbscript:) is dropped.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return ''
  return href
}

export function renderDocHTML(node: Record<string, unknown> | undefined): string {
  if (!node) return '<p>（空文档）</p>'
  const type = node.type as string
  const content = ((node.content || []) as Record<string, unknown>[])
  const attrs = (node.attrs || {}) as Record<string, unknown>
  const text = (n: Record<string, unknown>): string => {
    if (n.type === 'text') {
      let t = escapeHtml(n.text as string || '')
      const marks = (n.marks || []) as Record<string, unknown>[]
      for (const m of marks) {
        if (m.type === 'bold') t = '<strong>' + t + '</strong>'
        else if (m.type === 'italic') t = '<em>' + t + '</em>'
        else if (m.type === 'underline') t = '<u>' + t + '</u>'
        else if (m.type === 'strike') t = '<s>' + t + '</s>'
        else if (m.type === 'code') t = '<code>' + t + '</code>'
        else if (m.type === 'link') {
          const href = safeHref((m.attrs as Record<string, unknown>)?.href)
          t = href
            ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer nofollow">' + t + '</a>'
            : t
        }
      }
      return t
    }
    return ((n.content || []) as Record<string, unknown>[]).map(text).join('')
  }
  const inner: string = content.map((child) => {
    if (child.type === 'text') return text(child)
    return renderDocHTML(child)
  }).join('')

  switch (type) {
    case 'doc': return (content as Record<string, unknown>[]).map((c: Record<string, unknown>) => renderDocHTML(c)).join('')
    case 'paragraph': return '<p>' + (inner || '<br>') + '</p>'
    case 'heading': return '<h' + (attrs.level || 1) + '>' + inner + '</h' + (attrs.level || 1) + '>'
    case 'codeBlock': return '<pre><code>' + escapeHtml((content as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c.text as string) || '').join('')) + '</code></pre>'
    case 'blockquote': return '<blockquote>' + inner + '</blockquote>'
    case 'bulletList': return '<ul>' + inner + '</ul>'
    case 'orderedList': return '<ol>' + inner + '</ol>'
    case 'listItem': return '<li>' + inner + '</li>'
    case 'taskList': return '<ul class="task-list">' + inner + '</ul>'
    case 'taskItem': return '<li>' + inner + '</li>'
    case 'horizontalRule': return '<hr>'
    case 'image': {
      const src = safeHref(attrs.src)
      return src ? '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(attrs.alt as string || '') + '" loading="lazy">' : ''
    }
    case 'table': return '<table>' + inner + '</table>'
    case 'tableRow': return '<tr>' + inner + '</tr>'
    case 'tableHeader': return '<th>' + inner + '</th>'
    case 'tableCell': return '<td>' + inner + '</td>'
    default: return inner
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

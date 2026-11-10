/**
 * Renders stored Tiptap JSON to static HTML for the public share page.
 *
 * This is intentionally a small, closed renderer: it only understands the node
 * types the server schema allows, and escapes every text value, so a shared
 * document cannot inject markup.
 */

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
        else if (m.type === 'link') t = '<a href="' + escapeHtml((m.attrs as Record<string, string>)?.href || '#') + '" target="_blank">' + t + '</a>'
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
    case 'image': return '<img src="' + escapeHtml(attrs.src as string || '') + '" alt="' + escapeHtml(attrs.alt as string || '') + '">'
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

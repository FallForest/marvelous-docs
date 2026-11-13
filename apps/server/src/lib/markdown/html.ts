/**
 * Tiptap JSON -> a standalone, fully escaped HTML document.
 *
 * Used for exports and printing. Styling is inlined because the result leaves
 * the app: it is opened from disk, mailed, or rasterised into a PDF by the
 * client.
 */
import { documentNodeFrom, nodeText, type TiptapNode } from './nodes.js'

/** Escapes text for HTML text and attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(value: string): string {
  const href = value.trim();
  if (!href) return '#';
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|\?)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return '#';
  return href;
}

function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : null;
}

function alignStyle(node: TiptapNode): string {
  const align = node.attrs?.textAlign;
  return align === 'center' || align === 'right' || align === 'justify' ? ' style="text-align:' + align + '"' : '';
}

function renderHtmlTextNode(node: TiptapNode): string {
  const text = node.text ?? '';
  if (!text) return '';
  const marks = node.marks ?? [];
  const has = (type: string) => marks.find(mark => mark.type === type);
  let value = escapeHtml(text);
  if (has('code')) value = '<code>' + value + '</code>';
  if (has('bold')) value = '<strong>' + value + '</strong>';
  if (has('italic')) value = '<em>' + value + '</em>';
  if (has('strike')) value = '<s>' + value + '</s>';
  if (has('underline')) value = '<u>' + value + '</u>';
  const highlight = has('highlight');
  if (highlight) {
    const color = safeColor(highlight.attrs?.color);
    value = color ? '<mark style="background-color: ' + color + '">' + value + '</mark>' : '<mark>' + value + '</mark>';
  }
  const style = has('textStyle');
  if (style) {
    const color = safeColor(style.attrs?.color);
    if (color) value = '<span style="color: ' + color + '">' + value + '</span>';
  }
  const link = has('link');
  if (link) {
    const href = escapeHtml(safeHref(String(link.attrs?.href ?? '')));
    value = '<a href="' + href + '" rel="noopener noreferrer" target="_blank">' + value + '</a>';
  }
  return value;
}

function renderHtmlInline(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map(node => {
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'text') return renderHtmlTextNode(node);
    return renderHtmlInline(node.content);
  }).join('');
}

function renderHtmlBlock(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph': {
      const inner = renderHtmlInline(node.content);
      return '<p' + alignStyle(node) + '>' + inner + '</p>';
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1) || 1));
      return '<h' + level + alignStyle(node) + '>' + renderHtmlInline(node.content) + '</h' + level + '>';
    }
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? safeHref(node.attrs.src) : '';
      if (!src) return '';
      const alt = escapeHtml(String(node.attrs?.alt ?? ''));
      return '<img src="' + escapeHtml(src) + '" alt="' + alt + '" style="max-width:100%;height:auto">';
    }
    case 'blockquote':
      return '<blockquote>' + renderHtmlBlocks(node.content ?? []) + '</blockquote>';
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const className = language ? ' class="language-' + escapeHtml(language) + '"' : '';
      return '<pre><code' + className + '>' + escapeHtml(nodeText(node)) + '</code></pre>';
    }
    case 'bulletList':
      return '<ul>' + renderHtmlBlocks(node.content ?? []) + '</ul>';
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1) || 1;
      return '<ol' + (start !== 1 ? ' start="' + start + '"' : '') + '>' + renderHtmlBlocks(node.content ?? []) + '</ol>';
    }
    case 'listItem':
      return '<li>' + renderHtmlBlocks(node.content ?? []) + '</li>';
    case 'taskList':
      return '<ul class="task-list">' + renderHtmlBlocks(node.content ?? []) + '</ul>';
    case 'taskItem': {
      const checked = node.attrs?.checked === true;
      return '<li class="task-item"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' + renderHtmlBlocks(node.content ?? []) + '</li>';
    }
    case 'horizontalRule':
      return '<hr>';
    case 'table':
      return '<table>' + renderHtmlBlocks(node.content ?? []) + '</table>';
    case 'tableRow':
      return '<tr>' + renderHtmlBlocks(node.content ?? []) + '</tr>';
    case 'tableHeader':
      return '<th>' + renderHtmlBlocks(node.content ?? []) + '</th>';
    case 'tableCell':
      return '<td>' + renderHtmlBlocks(node.content ?? []) + '</td>';
    default:
      if (typeof node.text === 'string') return escapeHtml(node.text);
      return renderHtmlBlocks(node.content ?? []);
  }
}

function renderHtmlBlocks(nodes: TiptapNode[]): string {
  return nodes.map(node => renderHtmlBlock(node)).join('');
}

export type HtmlOptions = { title?: string };

/** Renders a complete, fully escaped HTML document for printing or pasting. */
export function tiptapToHtml(docJson: unknown, options: HtmlOptions = {}): string {
  const document = documentNodeFrom(docJson);
  const title = (options.title ?? '').trim() || 'Document';
  const body = renderHtmlBlocks(document.content);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(title) + '</title>',
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1f2329;margin:0;padding:2.5rem 1.5rem;}article{max-width:46rem;margin:0 auto;}h1,h2,h3,h4,h5,h6{line-height:1.25;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #dee0e3;padding:.4rem .6rem;text-align:left;}code{background:#f2f3f5;border-radius:4px;padding:.1rem .3rem;font-size:.9em;}pre{background:#f5f6f7;border-radius:6px;padding:1rem;overflow:auto;}pre code{background:none;padding:0;}blockquote{margin:1rem 0;padding-left:1rem;border-left:3px solid #dee0e3;color:#646a73;}ul.task-list{list-style:none;padding-left:1.2rem;}hr{border:none;border-top:1px solid #dee0e3;margin:2rem 0;}</style>',
    '</head>',
    '<body>',
    '<article>',
    body,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

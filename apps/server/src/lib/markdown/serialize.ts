/**
 * Tiptap JSON -> Markdown.
 *
 * The inverse of ./parse.ts: every mark and block the importer accepts is
 * written back in the form that importer reads again, so export -> import is
 * stable.
 */
import { documentNodeFrom, nodeText, type TiptapNode } from './nodes.js'

/* -------------------------------------------------------------------------- */
/* Tiptap -> Markdown                                                         */
/* -------------------------------------------------------------------------- */

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_\[\]~<>|#]/g, char => '\\' + char);
}

function codeSpan(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const padded = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' + text + ' ' : text;
  return fence + padded + fence;
}

function formatUrl(href: string): string {
  if (!href) return '';
  return /[\s()<>]/.test(href) ? '<' + href + '>' : href;
}

function renderTextNode(node: TiptapNode): string {
  const text = node.text ?? '';
  if (!text) return '';
  const marks = node.marks ?? [];
  const has = (type: string) => marks.find(mark => mark.type === type);
  let value = has('code') ? codeSpan(text) : escapeMarkdown(text);
  if (has('underline')) value = '<u>' + value + '</u>';
  if (has('strike')) value = '~~' + value + '~~';
  if (has('bold')) value = '**' + value + '**';
  if (has('italic')) value = '_' + value + '_';
  const link = has('link');
  if (link) value = '[' + value + '](' + formatUrl(String(link.attrs?.href ?? '')) + ')';
  return value;
}

function renderInline(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return '';
  let output = '';
  for (const node of nodes) {
    if (node.type === 'hardBreak') { output += '  \n'; continue; }
    if (node.type === 'text') { output += renderTextNode(node); continue; }
    output += renderInline(node.content);
  }
  return output;
}

function guardParagraphStart(text: string): string {
  return /^(\d{1,9}[.)]|[-+*>])/.test(text) ? '\\' + text : text;
}

function renderListItems(items: TiptapNode[], marker: (index: number) => string): string {
  return items.map((item, index) => {
    const prefix = marker(index);
    const body = renderBlocks(item.content ?? []);
    const lines = body ? body.split('\n') : [''];
    return lines.map((line, lineIndex) => {
      if (lineIndex === 0) return prefix + line;
      return line ? ' '.repeat(prefix.length) + line : '';
    }).join('\n');
  }).join('\n');
}

function cellMarkdown(cell: TiptapNode): string {
  const value = (cell.content ?? []).map(child => renderBlock(child)).join(' ').replace(/\s+/g, ' ').trim();
  return value.replace(/\|/g, '\\|');
}

function renderTable(node: TiptapNode): string {
  const rows = (node.content ?? []).filter(row => row.type === 'tableRow');
  if (!rows.length) return '';
  const cells = rows.map(row => (row.content ?? []).map(cell => cellMarkdown(cell)));
  const width = Math.max(1, ...cells.map(row => row.length));
  const normalize = (row: string[]): string[] => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    copy.length = width;
    return copy;
  };
  const line = (values: string[]) => '| ' + values.join(' | ') + ' |';
  const header = normalize(cells[0]);
  const separator = header.map(() => '---');
  const body = cells.slice(1).map(normalize);
  return [line(header), line(separator), ...body.map(line)].join('\n');
}

function renderBlock(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
      return guardParagraphStart(renderInline(node.content));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1) || 1));
      return '#'.repeat(level) + ' ' + renderInline(node.content);
    }
    case 'blockquote': {
      const inner = renderBlocks(node.content ?? []);
      return inner.split('\n').map(line => (line ? '> ' + line : '>')).join('\n');
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return ['```' + language, nodeText(node), '```'].join('\n');
    }
    case 'bulletList':
      return renderListItems(node.content ?? [], () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1) || 1;
      return renderListItems(node.content ?? [], index => (start + index) + '. ');
    }
    case 'taskList':
      return renderListItems(node.content ?? [], index => {
        const item = (node.content ?? [])[index];
        return item?.attrs?.checked ? '- [x] ' : '- [ ] ';
      });
    case 'horizontalRule':
      return '---';
    case 'image':
      return typeof node.attrs?.src === 'string' && node.attrs.src ? '![' + escapeMarkdown(String(node.attrs.alt ?? '')) + '](' + node.attrs.src + ')' : '';
    case 'table':
      return renderTable(node);
    case 'hardBreak':
      return '';
    default: {
      if (typeof node.text === 'string') return escapeMarkdown(node.text);
      return node.content ? renderBlocks(node.content) : '';
    }
  }
}

function renderBlocks(nodes: TiptapNode[]): string {
  return nodes.map(node => renderBlock(node)).filter(value => value.trim() !== '').join('\n\n');
}

/** Serialises a Tiptap document (or content envelope) to Markdown. */
export function tiptapToMarkdown(docJson: unknown): string {
  const document = documentNodeFrom(docJson);
  const body = renderBlocks(document.content);
  return body ? body + '\n' : '';
}

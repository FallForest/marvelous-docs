/**
 * Markdown -> Tiptap JSON.
 *
 * A hand-written CommonMark subset: inline marks, ATX/Setext headings, lists,
 * task lists, tables, fences, blockquotes, indented code and images. It is
 * deliberately not a full parser — it only has to round-trip what the editor
 * can produce, and it must run without a DOM so the API can import Markdown.
 */
import { type TiptapDocument, type TiptapMark, type TiptapNode, nodeText } from './nodes.js'

const LINK_ATTRS = { rel: 'noopener noreferrer', target: '_blank' };

function linkMark(href: string): TiptapMark {
  return { type: 'link', attrs: { href, ...LINK_ATTRS } };
}

function marksKey(marks: TiptapMark[] | undefined): string {
  if (!marks || marks.length === 0) return '';
  return marks.map(mark => mark.type + ':' + JSON.stringify(mark.attrs ?? {})).sort().join('|');
}

function mergeMarks(base: TiptapMark[] | undefined, extra: TiptapMark): TiptapMark[] {
  const merged = [...(base ?? [])];
  const index = merged.findIndex(mark => mark.type === extra.type);
  if (index >= 0) merged[index] = extra;
  else merged.push(extra);
  return merged;
}

function textNode(text: string, marks: TiptapMark[] | undefined): TiptapNode {
  return marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
const HORIZONTAL_RULE = /^ {0,3}(?:(\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const BLOCKQUOTE = /^ {0,3}>/;
const BULLET_ITEM = /^( {0,3})([-+*])([ \t]+)(.*)$/;
const ORDERED_ITEM = /^( {0,3})(\d{1,9})([.)])([ \t]+)(.*)$/;
const TASK_MARKER = /^\[([ xX])\][ \t]+/;
const LIST_MARKER_ANY = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/;

function isBlank(line: string | undefined): boolean {
  return line === undefined || /^[ \t]*$/.test(line);
}

function leadingSpaces(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === ' ') count += 1;
    else if (char === '\t') count += 4;
    else break;
  }
  return count;
}

function stripIndent(line: string, width: number): string {
  let index = 0;
  let consumed = 0;
  while (index < line.length && consumed < width) {
    if (line[index] === ' ') { consumed += 1; index += 1; }
    else if (line[index] === '\t') { consumed += 4; index += 1; }
    else break;
  }
  return line.slice(index);
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') { current += '|'; index += 1; continue; }
    if (char === '|') { cells.push(current); current = ''; continue; }
    current += char;
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

function isTableSeparator(line: string | undefined): boolean {
  if (!line || !line.includes('-')) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every(cell => /^:?-+:?$/.test(cell));
}

function normalizeInline(nodes: TiptapNode[]): TiptapNode[] {
  const output: TiptapNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue;
      const previous = output[output.length - 1];
      if (previous && previous.type === 'text' && marksKey(previous.marks) === marksKey(node.marks)) {
        previous.text = (previous.text ?? '') + node.text;
        continue;
      }
      output.push({ ...node });
      continue;
    }
    output.push(node);
  }
  return output;
}

function findUnescaped(source: string, from: number, needle: string): number {
  let index = from;
  while (index <= source.length - needle.length) {
    const found = source.indexOf(needle, index);
    if (found === -1) return -1;
    if (found > 0 && source[found - 1] === '\\') { index = found + 1; continue; }
    return found;
  }
  return -1;
}

type ParsedLink = { label: string; url: string; length: number };

function matchLinkOrImage(input: string): ParsedLink | null {
  if (input[0] !== '[') return null;
  let depth = 0;
  let label = '';
  let index = 0;
  for (; index < input.length; index += 1) {
    const char = input[index];
    if (char === '\\' && index + 1 < input.length) { label += input[index + 1]; index += 1; continue; }
    if (char === '[') { depth += 1; if (depth === 1) continue; }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) { index += 1; break; }
    }
    label += char;
  }
  if (depth !== 0) return null;
  if (input[index] !== '(') return null;
  index += 1;
  while (index < input.length && /[ \t]/.test(input[index])) index += 1;
  let url = '';
  if (input[index] === '<') {
    const end = input.indexOf('>', index + 1);
    if (end === -1) return null;
    url = input.slice(index + 1, end);
    index = end + 1;
  } else {
    let parens = 0;
    while (index < input.length) {
      const char = input[index];
      if (char === '\\' && index + 1 < input.length) { url += input[index + 1]; index += 2; continue; }
      if (char === '(') parens += 1;
      if (char === ')') {
        if (parens === 0) break;
        parens -= 1;
      }
      if (/[ \t]/.test(char)) break;
      url += char;
      index += 1;
    }
  }
  while (index < input.length && /[ \t]/.test(input[index])) index += 1;
  if (input[index] === '"') {
    const end = input.indexOf('"', index + 1);
    if (end === -1) return null;
    index = end + 1;
    while (index < input.length && /[ \t]/.test(input[index])) index += 1;
  }
  if (input[index] !== ')') return null;
  return { label, url: url.trim(), length: index + 1 };
}

function findEmphasisClose(source: string, from: number, char: string): number {
  let index = from;
  while (index < source.length) {
    const found = source.indexOf(char, index);
    if (found === -1) return -1;
    if (source[found - 1] === '\\') { index = found + 1; continue; }
    if (found === from) return -1;
    if (source[found - 1] === ' ' || source[found - 1] === '\t') { index = found + 1; continue; }
    if (char === '_' && /[A-Za-z0-9_]/.test(source[found + 1] ?? '')) { index = found + 1; continue; }
    return found;
  }
  return -1;
}

/** Parses inline Markdown into Tiptap inline nodes. */
export function parseInline(source: string, inherited: TiptapMark[] = []): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let buffer = '';
  let index = 0;
  const flush = () => { if (buffer) { nodes.push(textNode(buffer, inherited)); buffer = ''; } };

  while (index < source.length) {
    const char = source[index];

    if (char === '\\' && index + 1 < source.length && /[\\`*_{}\[\]()#+\-.!<>~|]/.test(source[index + 1])) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    if (char === '\n') {
      const trailing = /(?: {2,}|\\)$/.exec(buffer);
      if (trailing) {
        buffer = buffer.slice(0, buffer.length - trailing[0].length);
        flush();
        nodes.push({ type: 'hardBreak' });
      } else {
        buffer += ' ';
      }
      index += 1;
      while (index < source.length && (source[index] === ' ' || source[index] === '\t')) index += 1;
      continue;
    }

    if (char === '`') {
      const match = /^(`+)([\s\S]*?)\1/.exec(source.slice(index));
      if (match) {
        flush();
        let code = match[2].replace(/\n/g, ' ');
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        if (code) nodes.push(textNode(code, mergeMarks(inherited, { type: 'code' })));
        index += match[0].length;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '!' && source[index + 1] === '[') {
      const image = matchLinkOrImage(source.slice(index + 1));
      if (image) {
        flush();
        const label = image.label.trim() || image.url;
        if (label) nodes.push(textNode(label, mergeMarks(inherited, linkMark(image.url))));
        index += 1 + image.length;
        continue;
      }
    }

    if (char === '[') {
      const link = matchLinkOrImage(source.slice(index));
      if (link) {
        flush();
        const marks = mergeMarks(inherited, linkMark(link.url));
        const inner = parseInline(link.label, marks);
        nodes.push(...(inner.length ? inner : (link.label.trim() ? [textNode(link.label, marks)] : [])));
        index += link.length;
        continue;
      }
    }

    if (source.startsWith('**', index) || source.startsWith('__', index)) {
      const delimiter = source.slice(index, index + 2);
      if (source[index + 2] !== ' ' && source[index + 2] !== '\t') {
        const end = findUnescaped(source, index + 2, delimiter);
        if (end > index + 2) {
          flush();
          nodes.push(...parseInline(source.slice(index + 2, end), mergeMarks(inherited, { type: 'bold' })));
          index = end + 2;
          continue;
        }
      }
    }

    if (source.startsWith('~~', index)) {
      if (source[index + 2] !== ' ' && source[index + 2] !== '\t') {
        const end = findUnescaped(source, index + 2, '~~');
        if (end > index + 2) {
          flush();
          nodes.push(...parseInline(source.slice(index + 2, end), mergeMarks(inherited, { type: 'strike' })));
          index = end + 2;
          continue;
        }
      }
    }

    if (char === '*' || char === '_') {
      const previous = index > 0 ? source[index - 1] : '';
      const next = source[index + 1] ?? '';
      const openerAllowed = next !== '' && next !== ' ' && next !== '\t' && !(char === '_' && /[A-Za-z0-9_]/.test(previous));
      if (openerAllowed) {
        const end = findEmphasisClose(source, index + 1, char);
        if (end > -1) {
          flush();
          nodes.push(...parseInline(source.slice(index + 1, end), mergeMarks(inherited, { type: 'italic' })));
          index = end + 1;
          continue;
        }
      }
    }

    if (source.startsWith('<u>', index) || source.startsWith('<U>', index)) {
      const end = source.toLowerCase().indexOf('</u>', index + 3);
      if (end > -1) {
        flush();
        nodes.push(...parseInline(source.slice(index + 3, end), mergeMarks(inherited, { type: 'underline' })));
        index = end + 4;
        continue;
      }
    }

    const br = /^<br\s*\/?>/i.exec(source.slice(index));
    if (br) {
      flush();
      nodes.push({ type: 'hardBreak' });
      index += br[0].length;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return normalizeInline(nodes);
}

function paragraphNode(content: TiptapNode[]): TiptapNode {
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function ensureParagraphFirst(nodes: TiptapNode[]): TiptapNode[] {
  if (nodes.length && (nodes[0].type === 'paragraph' || nodes[0].type === 'heading')) return nodes;
  return [{ type: 'paragraph' }, ...nodes];
}

/** Block-level Markdown parser. Exported for reuse and tests. */
export class BlockParser {
  private index = 0;

  constructor(private readonly lines: string[]) {}

  parse(): TiptapNode[] {
    const nodes: TiptapNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (isBlank(line)) { this.index += 1; continue; }

      const fence = FENCE_START.exec(line);
      if (fence) { nodes.push(this.parseFence(fence[1], fence[2])); continue; }

      const heading = ATX_HEADING.exec(line);
      if (heading) {
        this.index += 1;
        const content = parseInline((heading[2] ?? '').trim());
        nodes.push({ type: 'heading', attrs: { level: heading[1].length }, ...(content.length ? { content } : {}) });
        continue;
      }

      if (HORIZONTAL_RULE.test(line)) {
        this.index += 1;
        nodes.push({ type: 'horizontalRule' });
        continue;
      }

      if (BLOCKQUOTE.test(line)) { nodes.push(this.parseBlockquote()); continue; }

      if (BULLET_ITEM.test(line) || ORDERED_ITEM.test(line)) { nodes.push(this.parseList()); continue; }

      if (line.includes('|') && isTableSeparator(this.lines[this.index + 1])) {
        nodes.push(this.parseTable());
        continue;
      }

      if (leadingSpaces(line) >= 4) { nodes.push(this.parseIndentedCode()); continue; }

      nodes.push(this.parseParagraph());
    }
    return nodes;
  }

  private parseFence(marker: string, info: string): TiptapNode {
    const char = marker[0];
    const minimum = marker.length;
    const indent = leadingSpaces(this.lines[this.index]);
    const closing = new RegExp('^ {0,3}' + (char === '`' ? '`' : '~') + '{' + minimum + ',}[ \t]*$');
    const language = info.trim().split(/\s+/)[0] ?? '';
    this.index += 1;
    const codeLines: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (closing.test(line)) { this.index += 1; break; }
      codeLines.push(stripIndent(line, indent));
      this.index += 1;
    }
    const attrs = language ? { language } : {};
    const text = codeLines.join('\n');
    return { type: 'codeBlock', attrs, ...(text ? { content: [textNode(text, undefined)] } : {}) };
  }

  private parseIndentedCode(): TiptapNode {
    const codeLines: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (isBlank(line)) {
        let look = this.index + 1;
        while (look < this.lines.length && isBlank(this.lines[look])) look += 1;
        if (look < this.lines.length && leadingSpaces(this.lines[look]) >= 4) {
          codeLines.push('');
          this.index += 1;
          continue;
        }
        break;
      }
      if (leadingSpaces(line) < 4) break;
      codeLines.push(stripIndent(line, 4));
      this.index += 1;
    }
    while (codeLines.length && codeLines[codeLines.length - 1] === '') codeLines.pop();
    const text = codeLines.join('\n');
    return { type: 'codeBlock', attrs: {}, ...(text ? { content: [textNode(text, undefined)] } : {}) };
  }

  private parseBlockquote(): TiptapNode {
    const quoted: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (BLOCKQUOTE.test(line)) {
        quoted.push(line.replace(/^ {0,3}> ?/, ''));
        this.index += 1;
        continue;
      }
      break;
    }
    const content = new BlockParser(quoted).parse();
    return { type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] };
  }

  private parseList(): TiptapNode {
    const firstLine = this.lines[this.index];
    const orderedMatch = ORDERED_ITEM.exec(firstLine);
    const bulletMatch = orderedMatch ? null : BULLET_ITEM.exec(firstLine);
    const baseIndent = (orderedMatch ?? bulletMatch)![1].length;
    const ordered = Boolean(orderedMatch);
    const start = orderedMatch ? Number.parseInt(orderedMatch[2], 10) || 1 : 1;
    const items: TiptapNode[] = [];
    let taskList = false;

    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      const match = ordered ? ORDERED_ITEM.exec(line) : BULLET_ITEM.exec(line);
      if (!match || match[1].length !== baseIndent) break;

      let contentIndent: number;
      let content: string;
      if (orderedMatch && ordered) {
        contentIndent = baseIndent + match[2].length + 1 + match[4].length;
        content = match[5];
      } else {
        contentIndent = baseIndent + 1 + match[3].length;
        content = match[4];
      }

      let checked: boolean | undefined;
      const task = TASK_MARKER.exec(content);
      if (task) {
        checked = task[1].toLowerCase() === 'x';
        contentIndent += task[0].length;
        content = content.slice(task[0].length);
        taskList = true;
      } else if (taskList) {
        break;
      }

      const itemLines: string[] = [content];
      this.index += 1;
      while (this.index < this.lines.length) {
        const next = this.lines[this.index];
        if (isBlank(next)) {
          let look = this.index + 1;
          while (look < this.lines.length && isBlank(this.lines[look])) look += 1;
          if (look < this.lines.length && leadingSpaces(this.lines[look]) >= contentIndent) {
            itemLines.push('');
            this.index += 1;
            continue;
          }
          break;
        }
        const indent = leadingSpaces(next);
        if (indent >= contentIndent) {
          itemLines.push(stripIndent(next, contentIndent));
          this.index += 1;
          continue;
        }
        if (indent > baseIndent && LIST_MARKER_ANY.test(next.trimStart())) {
          itemLines.push(stripIndent(next, Math.min(indent, contentIndent)));
          this.index += 1;
          continue;
        }
        break;
      }

      const children = new BlockParser(itemLines).parse();
      const itemContent = ensureParagraphFirst(children);
      items.push(checked === undefined
        ? { type: 'listItem', content: itemContent }
        : { type: 'taskItem', attrs: { checked }, content: itemContent });
    }

    if (taskList) return { type: 'taskList', content: items };
    if (ordered) return { type: 'orderedList', attrs: start === 1 ? {} : { start }, content: items };
    return { type: 'bulletList', content: items };
  }

  private parseTable(): TiptapNode {
    const header = splitTableRow(this.lines[this.index]);
    this.index += 2;
    const rows: string[][] = [header];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (isBlank(line) || !line.includes('|')) break;
      rows.push(splitTableRow(line));
      this.index += 1;
    }
    const width = Math.max(1, header.length);
    const toCell = (values: string[], type: 'tableHeader' | 'tableCell'): TiptapNode => ({
      type,
      content: [paragraphNode(parseInline(values.join(' ').trim()))],
    });
    const tableRows: TiptapNode[] = rows.map((values, rowIndex) => {
      const normalized = [...values];
      while (normalized.length < width) normalized.push('');
      normalized.length = width;
      return {
        type: 'tableRow',
        content: normalized.map(value => toCell([value], rowIndex === 0 ? 'tableHeader' : 'tableCell')),
      };
    });
    return { type: 'table', content: tableRows };
  }

  private parseParagraph(): TiptapNode {
    const paragraphLines: string[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (isBlank(line)) break;
      if (paragraphLines.length > 0) {
        const setext = SETEXT_UNDERLINE.exec(line);
        if (setext) {
          this.index += 1;
          const level = setext[1][0] === '=' ? 1 : 2;
          const content = parseInline(paragraphLines.join('\n').trim());
          return { type: 'heading', attrs: { level }, ...(content.length ? { content } : {}) };
        }
        if (this.startsBlock()) break;
      }
      paragraphLines.push(line.replace(/^ {0,3}/, ''));
      this.index += 1;
    }
    const text = paragraphLines.join('\n').trim();
    const standaloneImage = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(text);
    if (standaloneImage) {
      return { type: 'image', attrs: { src: standaloneImage[2], alt: standaloneImage[1] || null, title: null } } as TiptapNode;
    }
    return paragraphNode(parseInline(text));
  }

  private startsBlock(): boolean {
    const line = this.lines[this.index];
    const next = this.lines[this.index + 1];
    if (FENCE_START.test(line)) return true;
    if (ATX_HEADING.test(line)) return true;
    if (HORIZONTAL_RULE.test(line)) return true;
    if (BLOCKQUOTE.test(line)) return true;
    if (BULLET_ITEM.test(line) || ORDERED_ITEM.test(line)) return true;
    if (line.includes('|') && isTableSeparator(next)) return true;
    return false;
  }
}

/** Converts Markdown into a Tiptap document node for the server schema. */
export function markdownToTiptap(markdown: string): TiptapDocument {
  const normalized = markdown.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const lines = normalized.split('\n');
  return { type: 'doc', content: new BlockParser(lines).parse() };
}

/** First level-one heading text, used to derive import titles. */
export function firstHeadingTitle(document: TiptapDocument): string | null {
  for (const node of document.content) {
    if (node.type !== 'heading') continue;
    if (Number(node.attrs?.level ?? 1) !== 1) return null;
    const text = nodeText(node).trim();
    return text || null;
  }
  return null;
}

/**
 * The Tiptap JSON shape this server stores, plus the two node helpers every
 * Markdown/HTML/search path needs: unwrapping a stored envelope, and flattening
 * a node tree back to text.
 */

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type TiptapDocument = { type: 'doc'; content: TiptapNode[] };

/** Extracts the Tiptap document node from a stored content envelope or a bare document node. */
export function documentNodeFrom(value: unknown): TiptapDocument {
  const candidate = value && typeof value === 'object' && 'doc' in (value as Record<string, unknown>)
    ? (value as { doc?: unknown }).doc
    : value;
  if (candidate && typeof candidate === 'object' && (candidate as { type?: unknown }).type === 'doc') {
    const content = (candidate as { content?: unknown }).content;
    return { type: 'doc', content: Array.isArray(content) ? content as TiptapNode[] : [] };
  }
  return { type: 'doc', content: [] };
}

/** Extracts plain text from a Tiptap node tree. */
export function nodeText(node: TiptapNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(child => nodeText(child)).join('');
}

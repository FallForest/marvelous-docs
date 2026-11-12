import Image from '@tiptap/extension-image';

/**
 * The document's image node, mirroring `apps/web/src/lib/image.ts`.
 *
 * Width and alignment are node attributes rather than marks: a mark cannot style
 * a node that has no text, and TextAlign only covers headings and paragraphs.
 *
 * This must stay byte-for-byte equivalent to the web copy. If the two drift, REST
 * saves fail with 400 INVALID_CONTENT while collaboration (which bypasses REST
 * validation) keeps working — a confusing way to discover the mismatch.
 */
export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** A percentage of the editor column, or null for the intrinsic size. */
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('width') || element.style.width;
          return raw ? raw.replace(/px$/, '') : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => attributes.width ? { width: attributes.width } : {},
      },
      textAlign: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-align') || element.style.textAlign || null,
        renderHTML: (attributes: Record<string, unknown>) => attributes.textAlign
          ? { 'data-align': attributes.textAlign, style: 'display:block;margin-left:' + (attributes.textAlign === 'center' ? 'auto' : attributes.textAlign === 'right' ? 'auto' : '0') + ';margin-right:' + (attributes.textAlign === 'center' ? 'auto' : attributes.textAlign === 'right' ? '0' : 'auto') }
          : {},
      },
    };
  },
}).configure({ inline: false, allowBase64: true });

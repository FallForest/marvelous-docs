import Image from '@tiptap/extension-image'

/**
 * The document's image node.
 *
 * Tiptap's Image carries `src`, `alt` and `title`. A document image also needs a
 * display width and an alignment, which are attributes rather than marks (a mark
 * cannot style a node that has no text). `TextAlign` is configured for headings
 * and paragraphs only, so alignment has to live on the node.
 *
 * The server schema mirrors these attributes exactly; a mismatch makes every REST
 * save fail validation with 400 INVALID_CONTENT while collaboration keeps working,
 * which is a confusing way to find out.
 */
export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** A percentage of the editor column, or null for the intrinsic size. */
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('width') || element.style.width
          return raw ? raw.replace(/px$/, '') : null
        },
        renderHTML: (attributes) => attributes.width ? { width: attributes.width } : {},
      },
      textAlign: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-align') || element.style.textAlign || null,
        renderHTML: (attributes) => attributes.textAlign
          ? { 'data-align': attributes.textAlign, style: 'display:block;margin-left:' + (attributes.textAlign === 'center' ? 'auto' : attributes.textAlign === 'right' ? 'auto' : '0') + ';margin-right:' + (attributes.textAlign === 'center' ? 'auto' : attributes.textAlign === 'right' ? '0' : 'auto') }
          : {},
      },
    }
  },
}).configure({ inline: false, allowBase64: true })

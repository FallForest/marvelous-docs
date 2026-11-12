import { AlignCenter, AlignLeft, AlignRight, Maximize2, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { BlockGeometry } from '../../hooks/useBlockGeometry'

type Props = {
  editor: Editor | null
  image: BlockGeometry | null
}

/** Size presets, as a share of the editor column. */
const SIZES: Array<{ label: string; width: string }> = [
  { label: '小', width: '35%' },
  { label: '中', width: '60%' },
  { label: '大', width: '100%' },
]

/**
 * Toolbar for the selected image.
 *
 * An inserted image had no controls at all: it could not be resized, aligned or
 * removed without selecting it and pressing Backspace, and TextAlign does not
 * cover image nodes. The bar rides on the image's own rect (useBlockGeometry) so
 * it is always adjacent to what it acts on, the same pattern as the code block
 * and table tools.
 */
export default function ImageToolbar({ editor, image }: Props) {
  if (!editor || !image) return null

  const node = editor.state.doc.nodeAt(image.pos)
  if (!node || node.type.name !== 'image') return null
  const align = String(node.attrs.textAlign || '')

  /** Applies an attribute and keeps the node selected so the bar stays put. */
  const apply = (attrs: Record<string, unknown>) => {
    editor.chain().focus().setNodeSelection(image.pos).updateAttributes('image', attrs).run()
  }

  const top = Math.max(8, image.top - 34)
  const left = Math.max(8, Math.min(image.right - 232, window.innerWidth - 240))

  return <div className="block-tool" style={{ top, left }} contentEditable={false}>
    <div className="block-tool-iconbar" role="toolbar" aria-label="图片操作">
      {SIZES.map((size) => <button
        key={size.label}
        type="button"
        className={String(node.attrs.width || '') === size.width ? 'is-active' : ''}
        title={'宽度 ' + size.label}
        aria-label={'宽度 ' + size.label}
        aria-pressed={String(node.attrs.width || '') === size.width}
        onClick={() => apply({ width: size.width })}
      >{size.label}</button>)}
      <button type="button" title="原始大小" aria-label="原始大小" onClick={() => apply({ width: null })}><Maximize2 size={13} /></button>
      <span className="block-tool-divider" />
      <button type="button" className={align === 'left' || !align ? 'is-active' : ''} title="左对齐" aria-label="左对齐" aria-pressed={align === 'left' || !align} onClick={() => apply({ textAlign: 'left' })}><AlignLeft size={13} /></button>
      <button type="button" className={align === 'center' ? 'is-active' : ''} title="居中" aria-label="居中" aria-pressed={align === 'center'} onClick={() => apply({ textAlign: 'center' })}><AlignCenter size={13} /></button>
      <button type="button" className={align === 'right' ? 'is-active' : ''} title="右对齐" aria-label="右对齐" aria-pressed={align === 'right'} onClick={() => apply({ textAlign: 'right' })}><AlignRight size={13} /></button>
      <span className="block-tool-divider" />
      <button type="button" className="danger" title="删除图片" aria-label="删除图片" onClick={() => {
        const { tr } = editor.state
        editor.view.dispatch(tr.delete(image.pos, image.pos + node.nodeSize))
      }}><Trash2 size={13} /></button>
    </div>
  </div>
}

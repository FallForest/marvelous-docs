import { useEffect, useRef, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, Copy, MoreHorizontal, WrapText } from 'lucide-react'
import { copyText } from '../../lib/clipboard'
import { grammarFor } from '../../lib/editor/highlight'
import LanguagePicker from './LanguagePicker'

/** The toolbar belongs to the block, so the paper clips and scrolls both together. */
export default function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState<boolean | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(timer.current) } }, [])

  const copy = async () => {
    const ok = await copyText(node.textContent)
    if (!mounted.current) return
    setCopied(ok)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1800)
    if (!ok) window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '浏览器阻止了自动复制，请手动选中代码复制。' }))
  }

  return <NodeViewWrapper className={'code-block-card' + (wrap ? ' is-wrapped' : '')}>
    <div className="code-overlay code-block-toolbar" contentEditable={false}>
      <LanguagePicker value={String(node.attrs.language || '')} onChange={(id) => updateAttributes({ language: grammarFor(id) })} />
      <span className="code-key-hint" title="Enter 换行 · Tab / Shift+Tab 缩进 · Ctrl/⌘+Enter 或末尾连续三次 Enter 继续正文">Ctrl/⌘+Enter 继续正文</span>
      <span className="code-overlay-actions">
        <button type="button" className="code-overlay-icon" aria-label="代码自动换行" aria-pressed={wrap} title={wrap ? '关闭自动换行' : '自动换行'} onMouseDown={(event) => event.preventDefault()} onClick={() => setWrap((value) => !value)}><WrapText size={16} /></button>
        <button type="button" className={'code-overlay-copy' + (copied === null ? '' : copied ? ' copied' : ' failed')} aria-label="复制代码" title="复制代码" onMouseDown={(event) => event.preventDefault()} onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied === null ? '复制' : copied ? '已复制' : '重试'}</span>
        </button>
        {editor.isEditable && <button type="button" className="code-overlay-icon" aria-label="代码块操作" title="代码块操作" onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
          const pos = getPos()
          if (typeof pos !== 'number') return
          const rect = event.currentTarget.getBoundingClientRect()
          window.dispatchEvent(new CustomEvent('mdoc-open-block-menu', { detail: { pos, left: rect.right - 208, top: rect.bottom + 4 } }))
        }}><MoreHorizontal size={16} /></button>}
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">{copied === null ? '' : copied ? '代码已复制到剪贴板' : '复制失败，请重试'}</span>
    </div>
    <pre><NodeViewContent as="code" className={node.attrs.language ? 'language-' + String(node.attrs.language) : undefined} spellCheck={false} style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }} /></pre>
  </NodeViewWrapper>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { DURATION } from '../../lib/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type Props = { editor: Editor | null; initial: string; onClose: () => void }

export function FindReplace({ editor, initial, onClose }: Props) {
  const [query, setQuery] = useState(initial)
  const [replace, setReplace] = useState('')
  const [index, setIndex] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const reduced = useReducedMotion()
  const [shaking, setShaking] = useState(false)
  const shakeTimer = useRef<number | undefined>(undefined)
  const replayFrame = useRef<number | undefined>(undefined)

  const matches = useMemo(() => {
    if (!editor || !query) return [] as Array<{ from: number; to: number }>
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
    const haystack = caseSensitive ? text : text.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    const found: Array<{ from: number; to: number }> = []
    let at = haystack.indexOf(needle)
    while (at >= 0 && found.length < 500) {
      const from = editor.state.doc.resolve(at + 1).pos
      found.push({ from, to: from + query.length })
      at = haystack.indexOf(needle, at + Math.max(1, needle.length))
    }
    return found
  }, [editor, query, caseSensitive])

  useEffect(() => { setIndex(0) }, [query, caseSensitive])

  /*
   * Two one-shot reactions to the hit count, both driven by the count itself:
   *   - any change pops the counter, so the new number is noticed rather than
   *     merely present;
   *   - an empty result shakes the field once, so "no match" is felt as well as
   *     read, and the danger border carries the state after the shake ends.
   * Under reduced motion the count still updates and the border still turns
   * red; only the movement is skipped.
   */
  useEffect(() => {
    if (!query) {
      setShaking(false)
      return
    }
    if (reduced || matches.length > 0) {
      setShaking(false)
      return
    }
    // Second miss in a row: drop the class, re-add it on the next frame, or the
    // keyframes are reused and the field does not shake again.
    setShaking(false)
    replayFrame.current = window.requestAnimationFrame(() => {
      setShaking(true)
      window.clearTimeout(shakeTimer.current)
      shakeTimer.current = window.setTimeout(() => setShaking(false), DURATION.slow)
    })
    return () => {
      window.clearTimeout(shakeTimer.current)
      if (replayFrame.current !== undefined) window.cancelAnimationFrame(replayFrame.current)
    }
  }, [matches.length, query, reduced])

  function jump(direction: 1 | -1) {
    if (!editor || !matches.length) return
    const next = (index + direction + matches.length) % matches.length
    setIndex(next)
    const match = matches[next]!
    editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
  }

  function replaceCurrent() {
    if (!editor || !matches.length || !query) return
    const match = matches[index] ?? matches[0]!
    editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).insertContent(replace).run()
  }

  function replaceAll() {
    if (!editor || !query) return
    let count = 0
    matches.slice().reverse().forEach((match) => {
      editor.chain().setTextSelection({ from: match.from, to: match.to }).insertContent(replace).run()
      count += 1
    })
    window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '已替换 ' + count + ' 处' }))
  }

  const miss = Boolean(query) && matches.length === 0
  const countText = query ? (matches.length ? index + 1 : 0) + '/' + matches.length : ''
  // The counter is keyed by what produced it. Remounting is the only reliable
  // way to replay an animation whose class name does not change between hits;
  // a finished animation on an unchanged element is simply reused.
  const countKey = query + '|' + matches.length
  // Under reduced motion the class is never applied at all, so the number still
  // updates but nothing moves to announce it.
  const bumpClass = query && !reduced ? ' is-bumped' : ''

  return <div className="find-panel motion-sink" role="dialog" aria-label="查找替换">
    <div className="find-head"><b>查找替换</b><button type="button" className="icon-btn" aria-label="关闭查找" onClick={onClose}><X size={15} /></button></div>
    <label className={'find-field' + (miss ? ' is-empty' : '') + (shaking ? ' is-shaking' : '')}>
      <Search size={14} />
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找内容" onKeyDown={(event) => { if (event.key === 'Enter') jump(event.shiftKey ? -1 : 1) }} />
      <span key={countKey} className={'find-count' + bumpClass} aria-live="polite">{countText}</span>
    </label>
    <div className="find-actions">
      <button type="button" className="icon-btn" aria-label="上一个" onClick={() => jump(-1)}><ChevronUp size={15} /></button>
      <button type="button" className="icon-btn" aria-label="下一个" onClick={() => jump(1)}><ChevronDown size={15} /></button>
      <label className="find-case"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />区分大小写</label>
    </div>
    <label className="find-field"><input value={replace} onChange={(event) => setReplace(event.target.value)} placeholder="替换为" /></label>
    <div className="find-actions">
      <button type="button" className="secondary-btn" onClick={replaceCurrent} disabled={!matches.length}>替换</button>
      <button type="button" className="secondary-btn" onClick={replaceAll} disabled={!matches.length}>全部替换</button>
    </div>
  </div>
}

export function OutlinePanel({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
  const headings = useMemo(() => {
    if (!editor) return [] as Array<{ level: number; text: string; pos: number }>
    const list: Array<{ level: number; text: string; pos: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') list.push({ level: node.attrs.level as number, text: node.textContent, pos })
    })
    return list
  }, [editor])

  return <div className="outline-panel motion-sink" role="dialog" aria-label="文档大纲">
    <div className="find-head"><b>文档大纲</b><button type="button" className="icon-btn" aria-label="关闭大纲" onClick={onClose}><X size={15} /></button></div>
    {headings.length === 0 ? <p className="outline-empty">给段落设置标题样式后，这里会列出一键跳转的大纲。</p>
      : <ol className="outline-list">{headings.map((heading, position) => <li key={position} style={{ paddingLeft: (heading.level - 1) * 12 }}>
        <button type="button" onClick={() => { editor?.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run(); onClose() }}>{heading.text || '未命名标题'}</button>
      </li>)}</ol>}
  </div>
}
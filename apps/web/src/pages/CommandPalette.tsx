import { useEffect, useMemo, useRef } from 'react'
import { FileText, Folder, Home, Plus, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ArtIcon from '../components/ui/ArtIcon'
import { staggerItemProps } from '../components/ui/Stagger'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { excerpt, snippetText } from '../lib/format'
import type { Doc, SearchHit, SearchScope } from '../lib/types'

const SCOPES: Array<{ value: SearchScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'title', label: '标题' },
  { value: 'content', label: '正文' },
]

type PaletteItem = { key: string; label: string; icon: LucideIcon; doc?: Doc; snippet?: string; hint?: string }

type CommandPaletteProps = {
  query: string
  onQuery: (value: string) => void
  scope: SearchScope
  onScope: (scope: SearchScope) => void
  index: number
  onIndex: (value: number) => void
  results: SearchHit[]
  loading: boolean
  onClose: () => void
  onOpen: (doc: Doc) => void
  onCreate: () => void
  onHome: () => void
}

export default function CommandPalette({ query, onQuery, scope, onScope, index, onIndex, results, loading, onClose, onOpen, onCreate, onHome }: CommandPaletteProps) {
  const reduced = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const items = useMemo<PaletteItem[]>(() => {
    const base: PaletteItem[] = [
      { key: 'home', label: '打开首页', icon: Home },
      { key: 'create', label: '新建文档', icon: Plus, hint: '⌘ N' },
    ]
    results.slice(0, 8).forEach((hit) => base.push({
      key: hit.id,
      label: hit.title || '未命名文档',
      icon: hit.kind === 'folder' ? Folder : FileText,
      doc: hit,
      snippet: hit.snippet ? excerpt(snippetText(hit.snippet), 90) : '',
    }))
    return base
  }, [results])

  // Keep the highlighted row inside the list without scrolling the page behind
  // it; 'nearest' is what stops arrow-key navigation from jumping a long list.
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    active?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [index, items.length, reduced])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); onIndex(Math.min(index + 1, items.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); onIndex(Math.max(index - 1, 0)) }
      if (event.key === 'Escape') onClose()
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = items[index]
        if (!item) return
        if (item.key === 'home') onHome()
        else if (item.key === 'create') onCreate()
        else if (item.doc) onOpen(item.doc)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, items, onClose, onCreate, onHome, onOpen, onIndex])

  function activate(item: PaletteItem) {
    if (item.key === 'home') onHome()
    else if (item.key === 'create') onCreate()
    else if (item.doc) onOpen(item.doc)
  }

  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="command-input">
        <ArtIcon name="search" fallback={<Search size={17} />} />
        <input autoFocus role="combobox" aria-expanded="true" aria-controls="command-results" aria-autocomplete="list" aria-label="搜索文档或输入命令" placeholder="搜索文档或输入命令" value={query === '__favorites__' ? '' : query} onChange={(event) => onQuery(event.target.value)} />
        <kbd>ESC</kbd>
      </div>
      <div className="command-scope" role="group" aria-label="搜索范围">
        {SCOPES.map((item) => <button
          key={item.value}
          className={scope === item.value ? 'active' : ''}
          aria-pressed={scope === item.value}
          onClick={() => onScope(item.value)}
        >{item.label}</button>)}
        <span className="command-scope-hint">{loading ? '检索中…' : results.length ? results.length + ' 条结果' : ''}</span>
      </div>
      <div className="command-list" id="command-results" role="listbox" aria-label="搜索结果" ref={listRef}>
        {items.map((item, itemIndex) => {
          const Icon = item.icon
          const entry = staggerItemProps(itemIndex, itemIndex === index ? 'active' : '')
          // Keyed by item so a highlight change is a class swap, not a remount:
          // a remount would restart the entry animation on every arrow key.
          return <button
            {...entry}
            key={item.key}
            type="button"
            role="option"
            aria-selected={itemIndex === index}
            onMouseEnter={() => onIndex(itemIndex)}
            onClick={() => activate(item)}
          >
            <ArtIcon
              name={item.key === 'home' ? 'home' : item.key === 'create' ? 'new-document' : item.doc?.kind === 'folder' ? 'folder' : 'document'}
              fallback={<Icon size={16} />}
            />
            <span className="command-item-copy"><span>{item.label}</span>{item.snippet && <small>{item.snippet}</small>}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        })}
        {!items.length && <div className="command-empty">没有匹配的文档</div>}
      </div>
      <div className="command-footer"><span><kbd>↑↓</kbd> 导航</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
    </section>
  </div>
}

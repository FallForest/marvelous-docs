import { FileText, Folder, Search } from 'lucide-react'
import { staggerItemProps } from '../components/ui/Stagger'
import { excerpt, formatDate, snippetText } from '../lib/format'
import type { Doc, SearchHit, SearchScope } from '../lib/types'

const SCOPES: Array<{ value: SearchScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'title', label: '标题' },
  { value: 'content', label: '正文' },
]

type SearchPageProps = {
  query: string
  scope: SearchScope
  onScope: (scope: SearchScope) => void
  results: SearchHit[]
  loading: boolean
  onOpen: (doc: Doc) => void
}

export default function SearchPage({ query, scope, onScope, results, loading, onOpen }: SearchPageProps) {
  return <div className="search-page">
    <div className="search-hero">
      <span {...staggerItemProps(0, 'eyebrow')}>搜索</span>
      <h1 {...staggerItemProps(1)}>{'搜索“' + query + '”'}</h1>
      <p {...staggerItemProps(2)}>{loading ? '正在检索工作区…' : '共找到 ' + results.length + ' 条结果，包含标题和正文匹配。'}</p>
      <div className="search-scope" role="group" aria-label="搜索范围">
        {SCOPES.map((item) => <button
          key={item.value}
          className={scope === item.value ? 'active' : ''}
          aria-pressed={scope === item.value}
          onClick={() => onScope(item.value)}
        >{item.label}</button>)}
      </div>
    </div>
    {results.length === 0 ? <div className="home-empty"><Search size={16} />{loading ? '正在搜索…' : '没有找到匹配的文档，试试换一个关键词。'}</div>
      : <div className="search-results">{results.map((hit, index) => <button {...staggerItemProps(index, 'search-hit')} key={hit.id} onClick={() => onOpen(hit)}>
        <span className={'home-card-icon ' + (hit.kind === 'folder' ? 'folder' : '')}>{hit.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span>
        <span className="search-hit-copy">
          <b>{hit.title || '未命名文档'}</b>
          <small>{excerpt(snippetText(hit.snippet), 160) || (hit.kind === 'folder' ? '文件夹' : '更新于 ' + (formatDate(hit.updatedAt) || '刚刚'))}</small>
        </span>
      </button>)}</div>}
  </div>
}

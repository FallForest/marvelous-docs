const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const CJK_GLOBAL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g

export function formatDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function wordCount(text?: string) {
  if (!text) return 0
  const cjk = text.match(CJK_GLOBAL)
  const latin = text.replace(CJK_GLOBAL, ' ').match(/[A-Za-z0-9_'-]+/g)
  return (cjk ? cjk.length : 0) + (latin ? latin.length : 0)
}

export function excerpt(text: string | undefined, max = 160) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max).trimEnd() + '…'
}

export function snippetText(value?: string) {
  return (value || '').replace(/<[^>]*>/g, ' ')
}

export function relativeTime(value?: string, now: number = Date.now()) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Math.max(0, now - date.getTime())
  const minute = 60 * 1000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return Math.floor(diff / minute) + ' 分钟前'
  if (diff < 24 * 60 * minute) return Math.floor(diff / (60 * minute)) + ' 小时前'
  if (diff < 7 * 24 * 60 * minute) return Math.floor(diff / (24 * 60 * minute)) + ' 天前'
  return formatDate(value)
}

export function hasCjk(text?: string) {
  return !!text && CJK_PATTERN.test(text)
}

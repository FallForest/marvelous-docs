import type { DocJson, HistoryItem } from './types'

type JsonNode = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: unknown[]; content?: JsonNode[] }
export type TextChange = { kind: 'same' | 'added' | 'removed'; text: string }
export type HistoryBlock = { index: number; type: string; label: string; text: string; json: JsonNode; key: string }
export type BlockChange = { kind: 'same' | 'added' | 'removed' | 'modified'; before?: HistoryBlock; after?: HistoryBlock; text: TextChange[]; structureChanged: boolean }

/** Canonical JSON, without mutating persisted nodes or losing non-text content. */
export function normalizeHistoryJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeHistoryJson)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const next = normalizeHistoryJson((value as Record<string, unknown>)[key])
      if (next === undefined || next === null) continue
      if (['attrs', 'marks', 'content'].includes(key) && typeof next === 'object' && Object.keys(next).length === 0) continue
      result[key] = next
    }
    return result
  }
  return value
}

const canonical = (value: unknown) => JSON.stringify(normalizeHistoryJson(value))
const LABELS: Record<string, string> = { paragraph: '正文', blockquote: '引用', bulletList: '无序列表', orderedList: '有序列表', taskList: '任务列表', codeBlock: '代码块', table: '表格', image: '图片', horizontalRule: '分隔线' }

function nodeText(node: JsonNode): string {
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'image') return String(node.attrs?.alt || '图片')
  const children = node.content || []
  const separator = node.type === 'tableRow' ? '\t' : ['doc', 'table', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'].includes(node.type || '') ? '\n' : ''
  return children.map(nodeText).join(separator)
}

function blockLabel(node: JsonNode): string {
  if (node.type === 'heading') return '标题 ' + String(node.attrs?.level || 1)
  if (node.type === 'codeBlock') return '代码块' + (node.attrs?.language ? ' · ' + String(node.attrs.language) : '')
  if (node.type === 'table') return `表格 · ${node.content?.length || 0} 行 × ${Math.max(0, ...(node.content || []).map(row => row.content?.length || 0))} 列`
  return LABELS[node.type || ''] || node.type || '内容块'
}

function blocks(content?: DocJson): HistoryBlock[] {
  const root = content?.doc as JsonNode | undefined
  return (root?.content || []).map((json, index) => ({ index, type: json.type || '', label: blockLabel(json), text: nodeText(json), json, key: canonical(json) }))
}

/** Bounded LCS: large documents fall back to replace regions rather than freeze UI. */
function equalPairs<T>(before: T[], after: T[], equal: (a: T, b: T) => boolean): [number, number][] {
  if (before.length * after.length > 120_000) {
    const pairs: [number, number][] = []
    let prefix = 0
    while (prefix < Math.min(before.length, after.length) && equal(before[prefix]!, after[prefix]!)) { pairs.push([prefix, prefix]); prefix++ }
    let left = before.length - 1, right = after.length - 1
    const suffix: [number, number][] = []
    while (left >= prefix && right >= prefix && equal(before[left]!, after[right]!)) { suffix.unshift([left--, right--]) }
    return [...pairs, ...suffix]
  }
  const rows = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) {
    rows[i]![j] = equal(before[i]!, after[j]!) ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!)
  }
  const pairs: [number, number][] = []
  let i = 0, j = 0
  while (i < before.length && j < after.length) {
    if (equal(before[i]!, after[j]!)) { pairs.push([i++, j++]); continue }
    if (rows[i + 1]![j]! >= rows[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/** Unicode code points preserve emoji and give useful character changes for Chinese. */
export function diffHistoryText(before: string, after: string): TextChange[] {
  const left = Array.from(before), right = Array.from(after), result: TextChange[] = []
  const append = (kind: TextChange['kind'], text: string) => {
    if (!text) return
    const previous = result[result.length - 1]
    if (previous?.kind === kind) previous.text += text
    else result.push({ kind, text })
  }
  let i = 0, j = 0
  for (const [a, b] of [...equalPairs(left, right, (a, b) => a === b), [left.length, right.length] as [number, number]]) {
    append('removed', left.slice(i, a).join('')); append('added', right.slice(j, b).join(''))
    if (a < left.length && b < right.length) append('same', left[a]!)
    i = a + 1; j = b + 1
  }
  return result
}

function structure(node?: JsonNode): unknown {
  if (!node) return null
  const { text: _text, content, ...rest } = node
  return { ...rest, ...(content ? { content: content.map(structure) } : {}) }
}

/** Direction is current → selected snapshot: green is what restoring would add. */
export function diffHistoryDocuments(current?: DocJson, snapshot?: DocJson): BlockChange[] {
  const before = blocks(current), after = blocks(snapshot), result: BlockChange[] = []
  const add = (left?: HistoryBlock, right?: HistoryBlock) => {
    const kind = !left ? 'added' : !right ? 'removed' : left.key === right.key ? 'same' : 'modified'
    result.push({ kind, before: left, after: right, text: diffHistoryText(left?.text || '', right?.text || ''), structureChanged: !!left && !!right && canonical(structure(left.json)) !== canonical(structure(right.json)) })
  }
  let i = 0, j = 0
  for (const [a, b] of [...equalPairs(before, after, (a, b) => a.key === b.key), [before.length, after.length] as [number, number]]) {
    const count = Math.max(a - i, b - j)
    for (let offset = 0; offset < count; offset++) add(i + offset < a ? before[i + offset] : undefined, j + offset < b ? after[j + offset] : undefined)
    if (a < before.length && b < after.length) add(before[a], after[b])
    i = a + 1; j = b + 1
  }
  return result
}

export function historyDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function historyEventLabel(item: HistoryItem): string {
  if (item.kind === 'snapshot') return item.summary?.label || '自动保存了一个版本'
  const details = item.details || {}
  if (item.action === 'rename') return `将“${details.beforeTitle || '未命名文档'}”改名为“${details.afterTitle || '未命名文档'}”`
  if (item.action === 'move') return details.fromParentTitle && details.toParentTitle ? `从“${details.fromParentTitle}”移至“${details.toParentTitle}”` : details.toParentId === null ? '将文档移至根目录' : details.fromParentId === null ? '将文档从根目录移入文件夹' : '将文档移至另一个文件夹'
  if (item.action === 'history_restore') return details.sourceVersion !== undefined ? `将文档恢复到版本 ${details.sourceVersion}` : '恢复了历史版本'
  if (item.action === 'acl' && details.afterRestricted !== undefined) return details.afterRestricted ? '将访问范围改为指定成员' : '将访问范围改为工作区成员'
  if (item.action === 'acl' && details.targetUserId) return details.afterRole ? `将${details.targetUserName || '成员'}的权限设为${historyRole(details.afterRole)}` : `移除了${details.targetUserName || '成员'}的访问权限`
  if (item.action === 'trash' || item.action === 'trash_restore') return (item.action === 'trash' ? '将文档移入回收站' : '从回收站还原了文档') + (details.affectedCount && details.affectedCount > 1 ? `（共 ${details.affectedCount} 项）` : '')
  const labels: Record<string, string> = { restore: '恢复了文档', acl: '更新了访问权限', share_link_created: '创建了分享链接', share_link_revoked: '撤销了分享链接', delete: '删除了文档' }
  return labels[item.action] || '更新了文档设置'
}

export function historyRole(role?: string | null): string {
  return ({ owner: '所有者', editor: '可编辑', viewer: '可查看', commenter: '可评论' } as Record<string, string>)[role || ''] || (role ? '成员' : '无权限')
}

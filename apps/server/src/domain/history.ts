import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { config } from '../core/config.js'
import type { DocumentRow } from '../core/types.js'
import { schema } from '../lib/schema.js'

type Queryable = Pick<PoolClient, 'query'>
export type HistoryDocument = Pick<DocumentRow, 'id' | 'title' | 'content' | 'version' | 'updated_by' | 'kind'>
export type SnapshotReason = 'baseline' | 'idle' | 'interval' | 'before_restore'
export type HistorySummary = { label: string; added: number; removed: number; titleChanged: boolean; previousTitle?: string }

/** Canonical visible editor state: key order/default-null attrs are not edits. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])
    .filter(([key, item]) => key !== 'attrs' || Object.keys(item as object).length > 0))
}

function node(content: unknown) {
  return schema.nodeFromJSON((content as { doc: unknown }).doc)
}

export function historyFingerprint(title: string, content: unknown): string {
  return createHash('sha256').update(JSON.stringify([title, canonical(node(content).toJSON())])).digest('hex')
}

export function summarizeHistory(previous: { title: string; content: unknown } | undefined, next: { title: string; content: unknown }, reason: SnapshotReason): HistorySummary {
  const before = previous ? Array.from(node(previous.content).textBetween(0, node(previous.content).content.size, '\n')) : []
  const afterNode = node(next.content)
  const after = Array.from(afterNode.textBetween(0, afterNode.content.size, '\n'))
  let start = 0, end = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++
  const left = before.slice(start, before.length - end), right = after.slice(start, after.length - end)
  const exact = left.length * right.length <= 1_000_000
  let common = 0
  if (exact && left.length && right.length) {
    let previous = new Uint32Array(right.length + 1)
    for (const character of left) {
      const current = new Uint32Array(right.length + 1)
      for (let index = 0; index < right.length; index++) current[index + 1] = character === right[index]
        ? previous[index]! + 1 : Math.max(previous[index + 1]!, current[index]!)
      previous = current
    }
    common = previous[right.length]!
  }
  const added = exact ? right.length - common : 0, removed = exact ? left.length - common : 0
  const titleChanged = !!previous && previous.title !== next.title
  const labels = [titleChanged ? '修改标题' : '', !exact ? '修改正文' : '', added ? `新增 ${added} 字` : '', removed ? `删除 ${removed} 字` : ''].filter(Boolean)
  return {
    label: !previous ? '初始版本' : reason === 'before_restore' ? '恢复前备份' : labels.join('，') || '调整格式或结构',
    added, removed, titleChanged, ...(titleChanged ? { previousTitle: previous!.title } : {}),
  }
}

/** Must run while holding this document's SQL row lock. Never removes history. */
export async function saveHistorySnapshot(client: Queryable, document: HistoryDocument, reason: SnapshotReason): Promise<boolean> {
  if (document.kind !== 'document') return false
  const latest = await client.query('SELECT title,content,fingerprint FROM document_versions WHERE document_id=$1 ORDER BY version DESC LIMIT 1', [document.id])
  const previous = latest.rows[0]
  const fingerprint = historyFingerprint(document.title, document.content)
  if (previous && (previous.fingerprint || historyFingerprint(previous.title, previous.content)) === fingerprint) return false
  const summary = summarizeHistory(previous, document, reason)
  const result = await client.query(`INSERT INTO document_versions(document_id,version,title,content,created_by,reason,summary,fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(document_id,version) DO NOTHING RETURNING id`,
  [document.id, document.version, document.title, document.content, document.updated_by, reason, summary, fingerprint])
  return !!result.rowCount
}

/** Auto-save remains immediate; only meaningful changes advance history clocks. */
export async function noteHistoryEdit(client: Queryable, previous: HistoryDocument, next: HistoryDocument): Promise<boolean> {
  if (next.kind !== 'document' || historyFingerprint(previous.title, previous.content) === historyFingerprint(next.title, next.content)) return false
  const exists = await client.query('SELECT 1 FROM document_versions WHERE document_id=$1 LIMIT 1', [next.id])
  if (!exists.rowCount) await saveHistorySnapshot(client, previous, 'baseline')
  await client.query(`INSERT INTO document_history_pending(document_id) VALUES ($1)
    ON CONFLICT(document_id) DO UPDATE SET last_edit_at=now()`, [next.id])
  await checkpointHistoryIfDue(client, next, false)
  return true
}

export async function checkpointHistoryIfDue(client: Queryable, document: HistoryDocument, includeIdle = true): Promise<boolean> {
  const pending = await client.query('SELECT started_at,last_edit_at FROM document_history_pending WHERE document_id=$1', [document.id])
  if (!pending.rowCount) return false
  const elapsed = Date.now() - new Date(pending.rows[0].started_at).getTime()
  const idle = Date.now() - new Date(pending.rows[0].last_edit_at).getTime()
  const reason = elapsed >= config.historyIntervalMs ? 'interval' : includeIdle && idle >= config.historyIdleMs ? 'idle' : null
  if (!reason) return false
  const created = await saveHistorySnapshot(client, document, reason)
  await client.query('DELETE FROM document_history_pending WHERE document_id=$1', [document.id])
  return created
}

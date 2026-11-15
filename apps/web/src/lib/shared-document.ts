import { API } from './api'

export type SharedDocument = {
  id: string
  title: string
  content: { doc?: { type: string; content?: unknown[] } }
  updatedAt: string
  permission: string
}

/** Public reads must revalidate a capability that may have expired or been revoked. */
export async function loadSharedDocument(token: string, signal: AbortSignal): Promise<SharedDocument> {
  const response = await fetch(API + '/api/v1/shared/' + encodeURIComponent(token), { signal, cache: 'no-store' })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 404 || response.status === 400) throw new Error('文档不存在，或分享链接已过期、被撤销。')
    if (response.status === 429) throw new Error('访问过于频繁，请稍后重试。')
    throw new Error('暂时无法加载文档，请稍后重试。')
  }
  if (!data?.document || typeof data.document.title !== 'string' || !data.document.content?.doc) throw new Error('文档数据不完整，请重新加载。')
  return data.document
}

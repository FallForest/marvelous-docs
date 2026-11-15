import type { Comment, CommentAnchorLocation } from './types'

export type CommentThread = { root: Comment; replies: Comment[] }

export function filterCommentThreads(threads: CommentThread[], status: string, author: string, locations: Record<string, CommentAnchorLocation> = {}): CommentThread[] {
  return threads.filter(({ root, replies }) => (author === 'all' || [root, ...replies].some((comment) => comment.userId === author))
    && (status === 'all' || (status === 'detached' ? Boolean(root.anchor && locations[root.id]?.status !== 'attached') : (root.status || 'open') === status)))
}

/** Keep legacy nested replies together without losing orphaned or cyclic rows. */
export function commentThreads(comments: Comment[]): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  const groups = new Map<string, CommentThread>()
  for (const comment of comments) {
    let root = comment
    const visited = new Set([root.id])
    while (root.parentId && byId.has(root.parentId) && !visited.has(root.parentId)) {
      root = byId.get(root.parentId)!
      visited.add(root.id)
    }
    if (root.parentId && visited.has(root.parentId)) root = comment
    const group = groups.get(root.id) ?? { root, replies: [] }
    groups.set(root.id, group)
    if (comment.id !== root.id) group.replies.push(comment)
  }
  return [...groups.values()]
}

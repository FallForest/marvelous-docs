import { untitledCreatedTime } from '../../lib/format'
import type { Doc } from '../../lib/types'

/** Distinguishes empty drafts without putting timestamps into their names. */
export default function DocumentCreatedTime({ doc }: { doc: Pick<Doc, 'title' | 'kind' | 'createdAt'> }) {
  const label = untitledCreatedTime(doc)
  return label ? <time className="untitled-document-time" dateTime={doc.createdAt}>创建于 {label}</time> : null
}

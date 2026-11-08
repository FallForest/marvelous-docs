import type { Doc, DocNode } from './types'

export function buildDocTree(documents: Doc[]): DocNode[] {
  const nodes = new Map(documents.map((doc) => [doc.id, { doc, children: [] as DocNode[] }]))
  const roots: DocNode[] = []
  documents.forEach((doc) => {
    const node = nodes.get(doc.id)!
    const parent = doc.parentId ? nodes.get(doc.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  const sort = (items: DocNode[]) => {
    items.sort((a, b) => Number(a.doc.kind !== 'folder') - Number(b.doc.kind !== 'folder') || a.doc.title.localeCompare(b.doc.title))
    items.forEach((item) => sort(item.children))
  }
  sort(roots)
  return roots
}

export function filterDocTree(nodes: DocNode[], query: string): DocNode[] {
  if (!query) return nodes
  return nodes.flatMap((node) => {
    const children = filterDocTree(node.children, query)
    return node.doc.title.toLowerCase().includes(query) || children.length ? [{ ...node, children }] : []
  })
}

export function flatten(nodes: DocNode[]): Doc[] {
  return nodes.flatMap((node) => [node.doc, ...flatten(node.children)])
}

export function descendantIds(rootId: string, documents: Doc[]): Set<string> {
  const found = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()!
    documents.forEach((doc) => {
      if (doc.parentId === current && !found.has(doc.id)) {
        found.add(doc.id)
        queue.push(doc.id)
      }
    })
  }
  return found
}

export function treeDepth(doc: Doc, byId: Map<string, Doc>): number {
  let depth = 0
  let parent = doc.parentId ? byId.get(doc.parentId) : undefined
  while (parent) {
    depth += 1
    parent = parent.parentId ? byId.get(parent.parentId) : undefined
  }
  return depth
}

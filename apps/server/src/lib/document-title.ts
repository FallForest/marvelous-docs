import { documentNodeFrom } from './markdown/index.js'

export type TitleMode = 'auto' | 'manual'

export const UNTITLED_DOCUMENT = '未命名文档'
export const AUTO_TITLE_MAX_CHARACTERS = 40

type Node = { type?: unknown; attrs?: { level?: unknown }; content?: unknown; text?: unknown }
const OMITTED_NODES = new Set(['codeBlock', 'table', 'image'])

function inlineText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const node = value as Node
  if (OMITTED_NODES.has(String(node.type))) return ''
  if (node.type === 'hardBreak') return '\n'
  if (typeof node.text === 'string') return node.text
  return Array.isArray(node.content) ? node.content.map(inlineText).join('') : ''
}

const clean = (text: string) => text.replace(/\s+/gu, ' ').trim()
const shorten = (text: string) => Array.from(text).slice(0, AUTO_TITLE_MAX_CHARACTERS).join('')

/** H1 takes priority over prose; code, tables and images never name a document. */
export function automaticDocumentTitle(content: unknown): string {
  let heading = ''
  let paragraph = ''
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || heading) return
    const node = value as Node
    if (OMITTED_NODES.has(String(node.type))) return
    if (node.type === 'heading' && node.attrs?.level === 1) {
      heading = clean(inlineText(node))
    } else if ((node.type === 'paragraph' || node.type === 'heading') && !paragraph) {
      paragraph = inlineText(node).split(/\r?\n/u).map(clean).find(Boolean) ?? ''
    }
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(documentNodeFrom(content))
  return shorten(heading || paragraph) || UNTITLED_DOCUMENT
}

/** Call only after locking the current row: a manual rename always wins. */
export function savedDocumentTitle(title: string, titleMode: TitleMode, content: unknown, explicitTitle?: string) {
  if (explicitTitle !== undefined) return { title: explicitTitle, titleMode: 'manual' as const }
  return { title: titleMode === 'auto' ? automaticDocumentTitle(content) : title, titleMode }
}

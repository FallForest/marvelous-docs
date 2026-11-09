import { useCallback, useEffect } from 'react'
import type { Editor } from '@tiptap/react'

export const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
  java: 'Java', go: 'Go', rust: 'Rust', c: 'C', cpp: 'C++', csharp: 'C#',
  ruby: 'Ruby', php: 'PHP', swift: 'Swift', kotlin: 'Kotlin', scala: 'Scala',
  html: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON', yaml: 'YAML',
  toml: 'TOML', xml: 'XML', sql: 'SQL', bash: 'Bash', powershell: 'PowerShell',
  dockerfile: 'Dockerfile', markdown: 'Markdown', plaintext: '纯文本',
}

export const LANGUAGES: string[] = Object.keys(LANG_LABELS)

const COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'

/**
 * Adds language badges and copy buttons to every <pre> in the editor.
 * Runs after each ProseMirror transaction so new code blocks are enhanced too.
 */
export default function CodeBlockEnhancer({ editor }: { editor: Editor | null }) {
  const enhance = useCallback(() => {
    if (!editor?.view?.dom) return
    const root = editor.view.dom
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.dataset.enhanced) return
      pre.dataset.enhanced = 'true'
      const code = pre.querySelector('code')
      const langClass = [...(code?.classList || [])].find((c) => c.startsWith('language-'))
      const lang = langClass?.replace('language-', '') || ''
      pre.dataset.language = lang

      // Language badge (top-left)
      const badge = document.createElement('span')
      badge.className = 'code-lang-badge'
      badge.contentEditable = 'false'
      badge.textContent = LANG_LABELS[lang] || lang || '代码'
      pre.appendChild(badge)

      // Copy button (top-right, appears on hover)
      const copyBtn = document.createElement('button')
      copyBtn.className = 'code-copy-btn'
      copyBtn.type = 'button'
      copyBtn.setAttribute('aria-label', '复制代码')
      copyBtn.title = '复制代码'
      copyBtn.innerHTML = COPY_SVG
      copyBtn.contentEditable = 'false'
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const text = pre.querySelector('code')?.textContent || ''
        try { await navigator.clipboard.writeText(text) } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        copyBtn.innerHTML = CHECK_SVG
        copyBtn.classList.add('copied')
        setTimeout(() => { copyBtn.innerHTML = COPY_SVG; copyBtn.classList.remove('copied') }, 1500)
      })
      pre.appendChild(copyBtn)
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return
    enhance()
    editor.on('update', enhance)
    editor.on('selectionUpdate', enhance)
    return () => { editor.off('update', enhance); editor.off('selectionUpdate', enhance) }
  }, [editor, enhance])

  return null
}

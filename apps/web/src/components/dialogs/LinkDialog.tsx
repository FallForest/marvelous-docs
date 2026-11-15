import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { safeHttpHref } from '../../lib/editor/link-editing'
import type { LinkPrompt } from '../../lib/editor/link-editing'

export default function LinkDialog({ prompt, onSave, onClose }: {
  prompt: LinkPrompt; onSave: (href: string | null) => void; onClose: () => void
}) {
  const [value, setValue] = useState(prompt.href || 'https://')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => { input.current?.focus(); input.current?.select() }, 30)
    return () => window.clearTimeout(timer)
  }, [])
  const existingHref = prompt.href ? safeHttpHref(prompt.href) : null
  const submit = () => {
    if (!safeHttpHref(value)) { setError('请输入完整的 http 或 https 链接'); return }
    onSave(value.trim())
  }
  return <Dialog title={prompt.href ? '编辑链接' : '添加链接'} description="修改链接地址会保留原来的文字；移除链接后文字仍会保留。" confirmLabel={prompt.href ? '保存链接' : '添加链接'} onConfirm={submit} onClose={onClose}>
    <label className="dialog-field"><span>链接地址</span><input ref={input} value={value} onChange={(event) => { setValue(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} aria-invalid={Boolean(error)} aria-describedby={error ? 'link-error' : undefined}/></label>
    {error && <p className="dialog-error" id="link-error" role="alert">{error}</p>}
    {prompt.href && <div className="modal-actions">
      {existingHref && <a className="secondary-btn" href={existingHref} target="_blank" rel="noopener noreferrer">打开当前链接</a>}
      <button type="button" className="secondary-btn" onClick={() => onSave(null)}>移除链接</button>
    </div>}
  </Dialog>
}

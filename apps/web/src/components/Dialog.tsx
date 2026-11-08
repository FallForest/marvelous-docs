import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

type DialogProps = {
  title: string
  description?: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

/** Accessible modal shell: focus trap, Escape to close, backdrop click to close. */
export function Dialog({ title, description, children, confirmLabel = '确定', cancelLabel = '取消', danger = false, busy = false, onConfirm, onClose }: DialogProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    const focusables = () => node ? Array.from(node.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')).filter(el => !el.hasAttribute('disabled')) : []
    focusables()[0]?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  async function submit() {
    setPending(true)
    try { await onConfirm() } finally { setPending(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={description ? 'dialog-description' : undefined}>
      <header>
        <div className={'modal-icon' + (danger ? ' modal-icon-danger' : '')}>{danger ? <AlertTriangle size={18} /> : <Info size={18} />}</div>
        <div className="modal-copy">
          <h2 id="dialog-title">{title}</h2>
          {description && <p id="dialog-description">{description}</p>}
        </div>
        <button type="button" className="icon-btn" aria-label="关闭对话框" onClick={onClose}><X size={17} /></button>
      </header>
      {children}
      <footer className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={pending || busy}>{cancelLabel}</button>
        <button type="button" className={'primary-btn' + (danger ? ' btn-danger' : '')} onClick={() => void submit()} disabled={pending || busy}>{pending || busy ? '处理中…' : confirmLabel}</button>
      </footer>
    </div>
  </div>
}

type PromptDialogProps = {
  title: string
  description?: string
  label: string
  initialValue?: string
  confirmLabel?: string
  busy?: boolean
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void | Promise<void>
  onClose: () => void
}

/** In-app replacement for window.prompt with validation and error feedback. */
export function PromptDialog({ title, description, label, initialValue = '', confirmLabel = '保存', busy = false, validate, onSubmit, onClose }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => { input.current?.focus(); input.current?.select() }, 30)
    return () => window.clearTimeout(timer)
  }, [])

  async function submit() {
    const clean = value.trim()
    const message = validate ? validate(clean) : (clean ? null : '内容不能为空')
    if (message) { setError(message); input.current?.focus(); return }
    setError('')
    await onSubmit(clean)
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="confirm-modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
      <header>
        <div className="modal-copy"><h2 id="prompt-title">{title}</h2>{description && <p>{description}</p>}</div>
        <button type="button" className="icon-btn" aria-label="关闭对话框" onClick={onClose}><X size={17} /></button>
      </header>
      <label className="dialog-field">
        <span>{label}</span>
        <input
          ref={input}
          value={value}
          onChange={(event) => { setValue(event.target.value); if (error) setError('') }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'prompt-error' : undefined}
        />
      </label>
      {error && <p className="dialog-error" id="prompt-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="primary-btn" onClick={() => void submit()} disabled={busy}>{busy ? '保存中…' : confirmLabel}</button>
      </footer>
    </div>
  </div>
}

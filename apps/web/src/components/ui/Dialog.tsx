import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'

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
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const titleId = useId()
  const descriptionId = useId()
  const close = useCallback(() => {
    if (!submitting.current && !busyRef.current) requestClose()
  }, [requestClose])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    /* `a[href]` belongs in the list: a dialog with only a link would otherwise
       trap focus on the close button and make the link unreachable. */
    const focusables = () => node
      ? Array.from(node.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled') && !el.closest('[inert]') && el.offsetParent !== null)
      : []
    focusables()[0]?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      /* capture-and-stop: the shell also listens for Escape to close overlays,
         and without this the dialog would close twice (the second call hit an
         already-unmounting panel). */
      if (event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) { event.preventDefault(); return }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      /* Focus can also land outside the panel (browser chrome, or a click on the
         backdrop), so treat "outside" the same as "past the last element". */
      if (!node?.contains(active)) { event.preventDefault(); first.focus(); return }
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.({ preventScroll: true })
    }
  }, [close])

  async function submit() {
    if (submitting.current || busyRef.current || closing) return
    submitting.current = true
    setPending(true)
    setError('')
    try { await onConfirm() }
    catch (failure) { setError((failure as Error).message || '操作失败，请重试。') }
    finally { submitting.current = false; setPending(false) }
  }

  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div
      ref={panel}
      className={'confirm-modal modal-panel' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={pending || busy}
      onAnimationEnd={onAnimationEnd}
    >
      <header>
        <div className={'modal-icon' + (danger ? ' modal-icon-danger' : '')}>{danger ? <AlertTriangle size={18} /> : <Info size={18} />}</div>
        <div className="modal-copy">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="icon-btn" aria-label="关闭对话框" disabled={pending || busy} onClick={close}><X size={17} /></button>
      </header>
      {children}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <footer className="modal-actions">
        <button type="button" className="secondary-btn" onClick={close} disabled={pending || busy}>{cancelLabel}</button>
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
  const errorId = useId()

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

  return <Dialog title={title} description={description} confirmLabel={confirmLabel} busy={busy} onConfirm={submit} onClose={onClose}>
      <label className="dialog-field">
        <span>{label}</span>
        <input
          ref={input}
          value={value}
          onChange={(event) => { setValue(event.target.value); if (error) setError('') }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('.primary-btn')?.click()
            }
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && <p className="dialog-error" id={errorId} role="alert">{error}</p>}
  </Dialog>
}

import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  description: string
  secondaryDescription?: string
  detailsStyle?: 'command' | 'description'
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger' | 'warning'
  details?: string
  dontShowAgainLabel?: string
  dontShowAgainChecked?: boolean
  onDontShowAgainChange?: (checked: boolean) => void
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  secondaryDescription,
  detailsStyle = 'command',
  confirmLabel,
  cancelLabel,
  variant = 'default',
  details,
  dontShowAgainLabel,
  dontShowAgainChecked,
  onDontShowAgainChange
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Track the element that had focus before the dialog opened
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current()
        return
      }
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}
        onClick={onCancel}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className={`glass-card relative w-full ${detailsStyle === 'description' ? 'max-w-xl' : 'max-w-md'} animate-scale-in rounded-2xl p-6`}
        style={{
          background: 'var(--card-bg)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 var(--glass-inset)'
        }}
      >
        <div className="mb-5 flex items-start gap-4">
          {variant !== 'default' && (
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background:
                  variant === 'danger'
                    ? 'color-mix(in srgb, var(--danger), transparent 88%)'
                    : 'var(--accent-muted-bg)'
              }}
            >
              <AlertTriangle
                className="h-5 w-5"
                style={{ color: variant === 'danger' ? 'var(--danger)' : 'var(--warning)' }}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </div>
          )}
          <div>
            <h3 id="confirm-dialog-title" className="text-[16px] font-semibold text-white">
              {title}
            </h3>
            <p
              id="confirm-dialog-desc"
              className="mt-1.5 text-[14px] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {description}
            </p>
            {secondaryDescription && (
              <p
                className="mt-3 text-[13px] leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {secondaryDescription}
              </p>
            )}
            {dontShowAgainLabel && onDontShowAgainChange && (
              <label
                className="mt-4 flex cursor-pointer items-center gap-2 text-[12px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={dontShowAgainChecked ?? false}
                  onChange={(event) => onDontShowAgainChange(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {dontShowAgainLabel}
              </label>
            )}
            {details && (
              <p
                className={`mt-3 rounded-xl p-3 overflow-y-auto ${detailsStyle === 'description' ? 'whitespace-pre-line break-words text-[13px] leading-relaxed' : 'whitespace-pre-line font-mono text-[11px] break-all'}`}
                style={{
                  background: 'var(--bg-subtle)',
                  color: 'var(--text-secondary)',
                  maxHeight: detailsStyle === 'description' ? '12rem' : '4.5rem'
                }}
              >
                {details}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-subtle-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {cancelLabel ?? t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200"
            style={{
              background:
                variant === 'danger'
                  ? 'color-mix(in srgb, var(--danger), transparent 88%)'
                  : variant === 'warning'
                    ? 'var(--accent-muted-bg)'
                    : 'var(--accent)',
              color:
                variant === 'danger'
                  ? 'var(--danger)'
                  : variant === 'warning'
                    ? 'var(--warning)'
                    : 'var(--text-on-accent)',
              border: `1px solid ${variant === 'danger' ? 'color-mix(in srgb, var(--danger), transparent 68%)' : 'var(--accent-muted-border)'}`
            }}
          >
            {confirmLabel ?? t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

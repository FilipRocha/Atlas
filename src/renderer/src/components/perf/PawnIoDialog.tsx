import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, Loader2, Cpu } from 'lucide-react'
import { toast } from 'sonner'

export const PAWNIO_COMMAND = 'winget install namazso.PawnIO'
const DISMISS_KEY = 'atlas.pawnio.dismissed'

export function isPawnIoDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

interface PawnIoDialogProps {
  open: boolean
  wingetAvailable: boolean
  onClose: () => void
  onInstalled: () => void
}

export function PawnIoDialog({ open, wingetAvailable, onClose, onInstalled }: PawnIoDialogProps) {
  const { t } = useTranslation('performance')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !installing) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, installing])

  if (!open) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PAWNIO_COMMAND)
      toast.success(t('pawnIoCopied'))
    } catch {
      /* clipboard indisponível: o comando continua visível na caixa */
    }
  }

  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      const res = await window.atlas.perfInstallPawnIo()
      if (res.success) {
        toast.success(t('pawnIoInstalled'))
        onInstalled()
        onClose()
      } else {
        setError(t('pawnIoInstallFailed'))
      }
    } catch {
      setError(t('pawnIoInstallFailed'))
    } finally {
      setInstalling(false)
    }
  }

  const dontAsk = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pawnio-title"
    >
      <div
        className="w-full max-w-[460px] rounded-2xl p-6"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="mb-3 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'rgba(245,158,11,0.12)' }}
          >
            <Cpu className="h-5 w-5 text-amber-400" />
          </div>
          <h2 id="pawnio-title" className="text-[15px] font-semibold text-white">
            {t('pawnIoTitle')}
          </h2>
        </div>

        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {t('pawnIoDescription')}
        </p>

        <div className="mb-1 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {t('pawnIoCommandLabel')}
        </div>
        <div
          className="mb-4 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--bg-subtle)' }}
        >
          <code className="select-all text-[12px] text-amber-300">{PAWNIO_COMMAND}</code>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:text-white"
            style={{ background: 'var(--bg-subtle-2)' }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('pawnIoCopy')}
          </button>
        </div>

        {!wingetAvailable && (
          <p className="mb-3 text-[12px] text-amber-400">{t('pawnIoNoWinget')}</p>
        )}
        {error && <p className="mb-3 text-[12px] text-red-400">{error}</p>}

        <div className="flex items-center justify-between">
          <button
            onClick={dontAsk}
            disabled={installing}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            {t('pawnIoDontAsk')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={installing}
              className="rounded-xl px-4 py-2 text-[12px] font-semibold text-zinc-300"
              style={{ background: 'var(--bg-subtle-2)' }}
            >
              {t('pawnIoLater')}
            </button>
            <button
              onClick={install}
              disabled={installing || !wingetAvailable}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-[12px] font-semibold text-black disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {installing ? t('pawnIoInstalling') : t('pawnIoInstall')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

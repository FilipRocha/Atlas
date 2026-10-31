import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck, Loader2, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useWingetStore } from '@/stores/winget-store'
import { usePlatform } from '@/hooks/usePlatform'

/**
 * Feature 14: checks on mount whether Atlas is running elevated and whether
 * winget itself is reachable, and surfaces both as one banner reused by all
 * three winget tabs. Reuses the existing elevationCheck/elevationRelaunch
 * IPC — no new elevation plumbing needed.
 */
export function AdminBanner() {
  const { t } = useTranslation('winget')
  const isWindows = usePlatform().platform === 'win32'
  const prereqs = useWingetStore((s) => s.prereqs)
  const setPrereqs = useWingetStore((s) => s.setPrereqs)
  const [relaunching, setRelaunching] = useState(false)
  const [openingStore, setOpeningStore] = useState(false)
  const checking = useCallback(async () => {
    try {
      setPrereqs(await window.atlas.wingetPrereqs())
    } catch {
      setPrereqs(null)
    }
  }, [setPrereqs])

  useEffect(() => {
    void checking()
    window.addEventListener('focus', checking)
    return () => {
      window.removeEventListener('focus', checking)
    }
  }, [checking])

  if (!isWindows) {
    return (
      <div
        className="mb-4 flex items-start gap-3 rounded-2xl px-5 py-3"
        style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
      >
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" strokeWidth={1.8} />
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('windowsOnly')}
        </p>
      </div>
    )
  }

  if (!prereqs) return null

  if (!prereqs.wingetAvailable) {
    return (
      <div
        className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3"
        style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}
      >
        <ShieldAlert className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
        <p className="min-w-0 flex-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('wingetUnavailable')}
        </p>
        <button
          onClick={async () => {
            setOpeningStore(true)
            try {
              const opened = await window.atlas.wingetOpenStore()
              if (!opened) toast.error(t('wingetStoreOpenFailed'))
            } catch (error) {
              toast.error(t('wingetStoreOpenFailed'), { description: String(error) })
            } finally {
              setOpeningStore(false)
            }
          }}
          disabled={openingStore}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-opacity disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          {openingStore ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {t('installWinget')}
        </button>
        <button
          onClick={() => void checking()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium"
          style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('checkWingetAgain')}
        </button>
      </div>
    )
  }

  if (!prereqs.isAdmin) {
    return (
      <div
        className="mb-4 flex items-center gap-3 rounded-2xl px-5 py-3"
        style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
      >
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="flex-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('adminRequired')}
        </p>
        <button
          onClick={async () => {
            setRelaunching(true)
            try {
              await window.atlas.elevationRelaunch()
            } finally {
              setRelaunching(false)
            }
          }}
          disabled={relaunching}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
          style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
        >
          {relaunching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {t('relaunchAsAdmin')}
        </button>
      </div>
    )
  }

  return null
}

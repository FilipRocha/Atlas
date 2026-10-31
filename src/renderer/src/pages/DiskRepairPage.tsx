import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wrench,
  HardDrive
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { useDiskStore } from '@/stores/disk-store'
import { usePlatform } from '@/hooks/usePlatform'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { RepairCommandCatalog } from '@/components/shared/RepairCommandCatalog'

export function DiskRepairPage() {
  const { t } = useTranslation('disk')
  const { platform } = usePlatform()
  const isWin = platform === 'win32'
  const repairRunning = useDiskStore((s) => s.repairRunning)
  const repairProgress = useDiskStore((s) => s.repairProgress)
  const sfcResult = useDiskStore((s) => s.sfcResult)
  const dismResult = useDiskStore((s) => s.dismResult)
  const chkdskResult = useDiskStore((s) => s.chkdskResult)
  const store = useDiskStore()
  const [showRepairLog, setShowRepairLog] = useState<'sfc' | 'dism' | 'chkdsk' | null>(null)
  const [confirmRepair, setConfirmRepair] = useState<'sfc' | 'dism' | 'chkdsk' | null>(null)

  // Listen for disk repair progress events
  useEffect(() => {
    if (!window.atlas?.onDiskRepairProgress) return
    return window.atlas.onDiskRepairProgress((data) => store.setRepairProgress(data))
  }, [])

  const handleRunSfc = async () => {
    store.setRepairRunning(true)
    store.setSfcResult(null)
    store.setRepairProgress({
      tool: 'sfc',
      phase: 'running',
      percent: 0,
      message: t('startingSfc')
    })
    try {
      const result = await window.atlas.diskRepairSfc('C')
      store.setSfcResult(result)
      if (result.needsAdmin) {
        toast.error(t('adminRequiredToast'), { description: t('adminRequiredSfcDesc') })
      } else if (result.success) {
        toast.success(t('sfcCompletedToast'), { description: result.summary })
      } else {
        toast.error(t('sfcFinishedWithIssuesToast'), { description: result.summary })
      }
    } catch (err) {
      console.error('SFC failed:', err)
      toast.error(t('sfcFailedToast'))
    }
    store.setRepairRunning(false)
    store.setRepairProgress(null)
  }

  const handleRunDism = async () => {
    store.setRepairRunning(true)
    store.setDismResult(null)
    store.setRepairProgress({
      tool: 'dism',
      phase: 'running',
      percent: 0,
      message: t('startingDism')
    })
    try {
      const result = await window.atlas.diskRepairDism()
      store.setDismResult(result)
      if (result.needsAdmin) {
        toast.error(t('adminRequiredToast'), { description: t('adminRequiredDismDesc') })
      } else if (result.success) {
        toast.success(t('dismCompletedToast'), { description: result.summary })
      } else {
        toast.error(t('dismFinishedWithIssuesToast'), { description: result.summary })
      }
    } catch (err) {
      console.error('DISM failed:', err)
      toast.error(t('dismFailedToast'))
    }
    store.setRepairRunning(false)
    store.setRepairProgress(null)
  }

  const handleRunChkdsk = async () => {
    store.setRepairRunning(true)
    store.setChkdskResult(null)
    store.setRepairProgress({
      tool: 'chkdsk',
      phase: 'running',
      percent: 0,
      message: t('startingChkdsk')
    })
    try {
      const result = await window.atlas.diskRepairChkdsk('C')
      store.setChkdskResult(result)
      if (result.needsAdmin) {
        toast.error(t('adminRequiredToast'), { description: t('adminRequiredChkdskDesc') })
      } else if (result.success) {
        toast.success(t('chkdskCompletedToast'), { description: result.summary })
      } else {
        toast.error(t('chkdskFinishedWithIssuesToast'), { description: result.summary })
      }
    } catch (err) {
      console.error('CHKDSK failed:', err)
      toast.error(t('chkdskFailedToast'))
    }
    store.setRepairRunning(false)
    store.setRepairProgress(null)
  }

  if (!isWin) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('repairTitle')} description={t('repairDescription')} />
        <EmptyState
          icon={Wrench}
          title="Windows Only"
          description="Disk repair tools are only available on Windows."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('repairTitle')} description={t('repairDescription')} />

      {/* Info banner */}
      <div
        className="mb-5 rounded-2xl px-5 py-4"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" strokeWidth={1.8} />
          <div>
            <p className="text-[13px] font-medium text-zinc-200">{t('repairTitle')}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {t('repairDescription')} {t('repairRunOrder', { dism: 'DISM', sfc: 'SFC' })}
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {repairRunning && repairProgress && (
        <div
          className="mb-5 rounded-2xl px-5 py-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
            <span className="text-[13px] font-medium text-zinc-200">
              {repairProgress.tool === 'sfc'
                ? t('repairProgressSfc')
                : repairProgress.tool === 'dism'
                  ? t('repairProgressDism')
                  : t('repairProgressChkdsk')}
            </span>
            <span
              className="ml-auto font-mono text-[12px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {repairProgress.percent}%
            </span>
          </div>
          <div className="h-2 rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${repairProgress.percent}%`,
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)'
              }}
            />
          </div>
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {repairProgress.message}
          </p>
        </div>
      )}

      {/* Tool cards */}
      <div className="flex flex-col gap-4">
        {/* DISM card */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(245,158,11,0.1)' }}
              >
                <ShieldCheck className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-zinc-200">{t('dismCardTitle')}</p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {t('commandCatalog.risk.low')}
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('dismCardSubtitle')}
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('dismCardDescription')}
                </p>
                <p
                  className="mt-1 text-[11px] leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('commandCatalog.items.dismRepair.advanced')}
                </p>
              </div>
            </div>
            <button
              onClick={() => setConfirmRepair('dism')}
              disabled={repairRunning}
              className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)',
                color: 'var(--text-on-accent)'
              }}
            >
              {repairRunning && repairProgress?.tool === 'dism' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> {t('dismRunning')}
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" strokeWidth={2} /> {t('runDism')}
                </>
              )}
            </button>
          </div>
          {dismResult && (
            <div
              className="mt-4 rounded-xl px-4 py-3"
              style={{
                background: dismResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${dismResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`
              }}
            >
              <div className="flex items-center gap-2">
                {dismResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" strokeWidth={1.8} />
                ) : dismResult.needsAdmin ? (
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" strokeWidth={1.8} />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.8} />
                )}
                <p className="text-[12px] text-zinc-300">{dismResult.summary}</p>
              </div>
              {dismResult.requiresReboot && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" strokeWidth={2} /> {t('restartRecommended')}
                </p>
              )}
              {dismResult.log && (
                <button
                  onClick={() => setShowRepairLog(showRepairLog === 'dism' ? null : 'dism')}
                  className="mt-2 text-[11px] font-medium text-amber-500 hover:text-amber-400"
                >
                  {showRepairLog === 'dism' ? t('hideLog') : t('showLog')}
                </button>
              )}
              {showRepairLog === 'dism' && dismResult.log && (
                <pre
                  className="mt-2 max-h-48 overflow-auto rounded-lg p-3 font-mono text-[11px]"
                  style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
                >
                  {dismResult.log}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* SFC card */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(245,158,11,0.1)' }}
              >
                <Wrench className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-zinc-200">{t('sfcCardTitle')}</p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {t('commandCatalog.risk.low')}
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('sfcCardSubtitle')}
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('sfcCardDescription')}
                </p>
                <p
                  className="mt-1 text-[11px] leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('commandCatalog.items.sfc.advanced')}
                </p>
              </div>
            </div>
            <button
              onClick={() => setConfirmRepair('sfc')}
              disabled={repairRunning}
              className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)',
                color: 'var(--text-on-accent)'
              }}
            >
              {repairRunning && repairProgress?.tool === 'sfc' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> {t('sfcRunning')}
                </>
              ) : (
                <>
                  <Wrench className="h-4 w-4" strokeWidth={2} /> {t('runSfc')}
                </>
              )}
            </button>
          </div>
          {sfcResult && (
            <div
              className="mt-4 rounded-xl px-4 py-3"
              style={{
                background: sfcResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${sfcResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`
              }}
            >
              <div className="flex items-center gap-2">
                {sfcResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" strokeWidth={1.8} />
                ) : sfcResult.needsAdmin ? (
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" strokeWidth={1.8} />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.8} />
                )}
                <p className="text-[12px] text-zinc-300">{sfcResult.summary}</p>
              </div>
              {sfcResult.requiresReboot && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" strokeWidth={2} /> {t('restartRecommended')}
                </p>
              )}
              {sfcResult.log && (
                <button
                  onClick={() => setShowRepairLog(showRepairLog === 'sfc' ? null : 'sfc')}
                  className="mt-2 text-[11px] font-medium text-amber-500 hover:text-amber-400"
                >
                  {showRepairLog === 'sfc' ? t('hideLog') : t('showLog')}
                </button>
              )}
              {showRepairLog === 'sfc' && sfcResult.log && (
                <pre
                  className="mt-2 max-h-48 overflow-auto rounded-lg p-3 font-mono text-[11px]"
                  style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
                >
                  {sfcResult.log}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* CHKDSK card */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(245,158,11,0.1)' }}
              >
                <HardDrive className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-zinc-200">{t('chkdskCardTitle')}</p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {t('commandCatalog.risk.low')}
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('chkdskCardSubtitle')}
                </p>
                <p
                  className="mt-1 text-[12px] leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('chkdskCardDescription')}
                </p>
                <p
                  className="mt-1 text-[11px] leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('commandCatalog.items.chkdsk.advanced')}
                </p>
              </div>
            </div>
            <button
              onClick={() => setConfirmRepair('chkdsk')}
              disabled={repairRunning}
              className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)',
                color: 'var(--text-on-accent)'
              }}
            >
              {repairRunning && repairProgress?.tool === 'chkdsk' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> {t('chkdskRunning')}
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4" strokeWidth={2} /> {t('runChkdsk')}
                </>
              )}
            </button>
          </div>
          {chkdskResult && (
            <div
              className="mt-4 rounded-xl px-4 py-3"
              style={{
                background: chkdskResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${chkdskResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`
              }}
            >
              <div className="flex items-center gap-2">
                {chkdskResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" strokeWidth={1.8} />
                ) : chkdskResult.needsAdmin ? (
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" strokeWidth={1.8} />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.8} />
                )}
                <p className="text-[12px] text-zinc-300">{chkdskResult.summary}</p>
              </div>
              {chkdskResult.requiresReboot && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" strokeWidth={2} /> {t('restartRecommended')}
                </p>
              )}
              {chkdskResult.log && (
                <button
                  onClick={() => setShowRepairLog(showRepairLog === 'chkdsk' ? null : 'chkdsk')}
                  className="mt-2 text-[11px] font-medium text-amber-500 hover:text-amber-400"
                >
                  {showRepairLog === 'chkdsk' ? t('hideLog') : t('showLog')}
                </button>
              )}
              {showRepairLog === 'chkdsk' && chkdskResult.log && (
                <pre
                  className="mt-2 max-h-48 overflow-auto rounded-lg p-3 font-mono text-[11px]"
                  style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
                >
                  {chkdskResult.log}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>

      <RepairCommandCatalog />

      <ConfirmDialog
        open={confirmRepair !== null}
        onCancel={() => setConfirmRepair(null)}
        onConfirm={() => {
          const action = confirmRepair
          setConfirmRepair(null)
          if (action === 'sfc') void handleRunSfc()
          else if (action === 'dism') void handleRunDism()
          else if (action === 'chkdsk') void handleRunChkdsk()
        }}
        title={
          confirmRepair === 'dism'
            ? t('confirmDismTitle')
            : confirmRepair === 'sfc'
              ? t('confirmSfcTitle')
              : t('confirmChkdskTitle')
        }
        description={t('confirmRepairDescription')}
        secondaryDescription={
          confirmRepair
            ? t(
                `commandCatalog.items.${confirmRepair === 'dism' ? 'dismRepair' : confirmRepair}.advanced`
              )
            : undefined
        }
        details={
          confirmRepair
            ? t(
                `commandCatalog.items.${confirmRepair === 'dism' ? 'dismRepair' : confirmRepair}.command`
              )
            : undefined
        }
        confirmLabel={t('confirmRepairButton')}
        variant="default"
      />
    </div>
  )
}

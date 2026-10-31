import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle2, LoaderCircle, ShieldAlert, XCircle } from 'lucide-react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useDiskStore } from '@/stores/disk-store'
import type { AdvancedRepairResult, AdvancedRepairToolId } from '../../../../shared/types'

type Risk = 'low' | 'medium' | 'high' | 'critical'
type Entry = {
  key: string
  tool?: AdvancedRepairToolId
  risk: Risk
  command?: string
}

const entries: Entry[] = [
  {
    key: 'dismCheck',
    tool: 'dismCheckHealth',
    risk: 'low',
    command: 'DISM /Online /Cleanup-Image /CheckHealth'
  },
  {
    key: 'dismScan',
    tool: 'dismScanHealth',
    risk: 'low',
    command: 'DISM /Online /Cleanup-Image /ScanHealth'
  },
  {
    key: 'netshWinsock',
    tool: 'netshWinsockReset',
    risk: 'medium',
    command: 'netsh winsock reset'
  },
  { key: 'netshTcp', tool: 'netshTcpReset', risk: 'high', command: 'netsh int ip reset' },
  { key: 'ipconfig', tool: 'ipconfigFlushDns', risk: 'low', command: 'ipconfig /flushdns' },
  { key: 'appx', risk: 'high' },
  {
    key: 'winmgmtVerify',
    tool: 'winmgmtVerify',
    risk: 'low',
    command: 'winmgmt /verifyrepository'
  },
  {
    key: 'winmgmtSalvage',
    tool: 'winmgmtSalvage',
    risk: 'high',
    command: 'winmgmt /salvagerepository'
  },
  { key: 'bootrec', risk: 'high' },
  { key: 'bcdboot', risk: 'high' },
  { key: 'reagentc', tool: 'reagentcInfo', risk: 'low', command: 'reagentc /info' },
  { key: 'diskpart', risk: 'critical' },
  { key: 'vssadmin', tool: 'vssListShadows', risk: 'low', command: 'vssadmin list shadows' },
  {
    key: 'powercfg',
    tool: 'powercfgEnergy',
    risk: 'low',
    command: 'powercfg /energy /duration 30'
  },
  { key: 'gpupdate', tool: 'gpupdateForce', risk: 'medium', command: 'gpupdate /force' },
  { key: 'wusa', risk: 'high' },
  { key: 'fsutil', tool: 'fsutilQueryJournal', risk: 'low', command: 'fsutil usn queryjournal C:' },
  { key: 'systemreset', risk: 'high' }
]

const riskStyles: Record<Risk, string> = {
  low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  critical: 'border-red-500/30 bg-red-500/10 text-red-400'
}

export function RepairCommandCatalog() {
  const { t } = useTranslation('disk')
  const [selected, setSelected] = useState<Entry | null>(null)
  const [busyTool, setBusyTool] = useState<AdvancedRepairToolId | null>(null)
  const [result, setResult] = useState<AdvancedRepairResult | null>(null)
  const repairRunning = useDiskStore((state) => state.repairRunning)
  const store = useDiskStore()

  const runSelected = async () => {
    if (!selected?.tool || busyTool || repairRunning) return
    const tool = selected.tool
    setBusyTool(tool)
    store.setRepairRunning(true)
    setResult(null)
    try {
      setResult(await window.atlas.diskRepairAdvanced(tool))
    } catch (error) {
      setResult({
        tool,
        success: false,
        exitCode: null,
        summary: t('commandCatalog.failed'),
        output: error instanceof Error ? error.message : '',
        needsAdmin: false,
        requiresReboot: false
      })
    } finally {
      setBusyTool(null)
      store.setRepairRunning(false)
      setSelected(null)
    }
  }

  return (
    <section className="mt-7">
      <div className="mb-4">
        <h2 className="text-[16px] font-semibold text-zinc-100">{t('commandCatalog.title')}</h2>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {t('commandCatalog.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {entries.map((entry) => {
          const key = `commandCatalog.items.${entry.key}`
          const isBusy = busyTool === entry.tool
          return (
            <article
              key={entry.key}
              className="rounded-2xl p-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-zinc-100">{t(`${key}.name`)}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskStyles[entry.risk]}`}
                    >
                      {t(`commandCatalog.risk.${entry.risk}`)}
                    </span>
                  </div>
                  <p
                    className="mt-2 text-[12px] leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {t(`${key}.simple`)}
                  </p>
                  <p
                    className="mt-1.5 text-[11px] leading-relaxed"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t(`${key}.advanced`)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyTool !== null || repairRunning}
                  onClick={() => setSelected(entry)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-50"
                  style={{ borderColor: 'var(--accent-muted-border)', color: 'var(--accent)' }}
                >
                  {isBusy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : entry.tool ? (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  ) : (
                    <BookOpen className="h-3.5 w-3.5" />
                  )}
                  {t(entry.tool ? 'commandCatalog.execute' : 'commandCatalog.guidance')}
                </button>
              </div>
              {result && result.tool === entry.tool && (
                <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--bg-subtle)' }}>
                  <div className="flex items-center gap-2 text-[12px]">
                    {result.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    <span className="text-zinc-200">
                      {result.needsAdmin
                        ? t('adminRequiredToast')
                        : t(result.success ? 'commandCatalog.completed' : 'commandCatalog.failed')}
                    </span>
                  </div>
                  {result.requiresReboot && (
                    <p className="mt-2 text-[11px] text-amber-400">
                      {t('commandCatalog.restartNeeded')}
                    </p>
                  )}
                  {result.output && (
                    <pre
                      className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {result.output}
                    </pre>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <ConfirmDialog
        open={selected !== null}
        onCancel={() => setSelected(null)}
        onConfirm={() => {
          if (selected?.tool) void runSelected()
          else setSelected(null)
        }}
        title={selected ? t(`commandCatalog.items.${selected.key}.name`) : ''}
        description={selected ? t(`commandCatalog.items.${selected.key}.simple`) : ''}
        secondaryDescription={selected ? t(`commandCatalog.items.${selected.key}.advanced`) : ''}
        detailsStyle={selected?.tool ? 'command' : 'description'}
        details={
          selected?.command ??
          (selected ? t(`commandCatalog.items.${selected.key}.manual`) : undefined)
        }
        confirmLabel={
          selected
            ? t(selected.tool ? 'commandCatalog.confirmExecute' : 'commandCatalog.closeGuidance')
            : undefined
        }
        variant={
          selected?.tool && (selected.risk === 'critical' || selected.risk === 'high')
            ? 'danger'
            : 'warning'
        }
      />
    </section>
  )
}

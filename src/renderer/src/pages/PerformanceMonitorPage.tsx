import { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MonitorUp, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { SystemInfoHeader } from '@/components/perf/SystemInfoHeader'
import { TimeSeriesChart } from '@/components/perf/TimeSeriesChart'
import { AlertBanner } from '@/components/perf/AlertBanner'
import { DiskHealthPanel } from '@/components/perf/DiskHealthPanel'
import { PawnIoDialog, isPawnIoDismissed } from '@/components/perf/PawnIoDialog'
import { ProcessTable } from '@/components/perf/ProcessTable'
import { usePerfStore } from '@/stores/perf-store'
import { formatBytes, formatSpeed } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function PerformanceMonitorPage() {
  const { t } = useTranslation('performance')
  const systemInfo = usePerfStore((s) => s.systemInfo)
  const snapshot = usePerfStore((s) => s.currentSnapshot)
  const history = usePerfStore((s) => s.history)
  const timeRange = usePerfStore((s) => s.timeRange)
  const setSystemInfo = usePerfStore((s) => s.setSystemInfo)
  const pushSnapshot = usePerfStore((s) => s.pushSnapshot)
  const setProcessList = usePerfStore((s) => s.setProcessList)
  const diskHealth = usePerfStore((s) => s.diskHealth)
  const setDiskHealth = usePerfStore((s) => s.setDiskHealth)
  const setMonitoring = usePerfStore((s) => s.setMonitoring)
  const setTimeRange = usePerfStore((s) => s.setTimeRange)
  const reset = usePerfStore((s) => s.reset)

  const [paused, setPaused] = useState(false)
  const [pawnIoOpen, setPawnIoOpen] = useState(false)
  const [wingetAvailable, setWingetAvailable] = useState(true)

  const checkSensorDriver = useCallback(async () => {
    try {
      const status = await window.atlas.perfGetSensorDriverStatus()
      setWingetAvailable(status.wingetAvailable)
      // Só abre quando temos certeza de que o driver está ausente.
      if (status.pawnIoInstalled === false && !isPawnIoDismissed()) setPawnIoOpen(true)
    } catch {
      /* sem verificação: não incomoda o usuário */
    }
  }, [])

  const refreshDiskHealth = useCallback(async () => {
    try {
      setDiskHealth(await window.atlas.perfGetDiskHealth())
    } catch {
      /* mantém o último dado */
    }
  }, [setDiskHealth])

  // Atualiza o estado do disco periodicamente (antes era lido uma única vez)
  useEffect(() => {
    checkSensorDriver()
    // SMART/reliability data changes slowly; avoid re-running system queries
    // while the live performance sampler is active.
    const id = setInterval(refreshDiskHealth, 300000)
    return () => clearInterval(id)
  }, [checkSensorDriver, refreshDiskHealth])

  // Start monitoring on mount
  useEffect(() => {
    let cancelled = false
    let snapshotUnsub: (() => void) | undefined
    let processUnsub: (() => void) | undefined

    const start = async () => {
      try {
        const [info, disks] = await Promise.all([
          window.atlas.perfGetSystemInfo(),
          window.atlas.perfGetDiskHealth()
        ])
        if (cancelled) return
        setSystemInfo(info)
        setDiskHealth(disks)

        snapshotUnsub = window.atlas.onPerfSnapshot((data) => {
          pushSnapshot(data)
        })

        processUnsub = window.atlas.onPerfProcessList((data) => {
          setProcessList(data.processes, data.totalCount)
        })

        await window.atlas.perfStartMonitoring()
        setMonitoring(true)
      } catch {
        toast.error(t('failedToStartToast'))
      }
    }

    start()

    return () => {
      cancelled = true
      snapshotUnsub?.()
      processUnsub?.()
      window.atlas.perfStopMonitoring().catch(() => {})
      reset()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = useCallback(async () => {
    if (paused) {
      await window.atlas.perfStartMonitoring()
      setPaused(false)
    } else {
      await window.atlas.perfStopMonitoring()
      setPaused(true)
    }
  }, [paused])

  const timeRangeOptions: Array<{ value: '60s' | '5m' | '15m'; label: string }> = [
    { value: '60s', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' }
  ]

  return (
    <div className="feature-page performance-page mx-auto max-w-[1320px]">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <>
            {/* Time range pills */}
            <div
              className="flex rounded-lg p-0.5"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              {timeRangeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all',
                    timeRange === opt.value ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                  style={
                    timeRange === opt.value ? { background: 'rgba(245,158,11,0.1)' } : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => window.atlas.perfOpenOverlay()}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{
                background: 'rgba(245,158,11,0.1)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.2)'
              }}
            >
              <MonitorUp className="h-4 w-4" />
              Monitor sobreposto
            </button>

            {/* Pause/Resume */}
            <button
              onClick={togglePause}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{
                background: paused ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle-2)',
                color: paused ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${paused ? 'rgba(34,197,94,0.2)' : 'var(--border-medium)'}`
              }}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? t('resume') : t('pause')}
            </button>
          </>
        }
      />

      <SystemInfoHeader info={systemInfo} uptime={snapshot?.uptime ?? 0} />

      <AlertBanner snapshot={snapshot} history={history} />

      {/* Gauges */}
      <div className="pulse-performance-metrics">
        <GaugeCard
          label={t('gaugeCpu')}
          percent={snapshot?.cpu.overall ?? null}
          detail={
            snapshot
              ? t('cpuThreadsDetail', { count: snapshot.cpu.perCore.length })
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeMemory')}
          percent={snapshot?.memory.percent ?? null}
          detail={
            snapshot
              ? `${formatBytes(snapshot.memory.usedBytes, 1)} / ${formatBytes(snapshot.memory.totalBytes, 1)}`
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label="GPU"
          percent={snapshot?.gpu?.[0]?.loadPercent ?? null}
          value={
            snapshot?.gpu?.[0]?.loadPercent != null
              ? `${Math.round(snapshot.gpu[0].loadPercent)}%`
              : '?'
          }
          detail={snapshot?.gpu?.[0]?.name ?? 'Sem dados de GPU'}
        />
        <GaugeCard
          label={t('gaugeDiskIo')}
          percent={snapshot?.disk.busyPercent ?? null}
          value={
            snapshot
              ? formatSpeed(snapshot.disk.readBytesPerSec + snapshot.disk.writeBytesPerSec)
              : '?'
          }
          detail={
            snapshot
              ? `${t('diskIoDetail', { read: formatSpeed(snapshot.disk.readBytesPerSec), write: formatSpeed(snapshot.disk.writeBytesPerSec) })} · Atividade ${snapshot.disk.busyPercent != null ? `${Math.round(snapshot.disk.busyPercent)}%` : 'sem sensor'}`
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label="Temperaturas"
          percent={null}
          value={
            snapshot?.temperature?.cpu != null
              ? `CPU ${Math.round(snapshot.temperature.cpu)}°C`
              : 'CPU: --'
          }
          detail={`${snapshot?.temperature?.gpu != null ? `GPU ${Math.round(snapshot.temperature.gpu)}°C` : 'GPU: --'}${
            snapshot?.temperature?.cpu == null || snapshot?.temperature?.gpu == null
              ? ` (${snapshot?.sensorHint || 'sensor indisponível'})`
              : ''
          }`}
        />
        <GaugeCard
          label={t('gaugeNetwork')}
          percent={null}
          value={
            snapshot
              ? formatSpeed(snapshot.network.rxBytesPerSec + snapshot.network.txBytesPerSec)
              : '?'
          }
          detail={
            snapshot
              ? `${formatSpeed(snapshot.network.rxBytesPerSec)} / ${formatSpeed(snapshot.network.txBytesPerSec)}`
              : t('noDataPlaceholder')
          }
        />
      </div>

      {/* Charts */}
      <div className="pulse-performance-charts">
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="cpu"
          label={t('chartCpuUsage')}
          color="var(--accent)"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="memory"
          label={t('chartMemoryUsage')}
          color="var(--success)"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="disk"
          label={t('chartDiskIo')}
          color="var(--info)"
        />
      </div>

      {/* Disk Health */}
      <DiskHealthPanel disks={diskHealth} />

      {/* Process Table */}
      <ProcessTable />

      <PawnIoDialog
        open={pawnIoOpen}
        wingetAvailable={wingetAvailable}
        onClose={() => setPawnIoOpen(false)}
        onInstalled={() => {
          setTimeout(refreshDiskHealth, 5000)
        }}
      />
    </div>
  )
}

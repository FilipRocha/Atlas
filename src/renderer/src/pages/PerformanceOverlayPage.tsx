import { useEffect, useMemo, useState } from 'react'
import { Grip, Pin, PinOff, Settings2, X } from 'lucide-react'
import type { PerfOverlayStats } from '../../../shared/types'
import { formatBytes, formatSpeed } from '@/lib/utils'

const DEFAULT_METRICS = {
  cpu: true,
  memory: true,
  disk: true,
  network: true,
  gpu: true,
  temperature: true
}

type MetricKey = keyof typeof DEFAULT_METRICS
type LayoutMode = 'auto' | 'two' | 'one'

const LABELS: Record<MetricKey, string> = {
  cpu: 'CPU',
  memory: 'Memória',
  disk: 'Discos',
  network: 'Ethernet',
  gpu: 'GPU',
  temperature: 'Temperaturas'
}

export function PerformanceOverlayPage() {
  const [stats, setStats] = useState<PerfOverlayStats | null>(null)
  const [pinned, setPinned] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTopBar, setShowTopBar] = useState(true)
  const [metrics, setMetrics] = useState(DEFAULT_METRICS)
  const [layout, setLayout] = useState<LayoutMode>('auto')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('atlas:performance-overlay-metrics')
      if (stored) {
        const loaded = { ...DEFAULT_METRICS, ...JSON.parse(stored) }
        setMetrics(loaded)
        for (const key of Object.keys(DEFAULT_METRICS) as MetricKey[]) {
          void window.atlas.perfOverlaySetMetric(key, Boolean(loaded[key])).catch(() => {})
        }
      }
      const storedLayout = localStorage.getItem(
        'atlas:performance-overlay-layout'
      ) as LayoutMode | null
      if (storedLayout === 'auto' || storedLayout === 'one' || storedLayout === 'two')
        setLayout(storedLayout)
      const storedBar = localStorage.getItem('atlas:performance-overlay-topbar')
      if (storedBar !== null) setShowTopBar(storedBar !== 'hidden')
    } catch {
      // Ignore malformed preferences.
    }

    window.atlas
      .perfOverlayGetAlwaysOnTop()
      .then(setPinned)
      .catch(() => {})

    const removeCommandListener = window.atlas.onPerfOverlayCommand((command) => {
      if (command.type === 'top-bar' && typeof command.visible === 'boolean') {
        setShowTopBar(command.visible)
        localStorage.setItem(
          'atlas:performance-overlay-topbar',
          command.visible ? 'visible' : 'hidden'
        )
      }
      if (command.type === 'pin' && typeof command.enabled === 'boolean') setPinned(command.enabled)
      if (
        command.type === 'metric' &&
        typeof command.key === 'string' &&
        typeof command.enabled === 'boolean' &&
        command.key in DEFAULT_METRICS
      ) {
        const key = command.key as MetricKey
        setMetrics((current) => {
          const next = { ...current, [key]: command.enabled }
          localStorage.setItem('atlas:performance-overlay-metrics', JSON.stringify(next))
          return next
        })
      }
    })

    const refresh = () =>
      window.atlas
        .perfGetOverlayStats()
        .then(setStats)
        .catch(() => {})
    refresh()
    const timer = window.setInterval(refresh, 2000)

    return () => {
      window.clearInterval(timer)
      removeCommandListener()
    }
  }, [])

  const togglePinned = async () => {
    try {
      // Ask Electron for the actual state instead of trusting stale React state.
      const current = await window.atlas.perfOverlayGetAlwaysOnTop()
      const actual = await window.atlas.perfOverlaySetAlwaysOnTop(!current)
      setPinned(actual)
    } catch {
      // Ignore if the window is closing.
    }
  }

  const setMetric = (key: MetricKey) => {
    setMetrics((current) => {
      const next = { ...current, [key]: !current[key] }
      localStorage.setItem('atlas:performance-overlay-metrics', JSON.stringify(next))
      void window.atlas.perfOverlaySetMetric(key, next[key]).catch(() => {})
      return next
    })
  }

  const cards = useMemo(() => {
    if (!stats) return []
    const result: Array<{
      id: string
      label: string
      value: string
      detail?: string
      hint?: string
    }> = []

    if (metrics.cpu)
      result.push({
        id: 'cpu',
        label: 'CPU',
        value: stats.cpu == null ? '--' : `${Math.round(stats.cpu)}%`
      })
    if (metrics.memory) {
      result.push({
        id: 'memory',
        label: 'RAM',
        value: `${Math.round(stats.memory.percent)}%`,
        detail: `${formatBytes(stats.memory.usedBytes, 1)} / ${formatBytes(stats.memory.totalBytes, 1)}`
      })
    }
    if (metrics.disk) {
      const io = stats.diskIo
      if (io) {
        const busy = io.busyPercent == null ? '--' : `${Math.round(io.busyPercent)}%`
        result.push({
          id: 'disk-io',
          label: 'Discos',
          value: formatSpeed(io.readBytesPerSec + io.writeBytesPerSec),
          detail: `L: ${formatSpeed(io.readBytesPerSec)} / G: ${formatSpeed(io.writeBytesPerSec)} · Atividade ${busy}`
        })
      }
      stats.disks.slice(0, 8).forEach((disk) => {
        result.push({
          id: `disk-${disk.mount}`,
          label: `Disco ${disk.mount}`,
          value: `${Math.round(disk.percent)}%`,
          detail: `${formatBytes(disk.usedBytes, 0)} / ${formatBytes(disk.sizeBytes, 0)} usados`
        })
      })
      if (!io && stats.disks.length === 0) {
        result.push({ id: 'disk-none', label: 'Discos', value: '--', detail: 'sem dados' })
      }
    }
    if (metrics.network) {
      result.push({
        id: 'network',
        label: 'Ethernet',
        value: formatSpeed(stats.network.rxBytesPerSec + stats.network.txBytesPerSec),
        detail: `↓ ${formatSpeed(stats.network.rxBytesPerSec)}  ↑ ${formatSpeed(stats.network.txBytesPerSec)}`
      })
    }
    if (metrics.gpu) {
      const gpu = stats.gpu[0]
      result.push({
        id: 'gpu',
        label: 'GPU',
        value: gpu?.loadPercent == null ? '--' : `${Math.round(gpu.loadPercent)}%`,
        detail: gpu?.name || 'sem dados'
      })
    }
    if (metrics.temperature) {
      const cpu = stats.cpuTemperature == null ? '--' : `${Math.round(stats.cpuTemperature)}°C`
      const gpu =
        stats.gpu[0]?.temperature == null ? '--' : `${Math.round(stats.gpu[0].temperature)}°C`
      const missing = stats.cpuTemperature == null || stats.gpu[0]?.temperature == null
      result.push({
        id: 'temperature',
        label: 'Temperaturas',
        value: `CPU: ${cpu}`,
        detail: `GPU: ${gpu}`,
        hint: missing && stats.sensorHint ? stats.sensorHint : undefined
      })
    }
    return result
  }, [metrics, stats])

  const chooseLayout = (next: LayoutMode) => {
    setLayout(next)
    localStorage.setItem('atlas:performance-overlay-layout', next)
  }

  return (
    <div
      className="h-screen w-screen min-h-0 min-w-0 select-none overflow-hidden p-0.5 text-zinc-100"
      style={{ background: 'transparent', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-xl">
        {showTopBar && (
          <div
            className="flex min-h-9 shrink-0 items-center justify-between border-b border-white/10 px-2 py-1"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div className="flex min-w-0 items-start gap-1.5 text-[11px] font-semibold text-zinc-300">
              <Grip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <div className="truncate">Atlas Monitor</div>
                <div className="truncate text-[9px] font-normal text-zinc-500">
                  Acompanhe os principais recursos do computador.
                </div>
              </div>
            </div>
            <div
              className="flex shrink-0 items-center gap-1"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button
                onClick={() => setShowSettings((value) => !value)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                title="Configurar"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={togglePinned}
                className={`rounded-md p-1.5 hover:bg-white/10 hover:text-white ${pinned ? 'text-amber-300' : 'text-zinc-400'}`}
                title={pinned ? 'Tirar da sobreposição' : 'Manter sobreposto'}
              >
                {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => window.atlas.perfOverlayClose()}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/20 hover:text-red-300"
                title="Fechar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="shrink-0 border-b border-white/10 p-2">
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(metrics) as MetricKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setMetric(key)}
                  className={`min-w-0 rounded-lg border px-2 py-1.5 text-[10px] ${metrics[key] ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-zinc-500'}`}
                >
                  <span className="block truncate">{LABELS[key]}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(
                [
                  ['auto', 'Automático'],
                  ['two', '2 colunas'],
                  ['one', '1 coluna']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => chooseLayout(value)}
                  className={`min-w-0 rounded-lg border px-2 py-1.5 text-[10px] ${layout === value ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-zinc-500'}`}
                >
                  <span className="block truncate">{label}</span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-[9px] leading-3 text-zinc-500">
              Automático adapta as colunas ao espaço disponível. Redimensionar com o mouse não será
              desfeito.
            </div>
          </div>
        )}

        <div
          className="min-h-0 min-w-0 flex-1 overflow-auto p-1.5"
          style={
            {
              display: 'grid',
              gridTemplateColumns:
                layout === 'one'
                  ? 'minmax(0, 1fr)'
                  : layout === 'two'
                    ? 'repeat(2, minmax(0, 1fr))'
                    : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
              gridAutoRows: 'max-content',
              alignContent: 'start',
              gap: 6,
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties
          }
        >
          {cards.map((card) => (
            <div
              key={card.id}
              className={`min-w-0 max-w-full overflow-hidden rounded-xl border border-white/8 bg-white/[0.045] px-2.5 py-2 ${card.id === 'gpu' ? 'min-h-[48px] py-1.5' : ''}`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div className="min-w-0 max-w-full whitespace-normal break-words text-[9px] uppercase tracking-wider text-zinc-500">
                {card.label}
              </div>
              <div
                className={`mt-0.5 min-w-0 max-w-full whitespace-normal break-words font-semibold leading-5 text-zinc-100 ${card.id === 'gpu' ? 'text-[13px]' : 'text-[16px]'}`}
              >
                {card.value}
              </div>
              {card.detail && (
                <div className="mt-0.5 min-w-0 max-w-full whitespace-normal break-words text-[9px] leading-3 text-zinc-500">
                  {card.detail}
                </div>
              )}
              {card.hint && (
                <div className="mt-0.5 min-w-0 max-w-full whitespace-normal break-words text-[9px] leading-3 text-amber-400/80">
                  {card.hint}
                </div>
              )}
            </div>
          ))}
          {!cards.length && (
            <div className="col-span-full flex items-center justify-center py-8 text-xs text-zinc-500">
              Carregando monitoramento...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

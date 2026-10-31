import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  Code2,
  Download,
  Gamepad2,
  Loader2,
  PackageCheck,
  Search,
  Sparkles,
  X,
  CircleDashed,
  CircleX,
  Copy,
  FileText,
  BriefcaseBusiness,
  FolderOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { AdminBanner } from '@/components/winget/AdminBanner'
import { WingetIcon } from '@/components/winget/WingetIcon'
import { useWingetStore } from '@/stores/winget-store'
import { formatBytes } from '@/lib/utils'
import {
  SOFTWARE_CATALOG,
  SOFTWARE_KITS,
  type KitId,
  type SoftwareCatalogEntry
} from '@shared/software-catalog'
import type { DriveInfo } from '@shared/types'

const DEBOUNCE_MS = 400
const DEFAULT_INSTALL_PARENT = 'C:\\Program Files'
const LAST_BATCH_REPORT_KEY = 'atlas:winget:last-batch-report'

interface BatchReportItem {
  id: string
  name: string
  status: 'installed' | 'failed' | 'notStarted'
  details?: string
}

interface BatchInstallReport {
  finishedAt: string
  items: BatchReportItem[]
}

function readLastBatchReport(): BatchInstallReport | null {
  try {
    const raw = localStorage.getItem(LAST_BATCH_REPORT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BatchInstallReport>
    if (typeof parsed.finishedAt !== 'string' || !Array.isArray(parsed.items)) return null
    const items = parsed.items.filter(
      (item): item is BatchReportItem =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (item.status === 'installed' || item.status === 'failed' || item.status === 'notStarted') &&
        (item.details === undefined || typeof item.details === 'string')
    )
    return { finishedAt: parsed.finishedAt, items }
  } catch {
    return null
  }
}

const kitIcons: Record<KitId, typeof Sparkles> = {
  basico: Sparkles,
  dev: Code2,
  gamer: Gamepad2,
  escritorio: BriefcaseBusiness
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function installTargetPath(parent: string | null, appName: string): string | null {
  if (!parent) return null
  const folder = appName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  if (!folder) return parent
  const leaf = parent.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  return normalize(leaf) === normalize(folder)
    ? parent
    : `${parent.replace(/[\\/]+$/g, '')}\\${folder}`
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function getSimilarEntries(query: string): SoftwareCatalogEntry[] {
  const q = normalize(query)
  if (!q) return []
  return SOFTWARE_CATALOG.map((entry) => {
    const candidates = [normalize(entry.name), normalize(entry.id), normalize(entry.wingetId)]
    const distance = Math.min(...candidates.map((candidate) => levenshtein(q, candidate)))
    const contains = candidates.some((candidate) => candidate.includes(q) || q.includes(candidate))
    const score = contains ? 0 : distance / Math.max(q.length, 1)
    return { entry, score, distance }
  })
    .filter(
      ({ score, distance }) => distance <= Math.max(2, Math.floor(q.length * 0.35)) || score === 0
    )
    .sort((a, b) => a.score - b.score || a.distance - b.distance)
    .slice(0, 5)
    .map(({ entry }) => entry)
}

export function WingetSearchPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('winget')
  const query = useWingetStore((s) => s.searchQuery)
  const setQuery = useWingetStore((s) => s.setSearchQuery)
  const result = useWingetStore((s) => s.searchResult)
  const setResult = useWingetStore((s) => s.setSearchResult)
  const status = useWingetStore((s) => s.searchStatus)
  const setStatus = useWingetStore((s) => s.setSearchStatus)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [batchInstalling, setBatchInstalling] = useState(false)
  const [selectedKit, setSelectedKit] = useState<KitId>('basico')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingInstall, setPendingInstall] = useState<{ id: string; name: string } | null>(null)
  const [installLocation, setInstallLocation] = useState<string | null>(null)
  const [installDrives, setInstallDrives] = useState<DriveInfo[]>([])
  const [batchQueue, setBatchQueue] = useState<Array<{ id: string; name: string }>>([])
  const [batchCounts, setBatchCounts] = useState({ succeeded: 0, failed: 0 })
  const [batchReport, setBatchReport] = useState<BatchInstallReport | null>(readLastBatchReport)
  const [cancelBatchAfterCurrent, setCancelBatchAfterCurrent] = useState(false)
  const [activeInstall, setActiveInstall] = useState<{
    name: string
    current: number
    total: number
    remaining: number
    batch: boolean
    percent: number | null
  } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSeq = useRef(0)
  const cancelBatchRef = useRef(false)

  useEffect(() => {
    return window.atlas.onWingetOperationProgress((data) => {
      if (data.op !== 'install') return
      setActiveInstall((current) => {
        if (!current) return current
        return { ...current, percent: data.percent >= 0 ? data.percent : current.percent }
      })
    })
  }, [])

  const selectedEntries = useMemo(
    () => SOFTWARE_CATALOG.filter((entry) => entry.kits.includes(selectedKit)),
    [selectedKit]
  )
  const similarEntries = useMemo(
    () => (result?.items.length ? [] : getSimilarEntries(query)),
    [query, result]
  )

  const runSearch = useCallback(
    async (term: string) => {
      if (!term.trim()) {
        setResult(null)
        setStatus('idle')
        return
      }
      const seq = ++requestSeq.current
      setStatus('loading')
      try {
        const res = await window.atlas.wingetSearch(term)
        if (seq !== requestSeq.current) return
        setResult(res)
        setStatus('done')
        // A typo or an empty catalog match is expected during normal use.
        // Keep the explanation inline instead of showing a noisy error toast.
      } catch (err) {
        console.error('winget search failed:', err)
        if (seq !== requestSeq.current) return
        setResult({
          query: term.trim(),
          items: [],
          truncated: false,
          durationMs: 0,
          error: String(err)
        })
        setStatus('done')
      }
    },
    [setResult, setStatus]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  const installOne = useCallback(
    async (id: string, name: string, location?: string, quiet = false) => {
      setInstallingId(id)
      try {
        const res = await window.atlas.wingetInstall(id, name, location)
        if (res.success) {
          if (!quiet) toast.success(t('search.installSuccess', { name }))
          return { success: true as const }
        }
        const error =
          res.error === 'needs-admin'
            ? t('adminRequired')
            : res.error || t('search.installFailed', { name })
        if (!quiet) {
          if (res.error === 'needs-admin') {
            toast.error(t('search.installFailed', { name }), { description: t('adminRequired') })
          } else {
            toast.error(t('search.installFailed', { name }), { description: error })
          }
        }
        return { success: false as const, error }
      } catch (err) {
        const error = String(err)
        if (!quiet) toast.error(t('search.installFailed', { name }), { description: error })
        return { success: false as const, error }
      } finally {
        setInstallingId(null)
      }
    },
    [t]
  )

  const beginInstall = useCallback((id: string, name: string) => {
    setBatchQueue([])
    setInstallLocation(DEFAULT_INSTALL_PARENT)
    setInstallDrives([])
    setPendingInstall({ id, name })
    void window.atlas
      .diskDrives()
      .then(setInstallDrives)
      .catch(() => setInstallDrives([]))
  }, [])

  const chooseInstallLocation = useCallback(async () => {
    try {
      const location = await window.atlas.wingetSelectInstallDir(
        t('search.chooseFolderDialogTitle')
      )
      if (location) setInstallLocation(location)
    } catch (err) {
      toast.error(t('search.folderPickerFailed'), { description: String(err) })
    }
  }, [t])

  const confirmInstall = useCallback(async () => {
    if (!pendingInstall) return
    const isBatch = batchQueue.length > 0
    const queue = isBatch ? batchQueue : [pendingInstall]
    const location = installLocation ?? DEFAULT_INSTALL_PARENT
    setPendingInstall(null)
    cancelBatchRef.current = false
    setCancelBatchAfterCurrent(false)
    let succeeded = 0
    let failed = 0
    const reportItems: BatchReportItem[] = []

    for (let index = 0; index < queue.length; index++) {
      if (cancelBatchRef.current) break
      const item = queue[index]
      if (!item) continue

      setActiveInstall({
        name: item.name,
        current: index + 1,
        total: queue.length,
        remaining: Math.max(0, queue.length - index - 1),
        batch: isBatch,
        percent: null
      })
      const result = await installOne(item.id, item.name, location, isBatch)
      if (result.success) {
        succeeded++
        reportItems.push({ id: item.id, name: item.name, status: 'installed' })
      } else {
        failed++
        reportItems.push({
          id: item.id,
          name: item.name,
          status: 'failed',
          details: result.error
        })
      }
      setBatchCounts({ succeeded, failed })
      if (isBatch) setBatchQueue(queue.slice(index + 1))
    }

    const cancelled = cancelBatchRef.current
    setActiveInstall(null)
    setInstallLocation(DEFAULT_INSTALL_PARENT)
    setBatchQueue([])
    setBatchInstalling(false)
    setCancelBatchAfterCurrent(false)
    cancelBatchRef.current = false

    if (isBatch) {
      if (cancelled) {
        for (const item of queue.slice(reportItems.length)) {
          reportItems.push({
            id: item.id,
            name: item.name,
            status: 'notStarted',
            details: t('search.batchReportNotStartedReason')
          })
        }
      }
      const report = { finishedAt: new Date().toISOString(), items: reportItems }
      setBatchReport(report)
      try {
        localStorage.setItem(LAST_BATCH_REPORT_KEY, JSON.stringify(report))
      } catch {
        // The current report remains visible even if browser storage is unavailable.
      }

      const counts = { succeeded, failed }
      if (cancelled) toast.warning(t('search.batchStopped', counts))
      else if (failed === 0) toast.success(t('search.batchSuccess', { count: succeeded }))
      else toast.warning(t('search.batchPartial', counts))
    }
  }, [batchQueue, installOne, installLocation, pendingInstall, t])

  const cancelPendingInstall = useCallback(() => {
    if (batchInstalling && activeInstall?.batch) {
      cancelBatchRef.current = true
      setCancelBatchAfterCurrent(true)
      return
    }
    const wasBatch = batchQueue.length > 0
    setPendingInstall(null)
    setActiveInstall(null)
    setInstallLocation(DEFAULT_INSTALL_PARENT)
    setBatchQueue([])
    setCancelBatchAfterCurrent(false)
    cancelBatchRef.current = false
    if (wasBatch) {
      setBatchInstalling(false)
      if (batchCounts.succeeded || batchCounts.failed) {
        toast.warning(t('search.batchCancelled', batchCounts))
      }
    }
  }, [activeInstall, batchCounts, batchInstalling, batchQueue.length, t])

  const handleBatchInstall = useCallback(() => {
    const entries = selectedEntries.filter((entry) => selectedIds.has(entry.id))
    if (!entries.length) return
    setBatchInstalling(true)
    cancelBatchRef.current = false
    setCancelBatchAfterCurrent(false)
    const queue = entries.map((entry) => ({ id: entry.wingetId, name: entry.name }))
    setBatchCounts({ succeeded: 0, failed: 0 })
    setBatchQueue(queue)
    setInstallLocation(DEFAULT_INSTALL_PARENT)
    setPendingInstall(queue[0])
    void window.atlas
      .diskDrives()
      .then(setInstallDrives)
      .catch(() => setInstallDrives([]))
    setSelectedIds(new Set())
  }, [selectedEntries, selectedIds])

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds((current) => {
      const allSelected = selectedEntries.every((entry) => current.has(entry.id))
      return allSelected ? new Set() : new Set(selectedEntries.map((entry) => entry.id))
    })
  }

  const selectKit = (kit: KitId) => {
    setSelectedKit(kit)
    setSelectedIds(new Set())
  }

  const clearSearch = () => setQuery('')
  const isLoading = status === 'loading'
  const showingCatalog = !query.trim() && !result
  const allSelected =
    selectedEntries.length > 0 && selectedEntries.every((entry) => selectedIds.has(entry.id))
  const batchReportCounts = batchReport?.items.reduce(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { installed: 0, failed: 0, notStarted: 0 }
  ) ?? { installed: 0, failed: 0, notStarted: 0 }

  const copyBatchReport = async () => {
    if (!batchReport) return
    const lines = [
      t('search.batchReportTitle'),
      t('search.batchReportFinishedAt', {
        date: new Date(batchReport.finishedAt).toLocaleString()
      }),
      t('search.batchReportSummary', batchReportCounts),
      ...batchReport.items.map((item) => {
        const status = t(
          `search.batchReport${item.status[0]?.toUpperCase()}${item.status.slice(1)}`
        )
        return `${status}: ${item.name}${item.details ? `\n  ${item.details}` : ''}`
      })
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success(t('search.batchReportCopied'))
    } catch {
      toast.error(t('search.batchReportCopyFailed'))
    }
  }

  const dismissBatchReport = () => {
    setBatchReport(null)
    try {
      localStorage.removeItem(LAST_BATCH_REPORT_KEY)
    } catch {
      // The report still closes when browser storage is unavailable.
    }
  }

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader title={t('search.pageTitle')} description={t('search.pageDescription')} />
      )}

      <AdminBanner />

      {activeInstall && (
        <section
          aria-live="polite"
          className="mb-4 rounded-2xl px-4 py-3.5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
        >
          <div className="flex items-start gap-3">
            <Loader2
              className="mt-0.5 h-5 w-5 shrink-0 animate-spin"
              style={{ color: 'var(--accent)' }}
            />
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-[13px] font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('search.installingNow', { name: activeInstall.name })}
              </p>
              {activeInstall.batch && (
                <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                  {t('search.batchProgress', {
                    current: activeInstall.current,
                    total: activeInstall.total
                  })}
                  {' · '}
                  {activeInstall.remaining > 0
                    ? t('search.remainingAfterCurrent', { count: activeInstall.remaining })
                    : t('search.lastInBatch')}
                </p>
              )}
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {activeInstall.percent === null
                  ? t('search.installProgressWaiting', { name: activeInstall.name })
                  : t('search.installProgressPercent', { percent: activeInstall.percent })}
              </p>
            </div>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--bg-subtle-2)' }}
          >
            {activeInstall.percent === null ? (
              <div
                className="h-full w-1/3 animate-pulse rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            ) : (
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${activeInstall.percent}%`, background: 'var(--accent)' }}
              />
            )}
          </div>
          {activeInstall.batch && activeInstall.remaining > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={cancelPendingInstall}
                disabled={cancelBatchAfterCurrent}
                className="rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
                style={{
                  background: 'var(--bg-subtle-2)',
                  color: 'var(--text-secondary)'
                }}
              >
                {cancelBatchAfterCurrent
                  ? t('search.cancellingBatch')
                  : t('search.cancelAfterCurrent')}
              </button>
            </div>
          )}
        </section>
      )}

      {batchReport && (
        <section
          aria-live="polite"
          className="mb-5 overflow-hidden rounded-2xl"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
        >
          <div
            className="flex flex-wrap items-center gap-3 px-4 py-3"
            style={{
              background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--border-subtle)'
            }}
          >
            <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('search.batchReportTitle')}
              </h3>
              <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {t('search.batchReportFinishedAt', {
                  date: new Date(batchReport.finishedAt).toLocaleString()
                })}
                {' · '}
                {t('search.batchReportSummary', batchReportCounts)}
              </p>
            </div>
            <button
              onClick={() => void copyBatchReport()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
            >
              <Copy size={13} />
              {t('search.batchReportCopy')}
            </button>
            <button
              onClick={dismissBatchReport}
              aria-label={t('search.batchReportClose')}
              className="rounded-lg p-1.5"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={15} />
            </button>
          </div>
          <div
            className="max-h-72 divide-y overflow-y-auto"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {batchReport.items.map((item) => {
              const status =
                item.status === 'installed'
                  ? {
                      label: t('search.batchReportInstalled'),
                      color: 'var(--success, #34d399)',
                      Icon: CheckCircle2
                    }
                  : item.status === 'failed'
                    ? {
                        label: t('search.batchReportFailed'),
                        color: 'var(--danger, #f87171)',
                        Icon: CircleX
                      }
                    : {
                        label: t('search.batchReportNotStarted'),
                        color: 'var(--text-muted)',
                        Icon: CircleDashed
                      }
              const Icon = status.Icon
              return (
                <div
                  key={`${item.id}:${item.name}`}
                  className="flex items-start gap-2.5 px-4 py-2.5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: status.color }} />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[12px] font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {item.name}
                    </p>
                    {item.details && (
                      <p
                        className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {item.details}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium"
                    style={{ color: status.color, background: 'var(--bg-subtle-2)' }}
                  >
                    {status.label}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div
        className="mb-4 flex items-center gap-2.5 rounded-2xl px-4 py-2.5"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
      >
        <Search
          className="h-4 w-4 shrink-0"
          style={{ color: 'var(--text-muted)' }}
          strokeWidth={1.8}
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        {isLoading && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
        )}
        {!isLoading && query && (
          <button onClick={clearSearch} aria-label={t('search.clear')}>
            <X className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      {showingCatalog && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p
                className="text-[11px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('search.suggestionsEyebrow')}
              </p>
              <h2
                className="mt-1 text-[18px] font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('search.suggestionsTitle')}
              </h2>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {t('search.suggestionsHint')}
            </span>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {SOFTWARE_KITS.map((kit) => {
              const Icon = kitIcons[kit.id]
              const active = kit.id === selectedKit
              const count = SOFTWARE_CATALOG.filter((entry) => entry.kits.includes(kit.id)).length
              return (
                <button
                  key={kit.id}
                  onClick={() => selectKit(kit.id)}
                  className="rounded-2xl p-3 text-left transition-colors"
                  style={{
                    background: active ? 'var(--accent-muted-bg)' : 'var(--bg-surface)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-xl"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-active)',
                        color: active ? '#111' : 'var(--text-muted)'
                      }}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      {count}
                    </span>
                  </div>
                  <strong className="block text-[13px]" style={{ color: 'var(--text-primary)' }}>
                    {kit.label}
                  </strong>
                  <span
                    className="mt-1 block text-[10px] leading-4"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {kit.description}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            className="overflow-hidden rounded-2xl"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <div>
                <strong className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                  {SOFTWARE_KITS.find((kit) => kit.id === selectedKit)?.label}
                </strong>
                <span className="ml-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  {selectedEntries.length} {t('search.programs')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-active)' }}
                >
                  {allSelected ? t('search.clearSelection') : t('search.selectAll')}
                </button>
                <button
                  onClick={handleBatchInstall}
                  disabled={!selectedIds.size || batchInstalling}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-semibold disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: '#111' }}
                >
                  {batchInstalling ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <PackageCheck size={13} />
                  )}
                  {t('search.installSelected', { count: selectedIds.size })}
                </button>
              </div>
            </div>

            {selectedEntries.map((entry, index) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{
                  borderTop: index ? '1px solid var(--bg-subtle)' : undefined,
                  background: 'var(--bg-surface)'
                }}
              >
                <button
                  onClick={() => toggleSelected(entry.id)}
                  aria-label={selectedIds.has(entry.id) ? t('search.deselect') : t('search.select')}
                  className="shrink-0 disabled:opacity-40"
                >
                  <div
                    className="flex h-4.5 w-4.5 items-center justify-center rounded"
                    style={{
                      background: selectedIds.has(entry.id) ? 'var(--accent)' : 'var(--bg-hover-2)',
                      border: selectedIds.has(entry.id)
                        ? 'none'
                        : '1px solid var(--border-stronger)',
                      width: 18,
                      height: 18
                    }}
                  >
                    {selectedIds.has(entry.id) && (
                      <CheckCircle2
                        className="h-3 w-3"
                        style={{ color: 'var(--text-on-accent)' }}
                        strokeWidth={3}
                      />
                    )}
                  </div>
                </button>
                <WingetIcon
                  id={entry.wingetId}
                  name={entry.name}
                  mode="online"
                  size={32}
                  iconSlug={entry.iconSlug}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {entry.name}
                  </p>
                  <p className="truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    {entry.wingetId}
                  </p>
                </div>
                <button
                  onClick={() => beginInstall(entry.wingetId, entry.name)}
                  disabled={batchInstalling || installingId === entry.wingetId}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium disabled:opacity-40"
                  style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
                >
                  {installingId === entry.wingetId ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  {t('search.installButton')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && result.items.length === 0 && status === 'done' && (
        <section className="space-y-3">
          <div
            className="rounded-2xl p-4"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-start gap-3">
              <Search className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <div>
                <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {t('search.noResultsTitle')}
                </h2>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                  {t('search.noResultsDescription', { query: result.query })}
                </p>
                {result.error && (
                  <p
                    className="mt-2 rounded-lg px-2.5 py-2 text-[10px]"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}
                  >
                    {t('search.technicalError')}: {result.error}
                  </p>
                )}
              </div>
            </div>
          </div>

          {similarEntries.length > 0 && (
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="mb-3 flex items-center gap-2">
                <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                <strong className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                  {t('search.similarTitle')}
                </strong>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {similarEntries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setQuery(entry.name)}
                    className="flex items-center gap-2.5 rounded-xl p-2.5 text-left"
                    style={{
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <WingetIcon
                      id={entry.wingetId}
                      name={entry.name}
                      mode="online"
                      size={32}
                      iconSlug={entry.iconSlug}
                    />
                    <span className="min-w-0 flex-1">
                      <strong
                        className="block truncate text-[11px]"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {entry.name}
                      </strong>
                      <small
                        className="block truncate text-[9px]"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {entry.wingetId}
                      </small>
                    </span>
                    <CheckCircle2 size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {result && result.items.length > 0 && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          {result.truncated && (
            <div
              className="px-4 py-2 text-[11px]"
              style={{ background: 'rgba(245,158,11,0.04)', color: 'var(--text-muted)' }}
            >
              {t('search.truncatedNotice')}
            </div>
          )}
          {result.items.map((item, i) => (
            <div
              key={`${item.id}-${i}`}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderBottom: i < result.items.length - 1 ? '1px solid var(--bg-subtle)' : 'none',
                background: 'var(--bg-surface)'
              }}
            >
              <WingetIcon id={item.id} name={item.name} mode="online" size={32} />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.name}
                </p>
                <p className="truncate text-[11px]" style={{ color: 'var(--text-dim)' }}>
                  {item.id} · {item.version} · {item.source}
                </p>
              </div>
              <button
                onClick={() => beginInstall(item.id, item.name)}
                disabled={installingId === item.id || batchInstalling}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
                style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
              >
                {installingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {t('search.installButton')}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingInstall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="winget-install-location-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl p-6 shadow-2xl"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)'
            }}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-xl p-2" style={{ background: 'var(--accent-muted-bg)' }}>
                <FolderOpen className="h-5 w-5" style={{ color: 'var(--accent)' }} />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="winget-install-location-title"
                  className="text-[16px] font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {batchQueue.length > 0
                    ? t('search.batchInstallTitle')
                    : t('search.installLocationTitle')}
                </h2>
                <p
                  className="mt-1 text-[13px] leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {batchQueue.length > 0
                    ? t('search.batchInstallDescription', { count: batchQueue.length })
                    : t('search.installLocationDescription', { name: pendingInstall.name })}
                </p>
                {batchQueue.length > 0 && (
                  <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                    {t('search.batchInstallStep', {
                      current: batchCounts.succeeded + batchCounts.failed + 1,
                      total: batchCounts.succeeded + batchCounts.failed + batchQueue.length
                    })}
                  </p>
                )}
              </div>
              <button
                onClick={cancelPendingInstall}
                className="rounded-lg p-1.5"
                aria-label={t('search.cancelInstall')}
              >
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div
              className="mb-4 flex items-center gap-3 rounded-xl px-3.5 py-3"
              style={{
                background: 'var(--accent-muted-bg)',
                border: '1px solid var(--accent-muted-border)'
              }}
            >
              <WingetIcon
                id={pendingInstall.id}
                name={pendingInstall.name}
                mode="online"
                size={38}
              />
              <div className="min-w-0">
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--accent)' }}
                >
                  {t('search.selectedProgram')}
                </p>
                <p
                  className="mt-0.5 truncate text-[15px] font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {pendingInstall.name}
                </p>
              </div>
            </div>

            <div
              className="mb-4 rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)'
              }}
            >
              {t('search.installLocationNote')}
            </div>

            {installDrives.length > 0 && (
              <div className="mb-4">
                <p
                  className="mb-2 text-[12px] font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {t('search.availableDrives')}
                </p>
                <div className="grid max-h-36 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {installDrives.map((drive) => {
                    const target = `${drive.letter}:\\Program Files`
                    const selected = installLocation?.toLowerCase() === target.toLowerCase()
                    return (
                      <button
                        key={drive.letter}
                        onClick={() => setInstallLocation(target)}
                        className="rounded-xl px-3 py-2 text-left"
                        style={{
                          background: selected ? 'var(--accent-muted-bg)' : 'var(--bg-subtle-2)',
                          border: `1px solid ${selected ? 'var(--accent-muted-border)' : 'var(--border-default)'}`
                        }}
                      >
                        <span
                          className="block truncate text-[12px] font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {drive.letter}: {drive.label}
                          {drive.isSystem ? ` · ${t('search.systemDrive')}` : ''}
                        </span>
                        <span
                          className="mt-0.5 block text-[11px]"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {t('search.driveFreeSpace', { space: formatBytes(drive.freeSpace) })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div
              className="mb-5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[12px]"
              style={{
                background: 'var(--bg-subtle-2)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)'
              }}
            >
              <FolderOpen size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span className="truncate">
                {installTargetPath(installLocation, pendingInstall.name) ??
                  t('search.defaultInstallLocation')}
              </span>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={cancelPendingInstall}
                className="rounded-xl px-3.5 py-2 text-[12px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                {batchQueue.length > 0 ? t('search.cancelRemaining') : t('search.cancelInstall')}
              </button>
              <button
                onClick={() => void chooseInstallLocation()}
                className="rounded-xl px-3.5 py-2 text-[12px] font-medium"
                style={{
                  background: 'var(--bg-subtle-2)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)'
                }}
              >
                {t('search.chooseFolder')}
              </button>
              <button
                onClick={() => void confirmInstall()}
                className="rounded-xl px-3.5 py-2 text-[12px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                {batchQueue.length > 0
                  ? t('search.startBatchInstall', { count: batchQueue.length })
                  : installLocation && installLocation !== DEFAULT_INSTALL_PARENT
                    ? t('search.installHere')
                    : t('search.installDefault')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

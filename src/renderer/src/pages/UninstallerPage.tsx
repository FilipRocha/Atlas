import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Package,
  Search,
  Loader2,
  CheckCircle2,
  Shield,
  Trash2,
  RefreshCw,
  ArrowUpDown,
  ChevronDown,
  AlertTriangle,
  Clock,
  CheckSquare,
  Square,
  MinusSquare
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useUninstallerStore, UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import { formatBytes } from '@/lib/utils'
import type {
  InstalledProgram,
  UninstallProgress,
  UninstallScanMode,
  UninstallScanResult
} from '@shared/types'

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return ''
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  return `${year}-${month}-${day}`
}

const UNUSED_THRESHOLD_MS = UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

function isUnused(prog: InstalledProgram): boolean {
  if (prog.lastUsed === -1) return false // unknown (Prefetch unavailable)
  if (prog.lastUsed === 0) return true // Prefetch available but never seen
  return Date.now() - prog.lastUsed > UNUSED_THRESHOLD_MS
}

function formatLastUsed(
  ts: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (ts <= 0) return t('lastUsedNeverDetected')
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
  if (days === 0) return t('lastUsedToday')
  if (days === 1) return t('lastUsedYesterday')
  if (days < 30) return t('lastUsedDaysAgo', { days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('lastUsedMonthsAgo', { months })
  const years = Math.floor(months / 12)
  return t('lastUsedYearsAgo', { years })
}

const SORT_LABEL_KEYS: Record<string, string> = {
  displayName: 'sortByName',
  estimatedSize: 'sortBySize',
  installDate: 'sortByDate',
  publisher: 'sortByPublisher'
}

export function UninstallerPage() {
  const { t } = useTranslation('uninstaller')
  const programs = useUninstallerStore((s) => s.programs)
  const loading = useUninstallerStore((s) => s.loading)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const progress = useUninstallerStore((s) => s.progress)
  const uninstallResult = useUninstallerStore((s) => s.uninstallResult)
  const error = useUninstallerStore((s) => s.error)
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const filterMode = useUninstallerStore((s) => s.filterMode)

  const selectedIds = useUninstallerStore((s) => s.selectedIds)

  const [deepProgram, setDeepProgram] = useState<InstalledProgram | null>(null)
  const [deepQueue, setDeepQueue] = useState<InstalledProgram[]>([])
  const [deepIndex, setDeepIndex] = useState(0)
  const [restorePointEnabled, setRestorePointEnabled] = useState(true)
  const [scanMode, setScanMode] = useState<UninstallScanMode>('advanced')
  const [deepScan, setDeepScan] = useState<UninstallScanResult | null>(null)
  const [deepSelected, setDeepSelected] = useState<Set<string>>(new Set())
  const [deepBusy, setDeepBusy] = useState(false)
  const [deepError, setDeepError] = useState<string | null>(null)
  const [residueScanCompleted, setResidueScanCompleted] = useState(false)
  const [confirmForceRemove, setConfirmForceRemove] = useState<InstalledProgram | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const uninstallStartRef = useRef<number>(0)
  const lastFailedProgramRef = useRef<InstalledProgram | null>(null)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  const openDeepUninstall = useCallback((queue: InstalledProgram[]) => {
    if (queue.length === 0) return
    setDeepQueue(queue)
    setDeepIndex(0)
    setDeepProgram(queue[0])
    setDeepScan(null)
    setDeepError(null)
    setDeepSelected(new Set())
    setRestorePointEnabled(true)
    setScanMode('advanced')
    setResidueScanCompleted(false)
  }, [])

  const advanceDeepQueue = useCallback(() => {
    const nextIndex = deepIndex + 1
    if (nextIndex < deepQueue.length) {
      setDeepIndex(nextIndex)
      setDeepProgram(deepQueue[nextIndex])
      setDeepScan(null)
      setDeepError(null)
      setDeepSelected(new Set())
      setResidueScanCompleted(false)
      return
    }
    if (deepQueue.length > 1) toast.success(t('batchDeepComplete', { count: deepQueue.length }))
    setDeepProgram(null)
    setDeepQueue([])
    setDeepIndex(0)
    setDeepScan(null)
    setDeepSelected(new Set())
  }, [deepIndex, deepQueue, t])

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.atlas.onUninstallerProgress((data: UninstallProgress) => {
      useUninstallerStore.getState().setProgress(data)
    })
    return () => {
      cleanup()
    }
  }, [])

  // Auto-load on first visit
  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu])

  // ─── Load programs ─────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    const store = useUninstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUninstallResult(null)

    try {
      const result = await window.atlas.uninstallerList()
      const s = useUninstallerStore.getState()
      s.setPrograms(result.programs)
      s.setHasLoaded(true)
    } catch (err) {
      console.error('Failed to list programs:', err)
      toast.error(t('failedToLoadToast'))
      useUninstallerStore.getState().setError(t('failedToLoadError'))
    } finally {
      useUninstallerStore.getState().setLoading(false)
    }
  }, [t])

  // ─── Revo-style uninstall flow ───────────────────────────
  const handleUninstall = useCallback(async () => {
    if (!deepProgram || deepBusy) return
    const program = deepProgram
    setDeepBusy(true)
    setDeepError(null)
    setDeepScan(null)

    try {
      if (restorePointEnabled && deepIndex === 0) {
        const restoreTitle =
          deepQueue.length > 1
            ? `Atlas - antes de desinstalar ${deepQueue.length} programas`
            : `Atlas - antes de desinstalar ${program.displayName}`
        const restore = await window.atlas.createRestorePoint(restoreTitle)
        if (!restore.success) {
          setDeepError(
            `Não foi possível criar o ponto de restauração. A desinstalação foi interrompida.\n\n${restore.error || 'Erro desconhecido.'}`
          )
          setDeepBusy(false)
          return
        }
        toast.success('Ponto de restauração criado com sucesso.')
      }

      const store = useUninstallerStore.getState()
      setResidueScanCompleted(false)
      store.setUninstalling(true)
      store.setUninstallResult(null)
      store.setError(null)
      store.setProgress(null)
      uninstallStartRef.current = Date.now()
      lastFailedProgramRef.current = program

      const result = await window.atlas.uninstallerUninstall(program.id)
      store.setUninstallResult(result)
      store.setProgress(null)

      if (!result.success) {
        setDeepError(result.error || 'A desinstalação não foi concluída.')
        setDeepBusy(false)
        store.setUninstalling(false)
        return
      }

      const scan = await window.atlas.uninstallerScan(program.id, scanMode)
      setDeepScan(scan)
      setResidueScanCompleted(true)
      store.setUninstallResult({
        ...result,
        leftoversFound: scan.items.length,
        leftoversCleaned: 0,
        leftoversSize: 0
      })
      setDeepSelected(new Set(scan.items.filter((item) => item.selected).map((item) => item.id)))
      store.removeProgram(program.id)
      store.setUninstalling(false)
      lastFailedProgramRef.current = null

      if (scan.items.length === 0) {
        toast.success(`${program.displayName} foi desinstalado e nenhum vestígio foi encontrado.`)
        advanceDeepQueue()
      }
    } catch (err) {
      console.error('Deep uninstall failed:', err)
      setDeepError(err instanceof Error ? err.message : 'Falha durante a desinstalação.')
      useUninstallerStore.getState().setUninstalling(false)
    } finally {
      setDeepBusy(false)
    }
  }, [deepProgram, deepBusy, restorePointEnabled, deepIndex, deepQueue, scanMode, advanceDeepQueue])

  const toggleDeepItem = useCallback((id: string) => {
    setDeepSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const cleanDeepItems = useCallback(async () => {
    if (!deepProgram || !deepScan || deepBusy) return
    setDeepBusy(true)
    try {
      const result = await window.atlas.uninstallerClean(deepProgram.id, [...deepSelected])
      const found = deepScan.items.length
      const cleaned = result.cleaned
      if (cleaned > 0) {
        await historyStore.addEntry({
          id: Date.now().toString(),
          type: 'cleaner',
          timestamp: new Date().toISOString(),
          duration: Date.now() - uninstallStartRef.current,
          totalItemsFound: found,
          totalItemsCleaned: cleaned,
          totalItemsSkipped: found - cleaned,
          totalSpaceSaved: result.cleanedSize,
          categories: [
            {
              name: `Desinstalação profunda: ${deepProgram.displayName}`,
              itemsFound: found,
              itemsCleaned: cleaned,
              spaceSaved: result.cleanedSize
            }
          ],
          errorCount: result.errors.length
        })
        recomputeStats()
      }
      if (result.errors.length) {
        toast.warning(
          `${cleaned} item(ns) removido(s), ${result.errors.length} não puderam ser removidos.`
        )
        setDeepError(
          result.errors
            .slice(0, 4)
            .map((e) => `${e.path}: ${e.reason}`)
            .join('\n')
        )
      } else {
        toast.success(`${cleaned} item(ns) removido(s) com segurança.`)
        setDeepError(null)
      }
      advanceDeepQueue()
    } catch (err) {
      setDeepError(err instanceof Error ? err.message : 'Falha ao limpar os vestígios.')
    } finally {
      setDeepBusy(false)
    }
  }, [
    deepProgram,
    deepScan,
    deepBusy,
    deepSelected,
    historyStore,
    recomputeStats,
    advanceDeepQueue
  ])

  // ─── Force remove a program ─────────────────────────────
  const handleForceRemove = useCallback(async () => {
    if (!confirmForceRemove) return
    const program = confirmForceRemove
    setConfirmForceRemove(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()

    try {
      const result = await window.atlas.uninstallerForceRemove(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        lastFailedProgramRef.current = null
        s.removeProgram(program.id)

        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Force Remove: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize
              }
            ],
            errorCount: 0
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Force remove failed:', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmForceRemove, historyStore, recomputeStats])

  // ─── Filtered & sorted list ───────────────────────────────
  const filteredPrograms = useMemo(() => {
    let list = programs

    // Filter by unused
    if (filterMode === 'unused') {
      list = list.filter(isUnused)
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) => p.displayName.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q)
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'estimatedSize':
          return (a.estimatedSize - b.estimatedSize) * dir
        case 'installDate':
          return a.installDate.localeCompare(b.installDate) * dir
        case 'publisher':
          return a.publisher.localeCompare(b.publisher) * dir
        default:
          return a.displayName.localeCompare(b.displayName) * dir
      }
    })
  }, [programs, searchQuery, sortField, sortDirection, filterMode])

  // Unused stats — only meaningful when Prefetch data is available
  const hasPrefetchData = useMemo(() => programs.some((p) => p.lastUsed !== -1), [programs])
  const unusedPrograms = useMemo(() => programs.filter(isUnused), [programs])
  const unusedTotalSize = useMemo(
    () => unusedPrograms.reduce((sum, p) => sum + p.estimatedSize, 0),
    [unusedPrograms]
  )

  const isBusy = loading || uninstalling

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleLoad}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{
            background: 'var(--bg-hover)',
            border: '1px solid var(--border-medium)'
          }}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
          )}
          {loading ? t('loading') : hasLoaded ? t('refresh') : t('loadPrograms')}
        </button>

        {/* Filter tabs — only show when Prefetch data is available */}
        {hasLoaded && hasPrefetchData && (
          <div
            className="flex rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('all')}
              className="px-4 py-2.5 text-[12px] font-medium transition-colors"
              style={{
                background: filterMode === 'all' ? 'var(--bg-active)' : 'var(--bg-subtle)',
                color: filterMode === 'all' ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              {t('filterAll', { count: programs.length })}
            </button>
            <button
              onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors"
              style={{
                background: filterMode === 'unused' ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle)',
                color: filterMode === 'unused' ? 'var(--accent-hover)' : 'var(--text-muted)',
                borderLeft: '1px solid var(--border-medium)'
              }}
            >
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              {t('filterUnused', { count: unusedPrograms.length })}
            </button>
          </div>
        )}

        {/* Search */}
        {hasLoaded && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-medium)'
            }}
          >
            <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => useUninstallerStore.getState().setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
            />
          </div>
        )}

        {/* Sort */}
        {hasLoaded && (
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-medium)'
              }}
            >
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t(SORT_LABEL_KEYS[sortField])}
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
            {showSortMenu && (
              <div
                className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
                style={{
                  background: 'var(--flyout-bg)',
                  border: '1px solid var(--border-strong)',
                  minWidth: 140
                }}
              >
                {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                  <button
                    key={field}
                    onClick={() => {
                      const store = useUninstallerStore.getState()
                      if (sortField === field) {
                        store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        store.setSortField(field as any)
                        store.setSortDirection(field === 'estimatedSize' ? 'desc' : 'asc')
                      }
                      setShowSortMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    {t(labelKey)}
                    {sortField === field && (
                      <span className="ml-auto text-amber-400 text-[10px]">
                        {sortDirection === 'asc' ? t('sortAscending') : t('sortDescending')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Uninstall Selected */}
        {hasLoaded && selectedIds.size > 0 && (
          <button
            onClick={() =>
              openDeepUninstall(programs.filter((program) => selectedIds.has(program.id)))
            }
            disabled={uninstalling}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-red-400 transition-all disabled:opacity-30"
            style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.15)'
            }}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
            {t('uninstallSelected', { count: selectedIds.size })}
          </button>
        )}
      </div>

      {/* Unused recommendation banner */}
      {hasLoaded &&
        !loading &&
        hasPrefetchData &&
        unusedPrograms.length > 0 &&
        filterMode === 'all' && (
          <div
            className="mb-5 flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-colors hover:border-amber-500/20"
            style={{
              background: 'rgba(245,158,11,0.04)',
              border: '1px solid var(--accent-muted-bg)'
            }}
            onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
              <div>
                <p className="text-[13px] font-medium text-zinc-200">
                  {unusedPrograms.length !== 1
                    ? t('unusedBannerTitlePlural', {
                        count: unusedPrograms.length,
                        days: UNUSED_THRESHOLD_DAYS
                      })
                    : t('unusedBannerTitle', {
                        count: unusedPrograms.length,
                        days: UNUSED_THRESHOLD_DAYS
                      })}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {unusedTotalSize > 0
                    ? t('unusedBannerDescriptionWithSize', { size: formatBytes(unusedTotalSize) })
                    : t('unusedBannerDescriptionNoSize')}
                </p>
              </div>
            </div>
            <span
              className="rounded-full px-3 py-1 text-[11px] font-medium"
              style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-hover)' }}
            >
              {t('unusedBannerViewButton')}
            </span>
          </div>
        )}

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{
          background: 'rgba(245,158,11,0.04)',
          border: '1px solid rgba(245,158,11,0.08)'
        }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('safeUninstallLabel')}</span> —{' '}
          {t('safeUninstallDescription')}
        </p>
      </div>

      {/* Errors */}
      {error && (
        <ErrorAlert
          message={error}
          onDismiss={() => useUninstallerStore.getState().setError(null)}
          className="mb-5"
        />
      )}

      {/* Uninstall progress */}
      {uninstalling && progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid var(--accent-muted-bg)'
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {progress.phase === 'uninstalling'
                  ? t('progressUninstalling', { programName: progress.currentProgram })
                  : progress.phase === 'force-removing'
                    ? t('progressForceRemoving', { programName: progress.currentProgram })
                    : progress.phase === 'scanning-leftovers'
                      ? t('progressScanningLeftovers')
                      : progress.phase === 'cleaning-leftovers'
                        ? t('progressCleaningLeftovers')
                        : t('progressLoading')}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {progress.progress}%
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            style={{ background: 'var(--bg-hover-2)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.progress}%`,
                background: 'linear-gradient(90deg, #1687ff 0%, #35d9ff 100%)'
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {progress.detail}
          </p>
        </div>
      )}

      {/* Uninstall result */}
      {uninstallResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: uninstallResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${uninstallResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`
          }}
        >
          {uninstallResult.success ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <Shield className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {uninstallResult.success ? (
              <p>
                {t('successfullyUninstalled')}{' '}
                <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.leftoversCleaned > 0 && (
                  <span className="text-green-400">
                    {' '}
                    —{' '}
                    {uninstallResult.leftoversCleaned !== 1
                      ? t('leftoversCleanedPlural', {
                          count: uninstallResult.leftoversCleaned,
                          size: formatBytes(uninstallResult.leftoversSize)
                        })
                      : t('leftoversCleaned', {
                          count: uninstallResult.leftoversCleaned,
                          size: formatBytes(uninstallResult.leftoversSize)
                        })}
                  </span>
                )}
                {residueScanCompleted && uninstallResult.leftoversFound === 0 && (
                  <span style={{ color: 'var(--text-muted)' }}> — {t('noLeftoverFilesFound')}</span>
                )}
                {!residueScanCompleted && uninstallResult.leftoversCleaned === 0 && (
                  <span style={{ color: 'var(--text-muted)' }}> — {t('residuesNotScanned')}</span>
                )}
              </p>
            ) : (
              <p>
                {t('failedToUninstall')}{' '}
                <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.error && (
                  <span style={{ color: 'var(--text-muted)' }}> — {uninstallResult.error}</span>
                )}
              </p>
            )}
          </div>
          {!uninstallResult.success &&
            lastFailedProgramRef.current &&
            lastFailedProgramRef.current.registryKey && (
              <button
                onClick={() => setConfirmForceRemove(lastFailedProgramRef.current)}
                disabled={uninstalling}
                className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-amber-400 transition-all hover:bg-amber-500/10 disabled:opacity-30"
                style={{ border: '1px solid rgba(245,158,11,0.15)' }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('forceRemoveButton')}
              </button>
            )}
        </div>
      )}

      {/* Empty state */}
      {!hasLoaded && !loading && (
        <EmptyState
          icon={Package}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              onClick={handleLoad}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)',
                color: 'var(--text-on-accent)'
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('loadPrograms')}
            </button>
          }
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('loadingInstalledPrograms')}</p>
        </div>
      )}

      {/* Program list */}
      {hasLoaded && !loading && filteredPrograms.length === 0 && programs.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-10 w-10 text-zinc-600 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">
            {filterMode === 'unused' ? t('noUnusedProgramsFound') : t('noProgramsMatchSearch')}
          </p>
        </div>
      )}

      {hasLoaded && !loading && programs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle2 className="h-10 w-10 text-green-500 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('noInstalledProgramsFound')}</p>
        </div>
      )}

      {hasLoaded && !loading && filteredPrograms.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2.5">
            <button
              onClick={() => {
                const store = useUninstallerStore.getState()
                const allFilteredIds = filteredPrograms.map((p) => p.id)
                const allSelected = allFilteredIds.every((id) => selectedIds.has(id))
                if (allSelected) {
                  store.clearSelected()
                } else {
                  store.selectAll(allFilteredIds)
                }
              }}
              disabled={uninstalling}
              className="text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
              title={
                filteredPrograms.every((p) => selectedIds.has(p.id))
                  ? t('deselectAll')
                  : t('selectAll')
              }
            >
              {filteredPrograms.length > 0 &&
              filteredPrograms.every((p) => selectedIds.has(p.id)) ? (
                <CheckSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : filteredPrograms.some((p) => selectedIds.has(p.id)) ? (
                <MinusSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : (
                <Square className="h-4.5 w-4.5" strokeWidth={1.8} />
              )}
            </button>
            {filterMode === 'unused' ? (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            ) : (
              <Package className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            )}
            <span className="text-[13px] font-semibold text-zinc-200">
              {filterMode === 'unused' ? t('unusedProgramsHeading') : t('installedProgramsHeading')}{' '}
              {searchQuery
                ? t('programCount', {
                    filtered: filteredPrograms.length,
                    total: filterMode === 'unused' ? unusedPrograms.length : programs.length
                  })
                : `(${filteredPrograms.length})`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {filteredPrograms.map((prog) => {
              const unused = isUnused(prog)
              const isSelected = selectedIds.has(prog.id)
              return (
                <Fragment key={prog.id}>
                  <div
                    className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
                    style={{
                      background: isSelected
                        ? 'var(--accent-muted-bg)'
                        : unused
                          ? 'rgba(245,158,11,0.03)'
                          : 'var(--bg-subtle)',
                      border: `1px solid ${isSelected ? 'var(--accent-muted-border)' : unused ? 'var(--accent-muted-bg)' : 'var(--border-subtle)'}`
                    }}
                  >
                    <button
                      onClick={() => useUninstallerStore.getState().toggleSelected(prog.id)}
                      disabled={uninstalling}
                      className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30"
                    >
                      {isSelected ? (
                        <CheckCircle2
                          className="h-[18px] w-[18px]"
                          style={{ color: 'var(--accent)' }}
                          strokeWidth={2.2}
                        />
                      ) : (
                        <Square
                          className="h-[18px] w-[18px]"
                          style={{ color: 'var(--text-muted)' }}
                          strokeWidth={1.8}
                        />
                      )}
                    </button>
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                      style={{ background: 'var(--bg-active)' }}
                    >
                      {prog.iconDataUrl ? (
                        <img
                          src={prog.iconDataUrl}
                          alt=""
                          width={32}
                          height={32}
                          className="h-8 w-8 object-contain"
                        />
                      ) : unused ? (
                        <AlertTriangle
                          className="h-5 w-5"
                          style={{ color: 'var(--warning)' }}
                          strokeWidth={1.8}
                        />
                      ) : (
                        <Package
                          className="h-5 w-5"
                          style={{ color: 'var(--text-muted)' }}
                          strokeWidth={1.8}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[13px] font-medium text-zinc-200 truncate">
                          {prog.displayName}
                        </span>
                        {prog.displayVersion && (
                          <span
                            className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                            style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
                          >
                            v{prog.displayVersion}
                          </span>
                        )}
                        {unused && (
                          <span
                            className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                            style={{
                              background: 'rgba(245,158,11,0.1)',
                              color: 'var(--accent-hover)'
                            }}
                          >
                            {t('unusedBadge')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3">
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {prog.publisher || t('unknownPublisher')}
                          {prog.installDate ? ` — ${formatDate(prog.installDate)}` : ''}
                        </p>
                        {prog.lastUsed > 0 && (
                          <span
                            className="flex items-center gap-1 text-[10px] shrink-0"
                            style={{ color: unused ? 'var(--accent)' : 'var(--text-muted)' }}
                          >
                            <Clock className="h-3 w-3" strokeWidth={1.8} />
                            {formatLastUsed(prog.lastUsed, t)}
                          </span>
                        )}
                        {prog.lastUsed === 0 && filterMode === 'unused' && (
                          <span
                            className="flex items-center gap-1 text-[10px] shrink-0"
                            style={{ color: 'var(--accent)' }}
                          >
                            <Clock className="h-3 w-3" strokeWidth={1.8} />
                            {t('lastUsedNeverDetected')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[12px] font-medium text-zinc-400">
                          {formatBytes(prog.estimatedSize)}
                        </span>
                      </div>
                      <button
                        onClick={() => openDeepUninstall([prog])}
                        disabled={uninstalling}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:bg-red-500/10 disabled:opacity-30"
                        style={{ border: '1px solid rgba(239,68,68,0.15)' }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {t('uninstallButton')}
                      </button>
                    </div>
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}

      {/* Atlas Deep Uninstall wizard — restore point → native uninstall → review leftovers */}
      {deepProgram && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
            onClick={() => {
              if (!deepBusy) {
                setDeepProgram(null)
                setDeepQueue([])
                setDeepIndex(0)
                setDeepScan(null)
              }
            }}
          />
          <div
            className="relative w-full max-w-2xl max-h-[86vh] overflow-hidden rounded-2xl"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 24px 90px rgba(0,0,0,.55)'
            }}
          >
            <div
              className="flex items-start justify-between gap-4 border-b px-6 py-5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div>
                <div
                  className="text-[11px] uppercase tracking-[0.18em]"
                  style={{ color: 'var(--accent)' }}
                >
                  DESINSTALAÇÃO
                </div>
                <h3
                  className="mt-1 text-[18px] font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {deepProgram.displayName}
                </h3>
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Escolha o modo simples ou avançado. O Atlas mostra os vestígios encontrados antes
                  de apagar qualquer coisa.
                </p>
                {deepQueue.length > 1 && (
                  <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                    {t('batchDeepStep', { current: deepIndex + 1, total: deepQueue.length })}
                  </p>
                )}
              </div>
              <button
                disabled={deepBusy}
                onClick={() => {
                  setDeepProgram(null)
                  setDeepQueue([])
                  setDeepIndex(0)
                  setDeepScan(null)
                }}
                className="text-[20px] text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
              >
                ×
              </button>
            </div>

            {!deepScan ? (
              <div className="space-y-5 overflow-y-auto p-6">
                {deepQueue.length > 1 && (
                  <div
                    className="rounded-xl p-3"
                    style={{
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <p
                      className="mb-2 text-[11px] font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t('batchDeepPrograms')}
                    </p>
                    <div
                      className="max-h-24 space-y-1 overflow-y-auto text-[11px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {deepQueue.map((program, index) => (
                        <p key={program.id} className={index === deepIndex ? 'font-semibold' : ''}>
                          {index + 1}. {program.displayName}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {deepIndex === 0 && (
                  <div
                    className="rounded-xl p-4"
                    style={{
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div
                          className="text-[13px] font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          Ponto de restauração do Windows
                        </div>
                        <div
                          className="mt-1 text-[11px]"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Recomendado antes de uma varredura profunda. O Atlas solicita UAC somente
                          para esta operação.
                        </div>
                      </div>
                      <button
                        onClick={() => setRestorePointEnabled((v) => !v)}
                        className="h-6 w-11 rounded-full p-1 transition-colors"
                        style={{
                          background: restorePointEnabled ? 'var(--accent)' : 'var(--bg-hover)'
                        }}
                        aria-label="Alternar ponto de restauração"
                      >
                        <span
                          className={`block h-4 w-4 rounded-full bg-white transition-transform ${restorePointEnabled ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div
                    className="mb-2 text-[13px] font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Modo de varredura
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(['simple', 'advanced'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setScanMode(mode)}
                        className="rounded-xl p-4 text-left transition-colors"
                        style={{
                          background:
                            scanMode === mode ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)',
                          border: `1px solid ${scanMode === mode ? 'var(--accent)' : 'var(--border-subtle)'}`
                        }}
                      >
                        <div
                          className="text-[13px] font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {mode === 'simple' ? 'Simples' : 'Avançada'}
                        </div>
                        <div
                          className="mt-1 text-[11px] leading-relaxed"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {mode === 'simple'
                            ? 'Arquivos de instalação e Registro diretamente relacionado ao programa.'
                            : 'Inclui AppData, ProgramData e referências adicionais do Registro, sempre sem tocar nos documentos pessoais.'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {deepError && (
                  <div
                    className="whitespace-pre-line rounded-xl p-3 text-[11px]"
                    style={{
                      background: 'rgba(239,68,68,.08)',
                      border: '1px solid rgba(239,68,68,.18)',
                      color: '#fca5a5'
                    }}
                  >
                    {deepError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    disabled={deepBusy}
                    onClick={() => {
                      setDeepProgram(null)
                      setDeepQueue([])
                      setDeepIndex(0)
                    }}
                    className="rounded-lg px-4 py-2 text-[12px]"
                    style={{
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-medium)'
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={deepBusy}
                    onClick={() => void handleUninstall()}
                    className="rounded-lg px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}
                  >
                    {deepBusy ? 'Preparando...' : 'Desinstalar e procurar vestígios'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex max-h-[70vh] flex-col">
                <div className="border-b px-6 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {deepScan.items.length} vestígio(s) encontrado(s)
                      </div>
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {deepScan.fileCount} arquivo(s)/pasta(s) · {deepScan.registryCount} chave(s)
                        do Registro · {formatBytes(deepScan.totalSize)}
                      </div>
                    </div>
                    <button
                      onClick={() => setDeepSelected(new Set(deepScan.items.map((i) => i.id)))}
                      className="rounded-lg px-3 py-1.5 text-[11px]"
                      style={{
                        border: '1px solid var(--border-medium)',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      Selecionar tudo
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="space-y-2">
                    {deepScan.items.map((item) => {
                      const selected = deepSelected.has(item.id)
                      return (
                        <button
                          key={item.id}
                          onClick={() => toggleDeepItem(item.id)}
                          className="flex w-full items-center gap-3 rounded-xl p-3 text-left"
                          style={{
                            background: selected ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)',
                            border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`
                          }}
                        >
                          <div
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                            style={{
                              background: selected ? 'var(--accent)' : 'transparent',
                              borderColor: selected ? 'var(--accent)' : 'var(--border-stronger)'
                            }}
                          >
                            {selected && (
                              <CheckCircle2 className="h-4 w-4 text-white" strokeWidth={2.2} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="truncate text-[12px] font-medium"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {item.path}
                              </span>
                              <span
                                className="shrink-0 rounded px-1.5 py-0.5 text-[9px]"
                                style={{
                                  background:
                                    item.kind === 'registry'
                                      ? 'rgba(168,85,247,.12)'
                                      : 'rgba(59,130,246,.10)',
                                  color: item.kind === 'registry' ? '#c084fc' : '#60a5fa'
                                }}
                              >
                                {item.kind === 'registry' ? 'REGISTRO' : 'ARQUIVO'}
                              </span>
                            </div>
                            <div
                              className="mt-0.5 text-[10px]"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {item.category} · confiança{' '}
                              {item.confidence === 'high' ? 'alta' : 'média'}
                            </div>
                          </div>
                          {item.size > 0 && (
                            <span
                              className="shrink-0 text-[10px]"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {formatBytes(item.size)}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {deepError && (
                  <div
                    className="mx-4 mb-2 whitespace-pre-line rounded-xl p-3 text-[10px]"
                    style={{
                      background: 'rgba(239,68,68,.08)',
                      border: '1px solid rgba(239,68,68,.18)',
                      color: '#fca5a5'
                    }}
                  >
                    {deepError}
                  </div>
                )}
                <div
                  className="flex items-center justify-between border-t px-6 py-4"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {deepSelected.size} selecionado(s)
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={deepBusy}
                      onClick={advanceDeepQueue}
                      className="rounded-lg px-4 py-2 text-[12px]"
                      style={{
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-medium)'
                      }}
                    >
                      {deepIndex + 1 < deepQueue.length ? t('batchDeepNext') : 'Manter vestígios'}
                    </button>
                    <button
                      disabled={deepBusy || deepSelected.size === 0}
                      onClick={() => void cleanDeepItems()}
                      className="rounded-lg px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: 'var(--accent)' }}
                    >
                      Remover selecionados
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm dialog — force remove */}
      <ConfirmDialog
        open={!!confirmForceRemove}
        onConfirm={handleForceRemove}
        onCancel={() => setConfirmForceRemove(null)}
        title={t('confirmForceRemoveTitle', { programName: confirmForceRemove?.displayName ?? '' })}
        description={t('confirmForceRemoveDescription')}
        confirmLabel={t('confirmForceRemoveLabel')}
        variant="warning"
      />
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HardDrive,
  ArrowUp,
  Folder,
  File,
  RefreshCw,
  FileType2,
  ExternalLink,
  Trash2,
  Copy
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { formatBytes } from '@/lib/utils'
import { useDiskStore } from '@/stores/disk-store'
import { usePlatform } from '@/hooks/usePlatform'
import type { DiskNode } from '@shared/types'

type ViewMode = 'folders' | 'filetypes'

const COLORS = [
  '#f59e0b',
  '#d97706',
  '#b45309',
  '#92400e',
  '#78350f',
  '#a16207',
  '#ca8a04',
  '#eab308',
  '#facc15',
  '#fbbf24'
]

interface TreemapRect {
  name: string
  size: number
  x: number
  y: number
  w: number
  h: number
  color: string
}

function squarify(
  items: { name: string; size: number; fill: string }[],
  x: number,
  y: number,
  w: number,
  h: number,
  rects: TreemapRect[]
) {
  if (!items.length || w <= 0 || h <= 0) return
  if (items.length === 1) {
    rects.push({ name: items[0].name, size: items[0].size, x, y, w, h, color: items[0].fill })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  const horizontal = w >= h
  const side = horizontal ? h : w
  // Find the best row: add items until aspect ratio worsens
  let rowSum = 0
  let bestIdx = 0
  let bestWorst = Infinity
  for (let i = 0; i < items.length; i++) {
    rowSum += items[i].size
    const rowFrac = rowSum / total
    const rowLen = horizontal ? w * rowFrac : h * rowFrac
    // Compute worst aspect ratio in this row
    let worst = 0
    for (let j = 0; j <= i; j++) {
      const frac = items[j].size / rowSum
      const itemLen = side * frac
      const aspect = rowLen > itemLen ? rowLen / itemLen : itemLen / rowLen
      if (aspect > worst) worst = aspect
    }
    if (worst <= bestWorst) {
      bestWorst = worst
      bestIdx = i
    } else break
  }
  const rowItems = items.slice(0, bestIdx + 1)
  const restItems = items.slice(bestIdx + 1)
  const rowTotal = rowItems.reduce((s, i) => s + i.size, 0)
  const rowFrac = rowTotal / total
  if (horizontal) {
    const rowW = w * rowFrac
    let cy = y
    for (const item of rowItems) {
      const itemH = h * (item.size / rowTotal)
      rects.push({
        name: item.name,
        size: item.size,
        x,
        y: cy,
        w: rowW,
        h: itemH,
        color: item.fill
      })
      cy += itemH
    }
    squarify(restItems, x + rowW, y, w - rowW, h, rects)
  } else {
    const rowH = h * rowFrac
    let cx = x
    for (const item of rowItems) {
      const itemW = w * (item.size / rowTotal)
      rects.push({
        name: item.name,
        size: item.size,
        x: cx,
        y,
        w: itemW,
        h: rowH,
        color: item.fill
      })
      cx += itemW
    }
    squarify(restItems, x, y + rowH, w, h - rowH, rects)
  }
}

function layoutTreemap(
  items: { name: string; size: number; fill: string }[],
  width: number,
  height: number,
  otherLabel?: (count: number) => string
): TreemapRect[] {
  if (!items.length || width <= 0 || height <= 0) return []
  const total = items.reduce((s, i) => s + i.size, 0)
  if (total <= 0) return []
  // Group tiny items (<1.5% each) into "Other"
  const threshold = total * 0.015
  const big = items.filter((i) => i.size >= threshold)
  const small = items.filter((i) => i.size < threshold)
  const grouped = [...big]
  if (small.length > 0) {
    const otherSize = small.reduce((s, i) => s + i.size, 0)
    grouped.push({
      name: otherLabel ? otherLabel(small.length) : `${small.length} other items`,
      size: otherSize,
      fill: 'var(--text-muted)'
    })
  }
  const sorted = grouped.sort((a, b) => b.size - a.size)
  const rects: TreemapRect[] = []
  squarify(sorted, 0, 0, width, height, rects)
  return rects
}

function getPathSegments(fullPath: string, windows: boolean): { name: string; path: string }[] {
  const parts = fullPath.split(/[\\/]+/).filter(Boolean)
  let path = windows ? '' : '/'
  return parts.map((name, index) => {
    if (windows && index === 0) path = `${name}\\`
    else if (windows) path = `${path}${path.endsWith('\\') ? '' : '\\'}${name}`
    else path = `${path}${path.endsWith('/') ? '' : '/'}${name}`
    return { name, path }
  })
}

export function DiskAnalyzerPage() {
  const { t, i18n } = useTranslation('disk')
  const { platform } = usePlatform()
  const isWin = platform === 'win32'
  const drives = useDiskStore((s) => s.drives)
  const selectedDrive = useDiskStore((s) => s.selectedDrive)
  const data = useDiskStore((s) => s.data)
  const analyzing = useDiskStore((s) => s.analyzing)
  const breadcrumb = useDiskStore((s) => s.breadcrumb)
  const error = useDiskStore((s) => s.error)
  const fileTypes = useDiskStore((s) => s.fileTypes)
  const fileTypesLoading = useDiskStore((s) => s.fileTypesLoading)
  const store = useDiskStore()
  const [viewMode, setViewMode] = useState<ViewMode>('folders')
  const [loadingFolderPath, setLoadingFolderPath] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DiskNode | null>(null)
  const [deletingPath, setDeletingPath] = useState(false)

  useEffect(() => {
    if (drives.length === 0) {
      window.atlas
        ?.diskDrives?.()
        .then(store.setDrives)
        .catch((err) => {
          console.error('Failed to load drives:', err)
        })
    }
  }, [])

  const handleAnalyze = async () => {
    store.setAnalyzing(true)
    store.setData(null)
    store.setBreadcrumb([])
    store.setError(null)
    store.setFileTypes([])
    try {
      const result = await window.atlas.diskAnalyze(selectedDrive)
      store.setData(result)
      store.setBreadcrumb([result])
    } catch (err) {
      console.error('Disk analysis failed:', err)
      toast.error(
        isWin
          ? t('failedToAnalyzeToastWindows', { drive: selectedDrive })
          : t('failedToAnalyzeToastOther', { drive: selectedDrive }),
        { description: t('failedToAnalyzeDescMakeAccessible') }
      )
      store.setError(
        isWin
          ? t('failedToAnalyzeErrorWindows', { drive: selectedDrive })
          : t('failedToAnalyzeErrorOther', { drive: selectedDrive })
      )
    }
    store.setAnalyzing(false)
  }

  const handleFileTypeScan = async () => {
    store.setFileTypesLoading(true)
    store.setError(null)
    try {
      const result = await window.atlas.diskFileTypes(selectedDrive)
      store.setFileTypes(result)
    } catch (err) {
      console.error('File type scan failed:', err)
      store.setError(
        isWin
          ? t('failedToScanFileTypesWindows', { drive: selectedDrive })
          : t('failedToScanFileTypesOther', { drive: selectedDrive })
      )
    }
    store.setFileTypesLoading(false)
  }

  // Auto-scan file types when switching to that view if not already loaded
  useEffect(() => {
    if (viewMode === 'filetypes' && fileTypes.length === 0 && !fileTypesLoading && data) {
      handleFileTypeScan()
    }
  }, [viewMode])

  const currentNode = breadcrumb[breadcrumb.length - 1] ?? data
  const treemapData = useMemo(() => {
    if (!currentNode?.children) return []
    return [...currentNode.children]
      .sort((a, b) => b.size - a.size)
      .map((c, i) => ({ name: c.name, size: c.size, fill: COLORS[i % COLORS.length] }))
  }, [currentNode])

  const fileTypesTotal = useMemo(
    () => fileTypes.reduce((s, ft) => s + ft.totalSize, 0),
    [fileTypes]
  )
  const currentPathSegments = currentNode ? getPathSegments(currentNode.path, isWin) : []
  const formatModifiedAt = (timestamp?: number) => {
    if (!timestamp) return '—'
    return new Intl.DateTimeFormat(i18n.language || 'pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(timestamp)
  }

  const finishFolderStatsInBackground = async (path: string) => {
    try {
      const result = await window.atlas.diskAnalyzePathStats(selectedDrive, path)
      if (!result) return
      const latestBreadcrumb = useDiskStore.getState().breadcrumb
      const currentIndex = latestBreadcrumb.findIndex((node) =>
        isWin ? node.path.toLowerCase() === path.toLowerCase() : node.path === path
      )
      if (currentIndex < 0) return
      const nextBreadcrumb = [...latestBreadcrumb]
      nextBreadcrumb[currentIndex] = result
      store.setBreadcrumb(nextBreadcrumb)
      if (currentIndex === 0) store.setData(result)
    } catch (err) {
      console.error('Could not finish disk folder size calculation:', err)
    }
  }

  const drillDown = async (node: DiskNode) => {
    if (node.isFile) return
    // An empty cached array can mean the first shallow scan could not enumerate
    // the folder. Retry on demand so folders such as AppData do not look empty.
    if (node.children?.length) {
      store.pushBreadcrumb(node)
      if (node.statsLoading) void finishFolderStatsInBackground(node.path)
      return
    }
    setLoadingFolderPath(node.path)
    try {
      const contents = await window.atlas.diskAnalyzePath(selectedDrive, node.path)
      if (!contents) {
        toast.error(t('folderScanFailed'))
        return
      }
      store.pushBreadcrumb(contents)
      if (contents.statsLoading) void finishFolderStatsInBackground(contents.path)
    } catch (err) {
      console.error('Folder scan failed:', err)
      toast.error(t('folderScanFailed'))
    } finally {
      setLoadingFolderPath(null)
    }
  }

  const navigateToPath = (targetPath: string) => {
    const normalize = (path: string) => (isWin ? path.toLowerCase() : path)
    const targetIndex = breadcrumb.findIndex(
      (node) => normalize(node.path) === normalize(targetPath)
    )
    if (targetIndex >= 0 && targetIndex < breadcrumb.length - 1) {
      store.setBreadcrumb(breadcrumb.slice(0, targetIndex + 1))
    }
  }

  const openInExplorer = async (node: DiskNode) => {
    const opened = await window.atlas.diskOpenPath(selectedDrive, node.path)
    if (!opened) toast.error(t('openPathFailed'))
  }

  const copyCurrentPath = async () => {
    if (!currentNode) return
    try {
      await navigator.clipboard.writeText(currentNode.path)
      toast.success(t('pathCopied'))
    } catch {
      toast.error(t('pathCopyFailed'))
    }
  }

  const handleTrash = async () => {
    if (!pendingDelete) return
    setDeletingPath(true)
    try {
      const movedToTrash = await window.atlas.diskTrashPath(selectedDrive, pendingDelete.path)
      if (!movedToTrash) {
        toast.error(t('trashFailed'))
        return
      }
      toast.success(t('trashSucceeded', { name: pendingDelete.name }))
      setPendingDelete(null)
      const refreshed = currentNode
        ? await window.atlas.diskAnalyzePath(selectedDrive, currentNode.path)
        : null
      if (refreshed) {
        const nextBreadcrumb = [...breadcrumb]
        nextBreadcrumb[nextBreadcrumb.length - 1] = refreshed
        store.setBreadcrumb(nextBreadcrumb)
        if (nextBreadcrumb.length === 1) store.setData(refreshed)
        if (refreshed.statsLoading) void finishFolderStatsInBackground(refreshed.path)
      }
    } catch (err) {
      console.error('Could not move disk item to Recycle Bin:', err)
      toast.error(t('trashFailed'))
    } finally {
      setDeletingPath(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <select
              value={selectedDrive}
              onChange={(e) => store.setSelectedDrive(e.target.value)}
              className="rounded-xl px-4 py-2.5 text-[13px] text-zinc-400 outline-none"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              {(drives.length > 0
                ? drives
                : [
                    {
                      letter: isWin ? 'C' : '/',
                      label: 'System',
                      totalSize: 0,
                      freeSpace: 0,
                      usedSpace: 0
                    }
                  ]
              ).map((d) => (
                <option key={d.letter} value={d.letter}>
                  {isWin ? `${d.letter}: ${d.label}` : `${d.letter} ${d.label}`}
                </option>
              ))}
            </select>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="pulse-primary-action pulse-scan-action flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #1687ff 0%, #126dcc 100%)',
                color: 'var(--text-on-accent)'
              }}
            >
              {analyzing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4" strokeWidth={2} />
              )}
              {t('analyzeButton')}
            </button>
          </div>
        }
      />

      {error && (
        <ErrorAlert message={error} onDismiss={() => store.setError(null)} className="mb-5" />
      )}

      {analyzing && (
        <ScanProgress
          status="scanning"
          progress={0}
          currentPath={
            isWin
              ? t('analyzingProgressWindows', { drive: selectedDrive })
              : t('analyzingProgressOther', { drive: selectedDrive })
          }
          className="mb-5"
        />
      )}

      {/* View mode toggle */}
      <div
        className="mb-5 flex items-center gap-1 rounded-xl p-1"
        style={{
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-default)',
          width: 'fit-content'
        }}
      >
        <button
          onClick={() => setViewMode('folders')}
          className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all"
          style={{
            background: viewMode === 'folders' ? 'var(--accent-muted-border)' : 'transparent',
            color: viewMode === 'folders' ? 'var(--accent)' : 'var(--text-secondary)'
          }}
        >
          <Folder className="h-3.5 w-3.5" strokeWidth={2} />
          {t('viewFolders')}
        </button>
        <button
          onClick={() => setViewMode('filetypes')}
          className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all"
          style={{
            background: viewMode === 'filetypes' ? 'var(--accent-muted-border)' : 'transparent',
            color: viewMode === 'filetypes' ? 'var(--accent)' : 'var(--text-secondary)'
          }}
        >
          <FileType2 className="h-3.5 w-3.5" strokeWidth={2} />
          {t('viewFileTypes')}
        </button>
      </div>

      {!data && !analyzing && !error && (
        <EmptyState
          icon={HardDrive}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
        />
      )}

      {data && (
        <>
          {viewMode === 'folders' && currentNode && (
            <>
              <div className="mb-5 flex min-h-9 items-center gap-2">
                {breadcrumb.length > 1 && (
                  <button
                    type="button"
                    onClick={() => store.sliceBreadcrumb(breadcrumb.length - 2)}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition-colors"
                    style={{
                      background: 'var(--card-bg)',
                      borderColor: 'var(--border-medium)',
                      color: 'var(--text-secondary)'
                    }}
                    aria-label={t('back')}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t('back')}</span>
                  </button>
                )}
                <div
                  className="flex min-w-0 flex-1 items-center gap-2 px-1"
                  style={{ color: 'var(--text-secondary)' }}
                  title={currentNode.path}
                >
                  <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex flex-wrap items-center gap-x-0.5 font-mono text-[12px] font-semibold">
                    {currentPathSegments.map((segment, index) => (
                      <span key={segment.path} className="inline-flex items-center">
                        {index > 0 && <span className="px-0.5">\</span>}
                        <button
                          type="button"
                          onClick={() => navigateToPath(segment.path)}
                          disabled={index === currentPathSegments.length - 1}
                          className="rounded px-0.5 hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent"
                          title={segment.path}
                        >
                          {segment.name}
                        </button>
                      </span>
                    ))}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyCurrentPath}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                  title={t('copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('copyPath')}
                </button>
                <button
                  type="button"
                  onClick={() => void openInExplorer(currentNode)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('openInExplorer')}
                </button>
              </div>

              {/* Treemap */}
              {treemapData.length > 0 && !currentNode.statsLoading && (
                <div
                  className="mb-6 overflow-hidden rounded-2xl p-1.5"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-default)'
                  }}
                >
                  <div className="relative h-[280px] w-full">
                    {layoutTreemap(treemapData, 100, 100, (count) =>
                      t('otherItems', { count })
                    ).map((rect) =>
                      (() => {
                        const child = currentNode.children?.find((item) => item.name === rect.name)
                        const canNavigate = child != null && !child.isFile
                        return (
                          <button
                            type="button"
                            key={rect.name}
                            onClick={() => child && canNavigate && void drillDown(child)}
                            disabled={!canNavigate}
                            title={child?.path ?? rect.name}
                            className="absolute overflow-hidden rounded-md p-2 text-left opacity-75 transition-opacity hover:opacity-100 disabled:cursor-default"
                            style={{
                              left: `${rect.x}%`,
                              top: `${rect.y}%`,
                              width: `${rect.w}%`,
                              height: `${rect.h}%`,
                              background: rect.color,
                              boxSizing: 'border-box',
                              border: '2px solid #0c0c0e'
                            }}
                          >
                            {rect.w > 8 && rect.h > 12 && (
                              <span className="block truncate text-[12px] font-semibold text-white">
                                {rect.name}
                              </span>
                            )}
                            {rect.w > 12 && rect.h > 20 && (
                              <span className="block truncate text-[10px] text-white/80">
                                {formatBytes(rect.size)}
                              </span>
                            )}
                          </button>
                        )
                      })()
                    )}
                  </div>
                </div>
              )}

              {/* Folder table */}
              {currentNode.children && (
                <>
                  {currentNode.statsLoading && (
                    <div
                      className="mb-2 flex items-center gap-2 text-[11px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400" />
                      {t('calculatingFolderStats')}
                    </div>
                  )}
                  <div
                    className="overflow-x-auto rounded-2xl"
                    style={{ border: '1px solid var(--border-default)' }}
                  >
                    <div className="min-w-[1050px]">
                      <div
                        className="grid items-center gap-3 px-4 py-3 text-[10px] font-medium uppercase tracking-wider"
                        style={{
                          gridTemplateColumns:
                            'minmax(220px, 1fr) 110px 76px 105px 82px 145px 76px',
                          background: 'var(--card-bg)',
                          color: 'var(--text-muted)',
                          borderBottom: '1px solid var(--border-subtle)'
                        }}
                      >
                        <div>{t('folderTableHeaderName')}</div>
                        <div>{t('folderTableHeaderProportion')}</div>
                        <div className="text-right">{t('folderTableHeaderPercent')}</div>
                        <div className="text-right">{t('folderTableHeaderSize')}</div>
                        <div className="text-right">{t('folderTableHeaderFiles')}</div>
                        <div className="text-right">{t('folderTableHeaderModified')}</div>
                        <div className="text-right">{t('folderTableHeaderActions')}</div>
                      </div>
                      <div>
                        {[...currentNode.children]
                          .sort((a, b) => b.size - a.size)
                          .map((child) => {
                            const percentReady = !currentNode.statsLoading && !child.statsLoading
                            const percent =
                              percentReady && currentNode.size > 0
                                ? (child.size / currentNode.size) * 100
                                : 0
                            return (
                              <div
                                key={child.path}
                                className="grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/2"
                                style={{
                                  gridTemplateColumns:
                                    'minmax(220px, 1fr) 110px 76px 105px 82px 145px 76px',
                                  borderBottom: '1px solid var(--bg-subtle)'
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => !child.isFile && void drillDown(child)}
                                  disabled={!!child.isFile || loadingFolderPath === child.path}
                                  className="flex min-w-0 items-center gap-2.5 text-left disabled:cursor-default"
                                  title={child.path}
                                >
                                  {child.isFile ? (
                                    <File
                                      className="h-4 w-4 shrink-0"
                                      style={{ color: 'var(--text-muted)' }}
                                      strokeWidth={1.8}
                                    />
                                  ) : loadingFolderPath === child.path || child.statsLoading ? (
                                    <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
                                  ) : (
                                    <Folder
                                      className="h-4 w-4 shrink-0 text-amber-500"
                                      strokeWidth={1.8}
                                    />
                                  )}
                                  <span className="truncate text-[13px] text-zinc-300">
                                    {child.name}
                                  </span>
                                </button>
                                <div
                                  className="h-4 overflow-hidden rounded-sm border"
                                  style={{
                                    background: 'var(--bg-subtle-2)',
                                    borderColor: 'var(--border-medium)'
                                  }}
                                  title={
                                    percentReady
                                      ? `${percent.toFixed(2)}%`
                                      : t('calculatingFolderStats')
                                  }
                                >
                                  <div
                                    className="h-full min-w-0.5 rounded-sm"
                                    style={{
                                      width: `${percentReady ? Math.min(100, Math.max(percent, child.size > 0 ? 0.5 : 0)) : 0}%`,
                                      background: child.isFile
                                        ? 'var(--accent)'
                                        : 'rgba(248, 113, 113, 0.72)'
                                    }}
                                  />
                                </div>
                                <span
                                  className="text-right font-mono text-[11px]"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {percentReady ? `${percent.toFixed(2)}%` : '…'}
                                </span>
                                <span
                                  className="text-right font-mono text-[11px]"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {child.statsLoading ? '…' : formatBytes(child.size)}
                                </span>
                                <span
                                  className="text-right font-mono text-[11px]"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {child.statsLoading
                                    ? '…'
                                    : (child.fileCount ?? (child.isFile ? 1 : 0)).toLocaleString(
                                        i18n.language || 'pt-BR'
                                      )}
                                </span>
                                <span
                                  className="text-right text-[10px]"
                                  style={{ color: 'var(--text-muted)' }}
                                  title={
                                    child.modifiedAt && !child.statsLoading
                                      ? new Date(child.modifiedAt).toLocaleString(
                                          i18n.language || 'pt-BR'
                                        )
                                      : ''
                                  }
                                >
                                  {child.statsLoading ? '…' : formatModifiedAt(child.modifiedAt)}
                                </span>
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void openInExplorer(child)}
                                    className="rounded-lg p-2 transition-colors hover:bg-blue-500/10 hover:text-blue-300"
                                    style={{ color: 'var(--text-muted)' }}
                                    title={t('openInExplorer')}
                                    aria-label={`${t('openInExplorer')}: ${child.name}`}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDelete(child)}
                                    className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                                    title={t('moveToRecycleBin')}
                                    aria-label={`${t('moveToRecycleBin')}: ${child.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {viewMode === 'filetypes' && (
            <>
              {fileTypesLoading && (
                <ScanProgress
                  status="scanning"
                  progress={0}
                  currentPath={
                    isWin
                      ? t('scanningFileTypesWindows', { drive: selectedDrive })
                      : t('scanningFileTypesOther', { drive: selectedDrive })
                  }
                  className="mb-5"
                />
              )}

              {!fileTypesLoading && fileTypes.length === 0 && (
                <EmptyState
                  icon={FileType2}
                  title={t('fileTypesEmptyTitle')}
                  description={t('fileTypesEmptyDescription')}
                />
              )}

              {!fileTypesLoading && fileTypes.length > 0 && (
                <>
                  {/* Summary cards */}
                  <div className="mb-5 grid grid-cols-3 gap-3">
                    <div
                      className="rounded-xl px-4 py-3"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-default)'
                      }}
                    >
                      <div
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('summaryTotalScanned')}
                      </div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">
                        {formatBytes(fileTypesTotal)}
                      </div>
                    </div>
                    <div
                      className="rounded-xl px-4 py-3"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-default)'
                      }}
                    >
                      <div
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('summaryFileTypes')}
                      </div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">
                        {fileTypes.length}
                      </div>
                    </div>
                    <div
                      className="rounded-xl px-4 py-3"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-default)'
                      }}
                    >
                      <div
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('summaryLargestType')}
                      </div>
                      <div className="mt-1 text-[18px] font-semibold text-zinc-200">
                        {fileTypes[0]?.extension ?? '-'}
                      </div>
                    </div>
                  </div>

                  {/* File type treemap */}
                  <div
                    className="mb-6 overflow-hidden rounded-2xl p-1.5"
                    style={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-default)'
                    }}
                  >
                    <div className="relative h-[280px] w-full">
                      {layoutTreemap(
                        fileTypes.slice(0, 30).map((ft, i) => ({
                          name: ft.extension,
                          size: ft.totalSize,
                          fill: COLORS[i % COLORS.length]
                        })),
                        100,
                        100,
                        (count) => t('otherItems', { count })
                      ).map((rect) => (
                        <div
                          key={rect.name}
                          className="absolute overflow-hidden rounded-md p-2 opacity-75 transition-opacity hover:opacity-100"
                          style={{
                            left: `${rect.x}%`,
                            top: `${rect.y}%`,
                            width: `${rect.w}%`,
                            height: `${rect.h}%`,
                            background: rect.color,
                            boxSizing: 'border-box',
                            border: '2px solid #0c0c0e'
                          }}
                        >
                          {rect.w > 6 && rect.h > 12 && (
                            <span className="block truncate text-[12px] font-semibold text-white">
                              {rect.name}
                            </span>
                          )}
                          {rect.w > 10 && rect.h > 20 && (
                            <span className="block truncate text-[10px] text-white/80">
                              {formatBytes(rect.size)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* File type table */}
                  <div
                    className="overflow-hidden rounded-2xl"
                    style={{ border: '1px solid var(--border-default)' }}
                  >
                    <div
                      className="flex items-center gap-4 px-5 py-3 text-[11px] font-medium uppercase tracking-wider"
                      style={{
                        background: 'var(--card-bg)',
                        color: 'var(--text-muted)',
                        borderBottom: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div className="flex-1">{t('fileTypeTableHeaderExtension')}</div>
                      <div className="w-20 text-right">{t('fileTypeTableHeaderFiles')}</div>
                      <div className="w-28 text-right">{t('fileTypeTableHeaderSize')}</div>
                      <div className="w-44">{t('fileTypeTableHeaderShare')}</div>
                    </div>
                    <div>
                      {fileTypes.map((ft, i) => {
                        const percent =
                          fileTypesTotal > 0 ? (ft.totalSize / fileTypesTotal) * 100 : 0
                        return (
                          <div
                            key={ft.extension}
                            className="flex w-full items-center gap-4 px-5 py-3 transition-colors hover:bg-white/2"
                            style={{ borderBottom: '1px solid var(--bg-subtle)' }}
                          >
                            <div className="flex flex-1 items-center gap-2.5 min-w-0">
                              <div
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                                style={{ background: COLORS[i % COLORS.length] + '22' }}
                              >
                                <FileType2
                                  className="h-3.5 w-3.5"
                                  style={{ color: COLORS[i % COLORS.length] }}
                                  strokeWidth={2}
                                />
                              </div>
                              <span className="truncate font-mono text-[13px] text-zinc-300">
                                {ft.extension}
                              </span>
                            </div>
                            <span
                              className="w-20 text-right font-mono text-[12px]"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {ft.fileCount.toLocaleString()}
                            </span>
                            <span
                              className="w-28 text-right font-mono text-[12px]"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {formatBytes(ft.totalSize)}
                            </span>
                            <div className="w-44 flex items-center gap-2.5">
                              <div
                                className="flex-1 h-[5px] rounded-full"
                                style={{ background: 'var(--bg-subtle-2)' }}
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.max(percent, 0.5)}%`,
                                    background: COLORS[i % COLORS.length]
                                  }}
                                />
                              </div>
                              <span
                                className="w-12 text-right font-mono text-[11px]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {percent.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onConfirm={() => void handleTrash()}
        onCancel={() => !deletingPath && setPendingDelete(null)}
        title={t('confirmTrashTitle')}
        description={t('confirmTrashDescription', { name: pendingDelete?.name ?? '' })}
        confirmLabel={deletingPath ? t('movingToRecycleBin') : t('moveToRecycleBin')}
        variant="warning"
      />
    </div>
  )
}

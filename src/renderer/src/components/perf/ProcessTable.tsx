import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window'
import type { TFunction } from 'i18next'
import {
  Search,
  ArrowUpDown,
  Zap,
  X,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  AppWindow,
  Copy,
  FolderOpen,
  Info,
  SquareX
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatBytes } from '@/lib/utils'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { usePerfStore } from '@/stores/perf-store'
import type { PerfProcess } from '@shared/types'

interface ProcessRow {
  key: string
  groupKey: string
  process: PerfProcess
  depth: number
  hasChildren: boolean
  childCount: number
  groupSummary: boolean
  cpuPercent: number
  memBytes: number
}

interface ProcessGroup {
  key: string
  name: string
  processes: PerfProcess[]
}

function cpuBarColor(pct: number): string {
  if (pct >= 50) return '#ef4444'
  if (pct >= 20) return '#f59e0b'
  return '#22c55e'
}

const processColumns =
  'minmax(0, 2.1fr) minmax(62px, 0.55fr) minmax(150px, 1.35fr) minmax(104px, 0.9fr)'
const PROCESS_ROW_HEIGHT = 40
const PROCESS_VIEWPORT_HEIGHT = 460
const PROCESS_MENU_MARGIN = 8
const SEPARATE_PROCESS_INSTANCES = new Set(['svchost.exe', 'conhost.exe', 'dllhost.exe'])

interface ProcessContextMenuState {
  x: number
  y: number
  row: ProcessRow
}

function ProcessContextMenu({
  menu,
  expanded,
  onToggle,
  onEnd,
  onCopy,
  onOpenLocation,
  onShowDetails,
  onClose,
  t
}: {
  menu: ProcessContextMenuState
  expanded: boolean
  onToggle: () => void
  onEnd: () => void
  onCopy: (value: string) => void
  onOpenLocation: () => void
  onShowDetails: () => void
  onClose: () => void
  t: TFunction<'performance'>
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y, visible: false })
  const { process, hasChildren } = menu.row
  const hasPath = Boolean(process.executablePath)

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const maxLeft = window.innerWidth - element.offsetWidth - PROCESS_MENU_MARGIN
    const maxTop = window.innerHeight - element.offsetHeight - PROCESS_MENU_MARGIN
    setPosition({
      left: Math.max(PROCESS_MENU_MARGIN, Math.min(menu.x, maxLeft)),
      top: Math.max(PROCESS_MENU_MARGIN, Math.min(menu.y, maxTop)),
      visible: true
    })
  }, [menu.x, menu.y])

  useEffect(() => {
    const dismiss = () => onClose()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onClose])

  const itemClass =
    'process-context-menu-item flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const run = (action: () => void) => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={process.name}
      className="fixed z-[9999] min-w-[220px] max-w-[320px] rounded-lg py-1 shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden',
        background: 'var(--flyout-bg)',
        border: '1px solid var(--border-medium)',
        boxShadow: 'var(--glass-hover-shadow)'
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {hasChildren && (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onClick={() => run(onToggle)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {t(expanded ? 'processContextMenu.collapse' : 'processContextMenu.expand')}
        </button>
      )}
      {hasChildren && (
        <div className="my-1 border-t" style={{ borderColor: 'var(--border-default)' }} />
      )}
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        style={{ color: 'var(--danger)' }}
        onClick={() => run(onEnd)}
      >
        <SquareX className="h-3.5 w-3.5" />
        {t('processContextMenu.endProcess')}
      </button>
      <div className="my-1 border-t" style={{ borderColor: 'var(--border-default)' }} />
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
        onClick={() => run(() => onCopy(String(process.pid)))}
      >
        <Copy className="h-3.5 w-3.5" />
        {t('processContextMenu.copyPid')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
        onClick={() => run(() => onCopy(process.name))}
      >
        <Copy className="h-3.5 w-3.5" />
        {t('processContextMenu.copyName')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!hasPath}
        style={{ color: 'var(--text-primary)' }}
        onClick={() => run(() => onCopy(process.executablePath || ''))}
      >
        <Copy className="h-3.5 w-3.5" />
        {t('processContextMenu.copyPath')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!hasPath}
        style={{ color: 'var(--text-primary)' }}
        onClick={() => run(onOpenLocation)}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        {t('processContextMenu.openLocation')}
      </button>
      <div className="my-1 border-t" style={{ borderColor: 'var(--border-default)' }} />
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
        onClick={() => run(onShowDetails)}
      >
        <Info className="h-3.5 w-3.5" />
        {t('processContextMenu.properties')}
      </button>
    </div>,
    document.body
  )
}

function ProcessDetailsDialog({
  process,
  onClose,
  t
}: {
  process: PerfProcess
  onClose: () => void
  t: TFunction<'performance'>
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const details = [
    [t('columnPid'), String(process.pid)],
    [
      t('processContextMenu.parent'),
      process.parentName ? `${process.parentName} (PID ${process.parentPid})` : '—'
    ],
    [t('processContextMenu.account'), process.user || '—'],
    [t('processContextMenu.started'), process.started || '—'],
    [t('processContextMenu.cpu'), `${process.cpuPercent.toFixed(1)}%`],
    [t('processContextMenu.memory'), formatBytes(process.memBytes, 1)],
    [t('processContextMenu.memoryPercent'), `${process.memPercent.toFixed(1)}%`],
    [t('processContextMenu.path'), process.executablePath || '—']
  ]

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)' }}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="process-details-title"
        className="relative max-h-[min(80vh,620px)] w-full max-w-xl overflow-y-auto rounded-2xl p-5 shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {process.iconDataUrl ? (
              <img src={process.iconDataUrl} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <AppWindow className="h-7 w-7 text-zinc-400" />
            )}
            <div className="min-w-0">
              <h2
                id="process-details-title"
                className="truncate text-[15px] font-semibold text-white"
              >
                {t('processContextMenu.detailsTitle')}
              </h2>
              <p className="truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {process.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px]"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-subtle)' }}
          >
            {t('processContextMenu.close')}
          </button>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-xl p-3"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <dt
                className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                {label}
              </dt>
              <dd className="break-all text-[12px] text-zinc-200">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>,
    document.body
  )
}

function groupProcesses(processes: PerfProcess[]): ProcessGroup[] {
  const groups = new Map<string, ProcessGroup>()
  for (const process of processes) {
    const name = process.name.trim() || `PID ${process.pid}`
    const normalizedName = name.toLocaleLowerCase()
    // These generic Windows hosts can represent unrelated services or console
    // sessions, so keep each instance separate like Task Manager does.
    const key = SEPARATE_PROCESS_INSTANCES.has(normalizedName)
      ? `${normalizedName}:${process.pid}`
      : normalizedName
    const group = groups.get(key)
    if (group) group.processes.push(process)
    else groups.set(key, { key, name, processes: [process] })
  }
  return [...groups.values()]
}

function filterProcessGroups(groups: ProcessGroup[], query: string): ProcessGroup[] {
  if (!query) return groups
  return groups.flatMap((group) => {
    const matchingProcesses = group.processes.filter(
      (process) =>
        process.name.toLocaleLowerCase().includes(query) || String(process.pid).includes(query)
    )
    return matchingProcesses.length > 0 ? [{ ...group, processes: matchingProcesses }] : []
  })
}

function sortProcessGroups(
  groups: ProcessGroup[],
  column: 'cpuPercent' | 'memBytes' | 'name' | 'pid',
  direction: 'asc' | 'desc'
): ProcessGroup[] {
  return [...groups]
    .map((group) => ({
      ...group,
      // Keep instance order stable across live CPU updates so the group context
      // menu always targets the same process.
      processes: [...group.processes].sort((a, b) => a.pid - b.pid)
    }))
    .sort((a, b) => {
      let comparison = 0
      if (column === 'name') comparison = a.name.localeCompare(b.name)
      else if (column === 'pid') {
        comparison =
          Math.min(...a.processes.map((process) => process.pid)) -
          Math.min(...b.processes.map((process) => process.pid))
      } else {
        const aTotal = a.processes.reduce((sum, process) => sum + process[column], 0)
        const bTotal = b.processes.reduce((sum, process) => sum + process[column], 0)
        comparison = aTotal - bTotal
      }
      if (comparison === 0) comparison = a.name.localeCompare(b.name)
      return direction === 'asc' ? comparison : -comparison
    })
}

interface VirtualizedProcessRowProps {
  rows: ProcessRow[]
  collapsed: ReadonlySet<string>
  selectedPid: number | null
  toggleCollapsed: (groupKey: string) => void
  selectProcess: (pid: number) => void
  openContextMenu: (event: ReactMouseEvent<HTMLDivElement>, row: ProcessRow) => void
  t: TFunction<'performance'>
}

function VirtualizedProcessRow({
  ariaAttributes,
  index,
  style,
  rows,
  collapsed,
  selectedPid,
  toggleCollapsed,
  selectProcess,
  openContextMenu,
  t
}: RowComponentProps<VirtualizedProcessRowProps>) {
  const row = rows[index]
  if (!row) return null
  const { process, depth, hasChildren, childCount, groupKey, groupSummary } = row
  const expanded = !collapsed.has(groupKey)
  const lifecycle = process.lifecycle
  const selected = !groupSummary && selectedPid === process.pid

  return (
    <div
      {...ariaAttributes}
      role="row"
      aria-selected={selected}
      tabIndex={groupSummary ? -1 : 0}
      className={cn(
        'absolute grid items-center gap-3 border-b border-white/[0.045] border-l-2 px-3 transition-colors',
        groupSummary
          ? 'cursor-default'
          : 'cursor-pointer hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400/70',
        lifecycle === 'new' && !selected && 'atlas-process-row-new'
      )}
      onContextMenu={(event) => openContextMenu(event, row)}
      onClick={() => {
        if (!groupSummary) selectProcess(process.pid)
      }}
      onKeyDown={(event) => {
        if (!groupSummary && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          selectProcess(process.pid)
        }
      }}
      style={{
        ...style,
        gridTemplateColumns: processColumns,
        background: selected
          ? 'rgba(56, 189, 248, 0.17)'
          : groupSummary
            ? 'rgba(255,255,255,0.025)'
            : undefined,
        borderLeftColor: selected ? '#38bdf8' : groupSummary ? '#64748b' : 'transparent'
      }}
    >
      <div
        className="flex min-w-0 items-center gap-1.5"
        style={{ paddingLeft: `${Math.min(depth, 8) * 14}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(event) => {
              event.stopPropagation()
              toggleCollapsed(groupKey)
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            aria-label={t(collapsed.has(groupKey) ? 'expandProcess' : 'collapseProcess', {
              name: process.name
            })}
            aria-expanded={expanded}
          >
            {!expanded ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {process.iconDataUrl ? (
          <img
            src={process.iconDataUrl}
            alt=""
            className="h-4 w-4 shrink-0 object-contain"
            draggable={false}
          />
        ) : (
          <AppWindow className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        )}
        <span
          className={cn(
            'min-w-0 truncate text-[13px] font-medium',
            selected ? 'text-sky-100' : 'text-zinc-200'
          )}
          title={`${process.name} · PID ${process.pid}`}
        >
          {process.name}
        </span>
        {hasChildren && (
          <span
            className="shrink-0 text-[10px] tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            ({childCount})
          </span>
        )}
        {process.isStartupItem && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase"
            style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
            title={t('startupItemTooltip', { name: process.startupItemName })}
          >
            <Zap className="mr-0.5 inline h-2.5 w-2.5" />
            {t('startupBadge')}
          </span>
        )}
      </div>

      <span
        className="truncate text-right text-xs font-mono tabular-nums"
        style={{ color: selected ? '#bae6fd' : 'var(--text-muted)' }}
      >
        {groupSummary ? '—' : process.pid}
      </span>

      <div className="flex min-w-0 items-center gap-2">
        <div
          className="h-1.5 min-w-0 flex-1 rounded-full"
          style={{ background: 'var(--bg-subtle-2)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, row.cpuPercent))}%`,
              background: cpuBarColor(row.cpuPercent)
            }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-xs font-mono tabular-nums text-zinc-300">
          {row.cpuPercent.toFixed(1)}%
        </span>
      </div>

      <span className="truncate text-right text-xs font-mono tabular-nums text-zinc-300">
        {formatBytes(row.memBytes, 1)}
      </span>
    </div>
  )
}

function processRowKey(index: number, { rows }: VirtualizedProcessRowProps): string {
  return rows[index]?.key ?? `row-${index}`
}

export function ProcessTable() {
  const { t } = useTranslation('performance')
  const processList = usePerfStore((s) => s.processList)
  const processCount = usePerfStore((s) => s.processCount)
  const currentSnapshot = usePerfStore((s) => s.currentSnapshot)
  const filter = usePerfStore((s) => s.processFilter)
  const setFilter = usePerfStore((s) => s.setProcessFilter)
  const sortColumn = usePerfStore((s) => s.processSortColumn)
  const sortDir = usePerfStore((s) => s.processSortDir)
  const setSort = usePerfStore((s) => s.setProcessSort)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedPid, setSelectedPid] = useState<number | null>(null)
  const [killTarget, setKillTarget] = useState<PerfProcess | null>(null)
  const [contextMenu, setContextMenu] = useState<ProcessContextMenuState | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<PerfProcess | null>(null)
  const [killing, setKilling] = useState(false)
  const processListRef = useRef<ListImperativeAPI | null>(null)

  const rows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    const groups = sortProcessGroups(
      filterProcessGroups(groupProcesses(processList), query),
      sortColumn,
      sortDir
    )
    const result: ProcessRow[] = []

    for (const group of groups) {
      const groupProcessesSorted = group.processes
      const firstProcess = groupProcessesSorted[0]
      if (!firstProcess) continue
      const isGroup = groupProcessesSorted.length > 1
      if (isGroup) {
        result.push({
          key: `group:${group.key}`,
          groupKey: group.key,
          process: firstProcess,
          depth: 0,
          hasChildren: true,
          childCount: groupProcessesSorted.length,
          groupSummary: true,
          cpuPercent: groupProcessesSorted.reduce((sum, process) => sum + process.cpuPercent, 0),
          memBytes: groupProcessesSorted.reduce((sum, process) => sum + process.memBytes, 0)
        })
        if (!collapsed.has(group.key)) {
          for (const process of groupProcessesSorted) {
            result.push({
              key: `process:${process.pid}`,
              groupKey: group.key,
              process,
              depth: 1,
              hasChildren: false,
              childCount: 0,
              groupSummary: false,
              cpuPercent: process.cpuPercent,
              memBytes: process.memBytes
            })
          }
        }
      } else {
        result.push({
          key: `process:${firstProcess.pid}`,
          groupKey: group.key,
          process: firstProcess,
          depth: 0,
          hasChildren: false,
          childCount: 0,
          groupSummary: false,
          cpuPercent: firstProcess.cpuPercent,
          memBytes: firstProcess.memBytes
        })
      }
    }

    return result
  }, [processList, filter, sortColumn, sortDir, collapsed])

  const selectedProcess = useMemo(
    () => rows.find((row) => !row.groupSummary && row.process.pid === selectedPid)?.process ?? null,
    [rows, selectedPid]
  )

  useEffect(() => {
    if (selectedPid !== null && !selectedProcess) setSelectedPid(null)
  }, [selectedPid, selectedProcess])

  useEffect(() => {
    processListRef.current?.scrollToRow({ index: 0, align: 'start' })
  }, [filter, sortColumn, sortDir, collapsed])

  const processViewportHeight = Math.min(PROCESS_VIEWPORT_HEIGHT, rows.length * PROCESS_ROW_HEIGHT)

  const groupKeys = useMemo(
    () =>
      new Set(
        groupProcesses(processList)
          .filter((group) => group.processes.length > 1)
          .map((group) => group.key)
      ),
    [processList]
  )

  const toggleCollapsed = useCallback((groupKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  const requestKill = useCallback((process: PerfProcess) => setKillTarget(process), [])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>, row: ProcessRow) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, row })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const copyProcessValue = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        toast.success(t('processContextMenu.copied'))
      } catch {
        toast.error(t('processContextMenu.copyFailed'))
      }
    },
    [t]
  )

  const openProcessLocation = useCallback(
    async (process: PerfProcess) => {
      const executablePath = process.executablePath?.trim()
      if (!executablePath) {
        toast.error(t('processContextMenu.pathUnavailable'))
        return
      }
      try {
        await window.atlas.cleanerOpenLocation(executablePath)
      } catch {
        toast.error(t('processContextMenu.pathUnavailable'))
      }
    },
    [t]
  )

  const endProcess = useCallback(
    async (process: PerfProcess) => {
      setKilling(true)
      try {
        const result = await window.atlas.perfKillProcess(process.pid)
        if (result.success) {
          toast.success(t('endProcessSuccessToast', { name: process.name, pid: process.pid }))
          setSelectedPid((current) => (current === process.pid ? null : current))
        } else {
          toast.error(result.error || t('endProcessFailedToast'))
        }
      } catch {
        toast.error(t('endProcessFailedToast'))
      } finally {
        setKilling(false)
        setKillTarget(null)
      }
    },
    [t]
  )

  const handleKill = useCallback(async () => {
    if (killTarget) await endProcess(killTarget)
  }, [endProcess, killTarget])

  const selectedCanEnd = Boolean(selectedProcess && selectedProcess.lifecycle !== 'exiting')
  const endSelectedProcess = () => {
    if (selectedProcess && selectedCanEnd && !killing) void endProcess(selectedProcess)
  }

  const SortHeader = ({
    column,
    label,
    metric,
    align = 'left'
  }: {
    column: typeof sortColumn
    label: string
    metric?: string
    align?: 'left' | 'right'
  }) => (
    <button
      onClick={() => setSort(column)}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors',
        align === 'right' && 'justify-end text-right',
        sortColumn === column ? 'text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
      )}
      title={metric ? `${label}: ${metric}` : label}
    >
      <span className="truncate">{label}</span>
      <ArrowUpDown className="h-3 w-3 shrink-0" />
      {metric && (
        <span className="shrink-0 text-[10px] font-medium tracking-normal text-zinc-300">
          {metric}
        </span>
      )}
    </button>
  )

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold text-white">{t('processes')}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {processCount} {t('totalSuffix')}
          </span>
        </div>
        <div
          className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <Search className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('filterProcessesPlaceholder')}
            className="w-full bg-transparent text-[13px] text-zinc-200 placeholder-zinc-500 outline-none"
            style={{ width: 190 }}
          />
          {filter && (
            <button onClick={() => setFilter('')} aria-label={t('clearProcessFilter')}>
              <X className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
      >
        <div
          className="min-w-0 flex-1 text-xs"
          style={{ color: selectedProcess ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          {selectedProcess
            ? t('selectedProcessLabel', { name: selectedProcess.name, pid: selectedProcess.pid })
            : t('selectProcessHint')}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={endSelectedProcess}
            disabled={!selectedCanEnd || killing}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: selectedCanEnd ? '#fecaca' : 'var(--text-muted)',
              background: selectedCanEnd ? 'rgba(239,68,68,0.13)' : 'transparent',
              borderColor: selectedCanEnd ? 'rgba(248,113,113,0.35)' : 'var(--border-medium)'
            }}
            aria-label={t('endSelectedTask')}
          >
            <SquareX className="h-4 w-4" />
            {t('endSelectedTask')}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            disabled={groupKeys.size === 0}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-2 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
            title={t('expandAllProcesses')}
          >
            <ChevronsDownUp className="h-3 w-3" />
            {t('expandAll')}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set(groupKeys))}
            disabled={groupKeys.size === 0}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-2 text-[11px] disabled:opacity-40"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
            title={t('collapseAllProcesses')}
          >
            <ChevronsUpDown className="h-3 w-3" />
            {t('collapseAll')}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[590px]">
          <div
            className="mb-2 grid items-center gap-3 px-3"
            style={{ gridTemplateColumns: processColumns }}
          >
            <SortHeader column="name" label={t('columnName')} />
            <SortHeader column="pid" label={t('columnPid')} align="right" />
            <SortHeader
              column="cpuPercent"
              label={t('columnCpuPercent')}
              metric={
                currentSnapshot?.cpu.overall == null
                  ? '—'
                  : `${currentSnapshot.cpu.overall.toFixed(0)}%`
              }
            />
            <SortHeader
              column="memBytes"
              label={t('columnMemory')}
              metric={`${currentSnapshot?.memory.percent.toFixed(0) ?? '—'}%`}
              align="right"
            />
          </div>

          {rows.length === 0 ? (
            <div
              className="px-2 py-6 text-center text-[12px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('noProcessesFound')}
            </div>
          ) : (
            <List<VirtualizedProcessRowProps>
              listRef={processListRef}
              className="overflow-y-auto pr-1"
              defaultHeight={processViewportHeight}
              rowComponent={VirtualizedProcessRow}
              rowCount={rows.length}
              rowHeight={PROCESS_ROW_HEIGHT}
              rowKey={processRowKey}
              rowProps={{
                rows,
                collapsed,
                selectedPid,
                toggleCollapsed,
                selectProcess: setSelectedPid,
                openContextMenu,
                t
              }}
              overscanCount={8}
              style={{ height: processViewportHeight, width: '100%' }}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!killTarget}
        onConfirm={handleKill}
        onCancel={() => setKillTarget(null)}
        title={t('endProcessTitle', { name: killTarget?.name ?? 'process' })}
        description={t('endProcessDescription', { name: killTarget?.name, pid: killTarget?.pid })}
        confirmLabel={killing ? t('endProcessEnding') : t('endProcessConfirm')}
        variant="danger"
      />

      {contextMenu && (
        <ProcessContextMenu
          menu={contextMenu}
          expanded={!collapsed.has(contextMenu.row.groupKey)}
          onToggle={() => toggleCollapsed(contextMenu.row.groupKey)}
          onEnd={() => requestKill(contextMenu.row.process)}
          onCopy={(value) => void copyProcessValue(value)}
          onOpenLocation={() => void openProcessLocation(contextMenu.row.process)}
          onShowDetails={() => setDetailsTarget(contextMenu.row.process)}
          onClose={closeContextMenu}
          t={t}
        />
      )}

      {detailsTarget && (
        <ProcessDetailsDialog
          process={detailsTarget}
          onClose={() => setDetailsTarget(null)}
          t={t}
        />
      )}
    </div>
  )
}

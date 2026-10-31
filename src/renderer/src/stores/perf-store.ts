import { create } from 'zustand'
import type { PerfSystemInfo, PerfSnapshot, PerfProcess, DiskSmartInfo } from '@shared/types'

const MAX_HISTORY = 900 // 15 minutes at 1s intervals
const CHART_THROTTLE_MS = 2000 // Only update chart-facing history every 2s
const NEW_PROCESS_MS = 3000
const EXITING_PROCESS_MS = 1500
let processLifecycleTimer: ReturnType<typeof setTimeout> | null = null
const processIconCache = new Map<string, string>()
const MAX_PROCESS_ICONS = 128

function scheduleProcessLifecycleCleanup(
  getProcesses: () => PerfProcess[],
  setProcesses: (processes: PerfProcess[]) => void
): void {
  if (processLifecycleTimer) clearTimeout(processLifecycleTimer)
  processLifecycleTimer = null
  const processes = getProcesses()
  const nextExpiry = processes.reduce((earliest, process) => {
    return process.lifecycleExpiresAt == null
      ? earliest
      : Math.min(earliest, process.lifecycleExpiresAt)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(nextExpiry)) return

  processLifecycleTimer = setTimeout(
    () => {
      processLifecycleTimer = null
      const refreshed = getProcesses().flatMap((process) => {
        if (process.lifecycleExpiresAt == null || process.lifecycleExpiresAt > Date.now())
          return [process]
        if (process.lifecycle === 'exiting') return []
        const { lifecycle: _lifecycle, lifecycleExpiresAt: _expiresAt, ...stableProcess } = process
        return [stableProcess]
      })
      setProcesses(refreshed)
      scheduleProcessLifecycleCleanup(getProcesses, setProcesses)
    },
    Math.max(0, nextExpiry - Date.now())
  )
}

interface PerfState {
  systemInfo: PerfSystemInfo | null
  currentSnapshot: PerfSnapshot | null
  /** Ring buffer backing store — mutated in place to avoid GC pressure */
  _ringBuffer: PerfSnapshot[]
  _ringWriteIndex: number
  _ringSize: number
  /**
   * Snapshot of the ring buffer exposed to React — only updated every CHART_THROTTLE_MS
   * to avoid re-rendering charts on every 1s tick.
   */
  history: PerfSnapshot[]
  _lastHistoryFlush: number
  processList: PerfProcess[]
  processCount: number
  _hasProcessSnapshot: boolean
  isMonitoring: boolean
  timeRange: '60s' | '5m' | '15m'
  processFilter: string
  processSortColumn: 'cpuPercent' | 'memBytes' | 'name' | 'pid'
  processSortDir: 'asc' | 'desc'
  diskHealth: DiskSmartInfo[]

  setSystemInfo: (info: PerfSystemInfo) => void
  pushSnapshot: (snap: PerfSnapshot) => void
  setProcessList: (processes: PerfProcess[], totalCount: number) => void
  setMonitoring: (on: boolean) => void
  setTimeRange: (range: '60s' | '5m' | '15m') => void
  setProcessFilter: (filter: string) => void
  setProcessSort: (column: PerfState['processSortColumn']) => void
  setDiskHealth: (disks: DiskSmartInfo[]) => void
  reset: () => void
}

function ringToArray(buf: PerfSnapshot[], writeIdx: number, size: number): PerfSnapshot[] {
  if (size === 0) return []
  if (size <= buf.length) {
    // Buffer not yet wrapped — just slice
    const start = writeIdx - size
    if (start >= 0) return buf.slice(start, writeIdx)
    // Wrapped — concat tail + head
    return buf.slice(buf.length + start).concat(buf.slice(0, writeIdx))
  }
  return buf.slice(0, size)
}

export const usePerfStore = create<PerfState>((set, get) => ({
  systemInfo: null,
  currentSnapshot: null,
  _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
  _ringWriteIndex: 0,
  _ringSize: 0,
  history: [],
  _lastHistoryFlush: 0,
  processList: [],
  processCount: 0,
  _hasProcessSnapshot: false,
  isMonitoring: false,
  timeRange: '60s',
  processFilter: '',
  processSortColumn: 'cpuPercent',
  processSortDir: 'desc',
  diskHealth: [],

  setSystemInfo: (info) => set({ systemInfo: info }),

  pushSnapshot: (snap) => {
    const state = get()
    const buf = state._ringBuffer
    const idx = state._ringWriteIndex
    buf[idx] = snap
    const nextIdx = (idx + 1) % MAX_HISTORY
    const nextSize = Math.min(state._ringSize + 1, MAX_HISTORY)

    const now = Date.now()
    const shouldFlush = now - state._lastHistoryFlush >= CHART_THROTTLE_MS

    if (shouldFlush) {
      set({
        currentSnapshot: snap,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize,
        history: ringToArray(buf, nextIdx, nextSize),
        _lastHistoryFlush: now
      })
    } else {
      set({
        currentSnapshot: snap,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize
      })
    }
  },

  setProcessList: (processes, totalCount) => {
    const previous = get().processList
    const hasSnapshot = get()._hasProcessSnapshot
    const now = Date.now()
    const previousByPid = new Map(previous.map((process) => [process.pid, process]))
    const processesWithIcons = processes.map((process) => {
      if (process.iconKey && process.iconDataUrl) {
        processIconCache.delete(process.iconKey)
        processIconCache.set(process.iconKey, process.iconDataUrl)
        if (processIconCache.size > MAX_PROCESS_ICONS) {
          const oldestKey = processIconCache.keys().next().value
          if (oldestKey) processIconCache.delete(oldestKey)
        }
      }
      const iconDataUrl =
        process.iconDataUrl ||
        (process.iconKey ? processIconCache.get(process.iconKey) : undefined) ||
        previousByPid.get(process.pid)?.iconDataUrl
      return iconDataUrl ? { ...process, iconDataUrl } : process
    })
    const incomingPids = new Set(processesWithIcons.map((process) => process.pid))

    const nextProcesses = processesWithIcons.map((process) => {
      const old = previousByPid.get(process.pid)
      const pidWasReused =
        !!old && !!old.started && !!process.started && old.started !== process.started
      if (!hasSnapshot || !old || pidWasReused) {
        return hasSnapshot
          ? { ...process, lifecycle: 'new' as const, lifecycleExpiresAt: now + NEW_PROCESS_MS }
          : process
      }
      if (old.lifecycle === 'new' && (old.lifecycleExpiresAt ?? 0) > now) return old
      return process
    })

    if (hasSnapshot) {
      for (const old of previous) {
        if (incomingPids.has(old.pid)) continue
        if (old.lifecycle === 'exiting' && (old.lifecycleExpiresAt ?? 0) > now) {
          nextProcesses.push(old)
        } else if (old.lifecycle !== 'exiting') {
          nextProcesses.push({
            ...old,
            lifecycle: 'exiting',
            lifecycleExpiresAt: now + EXITING_PROCESS_MS
          })
        }
      }
    }

    set({ processList: nextProcesses, processCount: totalCount, _hasProcessSnapshot: true })
    scheduleProcessLifecycleCleanup(
      () => get().processList,
      (updated) => set({ processList: updated })
    )
  },

  setMonitoring: (on) => set({ isMonitoring: on }),

  setTimeRange: (range) => set({ timeRange: range }),

  setProcessFilter: (filter) => set({ processFilter: filter }),

  setDiskHealth: (disks) => set({ diskHealth: disks }),

  setProcessSort: (column) => {
    const { processSortColumn, processSortDir } = get()
    if (processSortColumn === column) {
      set({ processSortDir: processSortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ processSortColumn: column, processSortDir: 'desc' })
    }
  },

  reset: () => {
    if (processLifecycleTimer) clearTimeout(processLifecycleTimer)
    processLifecycleTimer = null
    processIconCache.clear()
    set({
      currentSnapshot: null,
      _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
      _ringWriteIndex: 0,
      _ringSize: 0,
      history: [],
      _lastHistoryFlush: 0,
      processList: [],
      processCount: 0,
      _hasProcessSnapshot: false,
      isMonitoring: false,
      processFilter: '',
      diskHealth: []
    })
  }
}))

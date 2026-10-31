import * as si from 'systeminformation'
import * as os from 'os'
import { app } from 'electron'
import { execFile, spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { IPC } from '../../shared/channels'
import type {
  PerfSystemInfo,
  PerfSnapshot,
  PerfProcess,
  PerfProcessList,
  PerfKillResult,
  DiskSmartInfo,
  SensorDriverStatus,
  PawnIoInstallResult,
  StartupItem,
  PerfOverlayStats
} from '../../shared/types'
import { psUtf8 } from './exec-utf8'
import { readNativeSmart } from './disk-smart-native'
import {
  getNativeProcessMonitorUnavailableReason,
  readNativeProcessSnapshot
} from './process-monitor-native'

const execFileAsync = promisify(execFile)
const CPU_DISPLAY_WINDOW_MS = 1000

type VolumeInfo = Omit<PerfOverlayStats['disks'][number], 'busyPercent'>

interface ProcessSnapshotEntry {
  pid: number
  parentPid?: number | null
  name: string
  path?: string
  cpu: number
  memRss: number
  user?: string
  started?: string
}

type BridgeState = 'unsupported' | 'missing' | 'starting' | 'running' | 'exited' | 'error'

/** Parses the JSON printed by the PowerShell logical-disk fallback. */
export function parseLogicalDisks(stdout: string): VolumeInfo[] {
  const text = stdout.trim()
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const volumes: VolumeInfo[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    if (!row || typeof row !== 'object') continue
    const mount = String(row.DeviceID ?? '').trim()
    const size = Number(row.Size)
    const free = Number(row.FreeSpace)
    if (!mount || !Number.isFinite(size) || size <= 0) continue
    const available = Number.isFinite(free) && free >= 0 ? Math.min(free, size) : 0
    const used = size - available
    volumes.push({
      mount,
      sizeBytes: size,
      usedBytes: used,
      availableBytes: available,
      percent: (used / size) * 100
    })
  }
  return volumes
}

// PowerShell helper shared by the sensor script and the live sampler: WDDM GPU
// Engine instances are summed per engine (across processes) and the busiest
// engine is the GPU utilization, like Task Manager.
const PS_WDDM_GPU_LOAD_FN = `function Get-WddmGpuLoad($items){
  $byEngine=@{}
  foreach($it in $items){
    $v=[double]$it.Value
    if([double]::IsNaN($v) -or [double]::IsInfinity($v) -or $v -lt 0){ continue }
    $key=([string]$it.Name) -replace '^pid_[0-9]+_',''
    if($byEngine.ContainsKey($key)){ $byEngine[$key]+=$v } else { $byEngine[$key]=$v }
  }
  $best=$null
  foreach($k in $byEngine.Keys){
    $x=[math]::Min(100.0,[double]$byEngine[$k])
    if($null -eq $best -or $x -gt $best){ $best=$x }
  }
  return $best
}
`

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private processTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private cachedSystemInfo: PerfSystemInfo | null = null
  private startupExeMap: Map<string, string> = new Map()
  private processIconCache = new Map<string, string | null>()
  private processIconSentAt = new Map<string, number>()
  private windowsServicePids = new Set<number>()
  private windowsServicePidsAt = 0
  private parentPidFallbackMap = new Map<number, number>()
  private parentPidFallbackAt = 0
  // Guards to prevent overlapping async calls from piling up if si hangs
  private snapshotRunning = false
  private processesRunning = false
  private nativeProcessFallbackLogged = false
  private nativeProcessFallbackAt = 0
  // Network statistics invoke platform-specific helpers on Windows. Poll
  // infrequently; throughput is informational and does not need second-level updates.
  private cachedNetworkStats = { rxBytesPerSec: 0, txBytesPerSec: 0 }
  private lastNetworkPoll = 0
  private readonly NETWORK_POLL_INTERVAL_MS = 30000
  // Mounted volumes (capacity/usage) for the overlay. Deliberately independent
  // from the 1 s snapshot loop: it has its own timestamp, so the snapshot loop
  // can never keep the cache "fresh" while it is actually empty.
  private diskVolumes: VolumeInfo[] = []
  private diskVolumesAt = 0
  private diskVolumesFetch: Promise<void> | null = null
  // Disk health invokes several system utilities, including PowerShell. Share
  // an in-flight read so page startup, StrictMode remounts, and refresh ticks
  // cannot launch duplicate scans at the same time.
  private diskHealthFetch: Promise<DiskSmartInfo[]> | null = null
  private diskHealthCache: { at: number; value: DiskSmartInfo[] } | null = null
  private readonly DISK_VOLUMES_POLL_MS = 120000
  private readonly DISK_VOLUMES_RETRY_MS = 60000
  // Single authoritative snapshot shared by the Performance page and overlay.
  private latestSnapshot: PerfSnapshot | null = null
  private windowsHardwareCache = {
    at: 0,
    gpu: [] as PerfOverlayStats['gpu'],
    cpuLoadPercent: null as number | null,
    cpuTemperature: null as number | null,
    gpuTemperature: null as number | null,
    diskReadBytesPerSec: 0,
    diskWriteBytesPerSec: 0,
    diskBusyPercent: null as number | null
  }
  // The Windows fallback queries WMI/CIM and several performance counters.
  // Keep it deliberately slower than the live counter samplers below: this
  // data supplements sensor values and does not need a two-second refresh.
  private readonly WINDOWS_HARDWARE_POLL_MS = 30000
  private hardwareBridge: ChildProcessByStdio<null, Readable, Readable> | null = null
  private previousCpuTimes: { idle: number; total: number; logicalCpus: number } | null = null
  private lastCpuLoad: number | null = null
  private lastCpuLoadAt = 0
  private cpuDisplaySamples: Array<{ at: number; value: number }> = []
  private cpuDisplaySampleAt = 0
  private cpuDisplaySource: string | null = null

  /** Calculate average CPU busy time from Node's cumulative logical-CPU ticks. */
  private sampleNodeCpuUsage(): number | null {
    const cpus = os.cpus()
    if (cpus.length === 0) {
      this.previousCpuTimes = null
      return null
    }

    let idle = 0
    let total = 0
    for (const cpu of cpus) {
      idle += cpu.times.idle
      total += Object.values(cpu.times).reduce((sum, ticks) => sum + ticks, 0)
    }

    const previous = this.previousCpuTimes
    this.previousCpuTimes = { idle, total, logicalCpus: cpus.length }
    if (!previous || previous.logicalCpus !== cpus.length) return null

    const idleDelta = idle - previous.idle
    const totalDelta = total - previous.total
    if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) return null

    const usage = 100 - Math.round((100 * idleDelta) / totalDelta)
    return Math.min(100, Math.max(0, usage))
  }

  getQuickStats(): {
    cpuPercent: number | null
    memUsedBytes: number
    memTotalBytes: number
    memPercent: number
  } {
    const cpuPercent = this.resolveCpuOverall(this.sampleNodeCpuUsage())
    const memTotalBytes = os.totalmem()
    const memUsedBytes = memTotalBytes - os.freemem()
    return {
      cpuPercent,
      memUsedBytes,
      memTotalBytes,
      memPercent: memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0
    }
  }

  /** Use the same OS tick delta as the low-overhead Windows CPU sampler. */
  private sampleCpuUsage(): number | null {
    if (process.platform === 'win32') {
      const live = this.live && Date.now() - this.live.cpuAt <= 2500 ? this.live : null
      const cpuPercent = live?.cpuPercent
      if (
        live &&
        typeof cpuPercent === 'number' &&
        Number.isFinite(cpuPercent) &&
        cpuPercent >= 0
      ) {
        // Keep the display window aligned with Resource Monitor's roughly
        // one-second refresh instead of smoothing across five seconds.
        // Keep each source's samples isolated when the fallback changes.
        if (live.cpuSource !== this.cpuDisplaySource) {
          this.cpuDisplaySamples = []
          this.cpuDisplaySampleAt = 0
          this.cpuDisplaySource = live.cpuSource
        }
        if (live.cpuAt > this.cpuDisplaySampleAt) {
          this.cpuDisplaySamples.push({ at: live.cpuAt, value: Math.min(100, cpuPercent) })
          this.cpuDisplaySampleAt = live.cpuAt
        }
        const cutoff = Date.now() - CPU_DISPLAY_WINDOW_MS
        this.cpuDisplaySamples = this.cpuDisplaySamples.filter((sample) => sample.at >= cutoff)
        if (this.cpuDisplaySamples.length > 0) {
          const average =
            this.cpuDisplaySamples.reduce((sum, sample) => sum + sample.value, 0) /
            this.cpuDisplaySamples.length
          return Math.min(100, Math.max(0, average))
        }
      }
      // The OS tick sample above is intentionally the Windows source. It is
      // lightweight and avoids a dedicated PowerShell process for CPU alone.
      return null
    }
    return this.sampleNodeCpuUsage()
  }

  private resolveCpuOverall(sampledValue: number | null): number | null {
    if (sampledValue != null && Number.isFinite(sampledValue)) {
      this.lastCpuLoad = Math.min(100, Math.max(0, sampledValue))
      this.lastCpuLoadAt = Date.now()
      return this.lastCpuLoad
    }
    // Briefly retain the last sample while a fresh interval is established.
    return this.lastCpuLoad != null && Date.now() - this.lastCpuLoadAt <= 3000
      ? this.lastCpuLoad
      : null
  }

  private async resolveProcessIcon(executablePath: string): Promise<string | null> {
    const key = executablePath.trim().toLocaleLowerCase()
    if (!key) return null
    if (this.processIconCache.has(key)) return this.processIconCache.get(key) ?? null
    try {
      const image = await app.getFileIcon(executablePath, { size: 'small' })
      const icon = image.isEmpty() ? null : image.toDataURL()
      this.processIconCache.set(key, icon)
      if (this.processIconCache.size > 128) {
        const oldestKey = this.processIconCache.keys().next().value
        if (oldestKey) {
          this.processIconCache.delete(oldestKey)
          this.processIconSentAt.delete(oldestKey)
        }
      }
      return icon
    } catch {
      this.processIconCache.set(key, null)
      return null
    }
  }

  private async getWindowsServicePids(): Promise<Set<number>> {
    if (process.platform !== 'win32') return this.windowsServicePids
    // The process table is useful immediately; defer the optional service
    // label lookup until it has stayed open for a minute. systeminformation
    // implements this Windows query with PowerShell.
    if (this.windowsServicePidsAt === 0) {
      this.windowsServicePidsAt = Date.now()
      return this.windowsServicePids
    }
    // Service-to-process mapping is only a grouping hint in the UI. Refreshing
    // it every minute avoids repeatedly invoking systeminformation's PowerShell
    // based Windows service query while the process table is open.
    if (Date.now() - this.windowsServicePidsAt < 300000) return this.windowsServicePids
    this.windowsServicePidsAt = Date.now()
    try {
      const services = await si.services('*')
      this.windowsServicePids = new Set(
        services.filter((service) => service.running).flatMap((service) => service.pids)
      )
    } catch {
      // Keep the last service snapshot; process display should remain available.
    }
    return this.windowsServicePids
  }
  private hardwareBridgeBuffer = ''
  private latestHardwareBridgeData: {
    cpu?: { load?: number | null; temperature?: number | null }
    gpus?: Array<{
      name: string
      load?: number | null
      temperature?: number | null
      memoryUsedBytes?: number | null
      memoryTotalBytes?: number | null
    }>
    storage?: Array<{
      name: string
      readBytesPerSec?: number | null
      writeBytesPerSec?: number | null
      busyPercent?: number | null
      temperature?: number | null
      remainingLifePercent?: number | null
      percentUsed?: number | null
      availableSparePercent?: number | null
    }>
  } | null = null
  private hardwareBridgeStarting: Promise<void> | null = null

  private bridgeState: BridgeState = process.platform === 'win32' ? 'starting' : 'unsupported'
  private bridgePath: string | null = null
  private bridgeSpawnedAt = 0
  private bridgeLastDataAt = 0
  private bridgeRespawnAt = 0
  private bridgeExitCount = 0
  private bridgeStderr = ''
  private bridgeElevated: boolean | null = null

  /** Every place the collector may live: packaged app, portable build, dev tree. */
  private getHardwareBridgeCandidates(): string[] {
    const exe = 'LibreHardwareMonitorBridge.exe'
    const dirs: string[] = []
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    if (resourcesPath) dirs.push(join(resourcesPath, 'hardware-bridge'))
    dirs.push(join(dirname(process.execPath), 'resources', 'hardware-bridge'))
    dirs.push(join(process.cwd(), 'resources', 'hardware-bridge'))
    if (typeof __dirname === 'string') {
      dirs.push(join(__dirname, '..', '..', 'resources', 'hardware-bridge'))
      dirs.push(join(__dirname, '..', '..', '..', 'resources', 'hardware-bridge'))
    }
    return [...new Set(dirs)].map((d) => join(d, exe))
  }

  private getHardwareBridgePath(): string | null {
    return this.getHardwareBridgeCandidates().find((candidate) => existsSync(candidate)) ?? null
  }

  private async ensureHardwareBridge(): Promise<void> {
    if (process.platform !== 'win32') return
    if (this.hardwareBridge && !this.hardwareBridge.killed) return
    if (this.hardwareBridgeStarting) return this.hardwareBridgeStarting
    if (Date.now() < this.bridgeRespawnAt) return

    this.hardwareBridgeStarting = (async () => {
      const executable = this.getHardwareBridgePath()
      if (!executable) {
        if (this.bridgeState !== 'missing') {
          console.warn(
            '[perf-monitor] LibreHardwareMonitorBridge.exe não encontrado. Procurado em:',
            this.getHardwareBridgeCandidates()
          )
        }
        this.bridgeState = 'missing'
        this.bridgePath = null
        // Re-check later: the user may build the collector while Atlas is open.
        this.bridgeRespawnAt = Date.now() + 10000
        return
      }

      try {
        const child = spawn(executable, [], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        this.hardwareBridge = child
        this.hardwareBridgeBuffer = ''
        this.bridgePath = executable
        this.bridgeState = 'starting'
        this.bridgeSpawnedAt = Date.now()
        this.bridgeStderr = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          this.hardwareBridgeBuffer += chunk
          const lines = this.hardwareBridgeBuffer.split(/\r?\n/)
          this.hardwareBridgeBuffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed && typeof parsed === 'object' && parsed.version === 1) {
                this.latestHardwareBridgeData = parsed
                this.bridgeLastDataAt = Date.now()
                this.bridgeState = 'running'
                this.bridgeExitCount = 0
                if (typeof parsed.elevated === 'boolean') this.bridgeElevated = parsed.elevated
              }
            } catch {
              // Ignore diagnostic/non-JSON output.
            }
          }
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          this.bridgeStderr = (this.bridgeStderr + chunk).slice(-1000)
        })
        const onGone = (state: BridgeState, reason: string): void => {
          if (this.hardwareBridge !== child) return
          this.hardwareBridge = null
          this.bridgeState = state
          this.bridgeExitCount++
          // Exponential back-off (3 s .. 60 s) so a crashing collector is not respawned every tick.
          this.bridgeRespawnAt =
            Date.now() + Math.min(60000, 3000 * 2 ** Math.min(this.bridgeExitCount, 5))
          console.warn(
            `[perf-monitor] coletor de hardware parou (${reason}). ${this.bridgeStderr.trim().split(/\r?\n/).slice(-2).join(' | ')}`
          )
        }
        child.once('exit', (code) => onGone('exited', `código ${code}`))
        child.once('error', (err) => onGone('error', err.message))
        process.once('exit', () => {
          try {
            child.kill()
          } catch {
            /* already gone */
          }
        })
      } catch (err) {
        this.hardwareBridge = null
        this.bridgeState = 'error'
        this.bridgeStderr = err instanceof Error ? err.message : String(err)
        this.bridgeRespawnAt = Date.now() + 10000
      }
    })().finally(() => {
      this.hardwareBridgeStarting = null
    })

    return this.hardwareBridgeStarting
  }

  private stopHardwareBridge(): void {
    const child = this.hardwareBridge
    this.hardwareBridge = null
    this.latestHardwareBridgeData = null
    this.bridgeLastDataAt = 0
    if (child && !child.killed) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
  }

  /** Human-readable reason why a temperature is missing, or null when nothing is wrong. */
  getSensorHint(cpuTemperature: number | null, gpuTemperature: number | null): string | null {
    if (process.platform !== 'win32') return null
    if (cpuTemperature != null && gpuTemperature != null) return null
    const lastError = this.bridgeStderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
    switch (this.bridgeState) {
      case 'missing':
        return 'Coletor de sensores ausente (LibreHardwareMonitorBridge.exe). Execute: npm run build:hardware-bridge'
      case 'exited':
      case 'error':
        return `Coletor de sensores parou${lastError ? `: ${lastError}` : ''}`
      case 'starting':
        return Date.now() - this.bridgeSpawnedAt > 15000
          ? 'Coletor de sensores não respondeu'
          : null
      case 'running':
        if (cpuTemperature == null && this.bridgeElevated === false) {
          return 'Sem temperatura da CPU: execute o Atlas como administrador'
        }
        if (cpuTemperature == null) {
          return 'A CPU não expôs sensor de temperatura (driver de sensores ausente ou bloqueado pelo antivírus)'
        }
        return 'A GPU não expôs sensor de temperatura'
      default:
        return null
    }
  }

  private mergeLibreHardwareMonitor(
    cache: typeof this.windowsHardwareCache,
    lhm: NonNullable<PerfMonitorService['latestHardwareBridgeData']>
  ): typeof this.windowsHardwareCache {
    const finite = (v: unknown) =>
      v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null
    const temp = (v: unknown) => {
      const n = finite(v)
      return n != null && n > 0 && n < 150 ? n : null
    }
    const gpus = Array.isArray(lhm.gpus) ? lhm.gpus : []
    const storage = Array.isArray(lhm.storage) ? lhm.storage : []
    const gpu = gpus.map((g, i) => {
      const existing = cache.gpu[i]
      return {
        name: String(g.name || existing?.name || 'GPU'),
        // On Windows, the WDDM GPU Engine value is the authoritative usage
        // metric. LibreHardwareMonitor is used for temperature/VRAM and only
        // supplies load when Windows did not provide one.
        loadPercent: existing?.loadPercent ?? finite(g.load) ?? null,
        temperature: temp(g.temperature) ?? existing?.temperature ?? null,
        memoryUsedBytes: finite(g.memoryUsedBytes) ?? existing?.memoryUsedBytes ?? null,
        memoryTotalBytes: finite(g.memoryTotalBytes) ?? existing?.memoryTotalBytes ?? null
      }
    })
    if (gpu.length === 0) gpu.push(...cache.gpu)

    const read = storage.reduce((sum, d) => sum + Math.max(0, finite(d.readBytesPerSec) ?? 0), 0)
    const write = storage.reduce((sum, d) => sum + Math.max(0, finite(d.writeBytesPerSec) ?? 0), 0)
    const busyValues = storage
      .map((d) => finite(d.busyPercent))
      .filter((v): v is number => v != null && v >= 0 && v <= 100)

    return {
      ...cache,
      gpu,
      cpuLoadPercent: finite(lhm.cpu?.load) ?? cache.cpuLoadPercent,
      cpuTemperature: temp(lhm.cpu?.temperature) ?? cache.cpuTemperature,
      gpuTemperature: temp(gpus[0]?.temperature) ?? cache.gpuTemperature,
      diskReadBytesPerSec: storage.length ? read : cache.diskReadBytesPerSec,
      diskWriteBytesPerSec: storage.length ? write : cache.diskWriteBytesPerSec,
      diskBusyPercent: busyValues.length ? Math.max(...busyValues) : cache.diskBusyPercent
    }
  }

  // CPU usage uses Node's OS tick counters; Windows hardware metrics arrive
  // through the persistent LibreHardwareMonitor bridge. This avoids keeping
  // multiple PowerShell processes alive for routine performance monitoring.
  private cpuFallbackTimer: ReturnType<typeof setInterval> | null = null
  private live: {
    at: number
    cpuAt: number
    cpuPercent: number | null
    cpuSource: string | null
  } | null = null

  private ensureCpuSampler(): void {
    if (process.platform !== 'win32' || this.cpuFallbackTimer) return
    this.previousCpuTimes = null
    this.sampleNodeCpuUsage()
    this.cpuFallbackTimer = setInterval(() => {
      const usage = this.sampleNodeCpuUsage()
      if (usage === null) return
      const now = Date.now()
      this.live = {
        ...(this.live ?? {
          at: now,
          cpuAt: 0,
          cpuPercent: null,
          cpuSource: null
        }),
        at: now,
        cpuAt: now,
        cpuPercent: usage,
        cpuSource: 'OS-Ticks'
      }
    }, 1000)
    this.cpuFallbackTimer.unref?.()
  }

  private stopLiveSampler(): void {
    if (this.cpuFallbackTimer) clearInterval(this.cpuFallbackTimer)
    this.cpuFallbackTimer = null
    this.live = null
  }

  private lastTickError = ''
  private hardwareRefresh: Promise<void> | null = null
  private async getWindowsHardwareFallback(): Promise<typeof this.windowsHardwareCache> {
    if (process.platform !== 'win32') return this.windowsHardwareCache
    const now = Date.now()
    await this.ensureHardwareBridge()
    // The bundled hardware bridge already supplies temperatures, GPU load, and
    // disk counters. Do not launch the PowerShell fallback while that stream is
    // healthy; it duplicates the same measurements and costs much more CPU.
    if (this.latestHardwareBridgeData && now - this.bridgeLastDataAt <= 5000) {
      this.windowsHardwareCache = this.mergeLibreHardwareMonitor(
        this.windowsHardwareCache,
        this.latestHardwareBridgeData
      )
      return this.windowsHardwareCache
    }

    // Give the bundled collector time to publish its first sample before
    // falling back to a one-shot PowerShell query at monitor startup.
    if (this.bridgeState === 'starting' && now - this.bridgeSpawnedAt < 10000) {
      return this.windowsHardwareCache
    }

    // Use the PowerShell fallback only when the bridge is unavailable, and
    // keep the retry interval low-frequency.
    if (
      now - this.windowsHardwareCache.at >= this.WINDOWS_HARDWARE_POLL_MS &&
      !this.hardwareRefresh
    ) {
      this.hardwareRefresh = this.refreshWindowsHardware()
        .then(
          () => undefined,
          () => undefined
        )
        .finally(() => {
          this.hardwareRefresh = null
        })
    }
    return this.windowsHardwareCache
  }

  private async refreshWindowsHardware(): Promise<typeof this.windowsHardwareCache> {
    const now = Date.now()
    const script = `
$ErrorActionPreference='SilentlyContinue'
$gpus=@()
# NVIDIA gives authoritative load, VRAM and temperature when the vendor utility is available.
# Try PATH first, then the standard NVIDIA NVSMI installation path because
# nvidia-smi is not always present in the user's PATH.
try {
  $nvExe = $null
  $cmd = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if($cmd){ $nvExe = $cmd.Source }
  if(-not $nvExe){
    $candidates = @(
      (Join-Path $env:ProgramFiles 'NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'),
      (Join-Path $env:ProgramW6432 'NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'),
      (Join-Path $env:SystemRoot 'System32\\nvidia-smi.exe')
    )
    $nvExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  }
  if($nvExe){ $nvs = & $nvExe --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>$null }
  foreach($line in @($nvs)){
    if([string]::IsNullOrWhiteSpace([string]$line)){ continue }
    $p=$line -split ',\\s*',5
    if($p.Count -ge 5){
      $load=[double]::NaN; $mu=[double]::NaN; $mt=[double]::NaN; $temp=[double]::NaN
      [double]::TryParse($p[1].Trim(), [ref]$load) | Out-Null
      [double]::TryParse($p[2].Trim(), [ref]$mu) | Out-Null
      [double]::TryParse($p[3].Trim(), [ref]$mt) | Out-Null
      [double]::TryParse($p[4].Trim(), [ref]$temp) | Out-Null
      $gpus += [pscustomobject]@{Name=$p[0].Trim(); Load=$load; MemUsedMB=$mu; MemTotalMB=$mt; Temp=$temp}
    }
  }
} catch {}

# Windows fallback for AMD / Intel / NVIDIA.
# GPU Engine is vendor-neutral and works with WDDM drivers; do not depend on
# nvidia-smi for AMD/Intel systems. Keep the adapter identity even if usage
# counters are temporarily unavailable.
if($gpus.Count -eq 0){
  try {
    $vc = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name })
    foreach($v in $vc){
      $memTotal = [double]::NaN
      try { if($v.AdapterRAM -and [double]$v.AdapterRAM -lt 4290000000){ $memTotal = [math]::Round([double]$v.AdapterRAM / 1MB) } } catch {}
      $gpus += [pscustomobject]@{Name=[string]$v.Name; Load=[double]::NaN; MemUsedMB=[double]::NaN; MemTotalMB=$memTotal; Temp=[double]::NaN}
    }
  } catch {}
}

# WDDM GPU Engine counters: one instance per (process, engine). Like Task
# Manager, sum the instances of the same engine across processes, then use the
# busiest engine. Taking the max of a single process instance underestimates
# the load whenever several processes share the 3D engine.
${PS_WDDM_GPU_LOAD_FN}

# Direct GPU Engine performance counter (vendor-neutral WDDM).
try {
  if($gpus.Count -gt 0 -and [double]::IsNaN([double]$gpus[0].Load)){
    $samples = @(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop |
      Select-Object -ExpandProperty CounterSamples)
    $items = @($samples | ForEach-Object { [pscustomobject]@{Name=[string]$_.InstanceName; Value=[double]$_.CookedValue} })
    $chosen = Get-WddmGpuLoad $items
    if($null -ne $chosen){ $gpus[0].Load = [math]::Round([double]$chosen,1) }
  }
} catch {}

$cpuLoad=$null  # CPU % is computed from os.cpus() in the main process

$cpuTemp=$null; $gpuTemp=$null
# Prefer LibreHardwareMonitor/OpenHardwareMonitor because ACPI thermal zones are often motherboard/firmware zones, not CPU package temperature.
foreach($ns in @('root/LibreHardwareMonitor','root/OpenHardwareMonitor')){
  try {
    $sensors=@(Get-CimInstance -Namespace $ns -ClassName Sensor)
    foreach($s in $sensors){
      if([string]$s.SensorType -ne 'Temperature' -or $null -eq $s.Value){ continue }
      $name=[string]$s.Name; $hw=[string]$s.Hardware; $parent=[string]$s.Parent; $identifier=[string]$s.Identifier
      $value=[double]$s.Value
      if($value -le 0 -or $value -gt 150){ continue }
      $cpuMatch = ($hw -match '(?i)CPU|Processor|AMD Ryzen|Intel' -or $parent -match '(?i)CPU|Processor' -or $identifier -match '(?i)cpu|processor' -or $name -match '(?i)Package|Tctl|Tdie|CPU Core|CPU Package')
      $gpuMatch = ($hw -match '(?i)GPU|NVIDIA|AMD Radeon|Radeon|GeForce|Intel.*Graphics' -or $parent -match '(?i)GPU|NVIDIA|AMD|Radeon|GeForce' -or $identifier -match '(?i)gpu|nvidia|amd|radeon|geforce' -or $name -match '(?i)GPU Core|GPU Hot Spot|GPU Memory')
      if($null -eq $cpuTemp -and $cpuMatch){ $cpuTemp=[math]::Round($value,1) }
      if($null -eq $gpuTemp -and $gpuMatch){ $gpuTemp=[math]::Round($value,1) }
    }
  } catch {}
}

# ACPI is only a last-resort thermal zone reading; never call it CPU temperature if no CPU-like sensor exists.
if($null -eq $cpuTemp){
  try {
    $zones=@(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature)
    $temps=@($zones | Where-Object { $_.CurrentTemperature -gt 0 } | ForEach-Object { ([double]$_.CurrentTemperature / 10) - 273.15 } | Where-Object { $_ -gt 0 -and $_ -lt 120 })
    if($temps.Count -gt 0){ $cpuTemp=[math]::Round(($temps | Measure-Object -Average).Average,1) }
  } catch {}
}

$read=0; $write=0; $busy=$null
try {
  $c=Get-Counter '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec','\\PhysicalDisk(_Total)\\% Disk Time' -ErrorAction Stop
  foreach($x in @($c.CounterSamples)){
    if($x.Path -match 'Disk Read Bytes/sec'){ $read=[math]::Max(0.0,[double]$x.CookedValue) }
    elseif($x.Path -match 'Disk Write Bytes/sec'){ $write=[math]::Max(0.0,[double]$x.CookedValue) }
    elseif($x.Path -match '% Disk Time'){ $busy=[math]::Min(100.0,[math]::Max(0.0,[double]$x.CookedValue)) }
  }
} catch {}

[pscustomobject]@{Gpu=$gpus; CpuLoad=$cpuLoad; CpuTemp=$cpuTemp; GpuTemp=$gpuTemp; Read=$read; Write=$write; Busy=$busy} | ConvertTo-Json -Compress
`

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
        { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 }
      )
      // Windows PowerShell 5.1 serializes [double]::NaN/Infinity as bare tokens,
      // which is invalid JSON and made the whole sensor read fail. Map to null.
      const parsed = JSON.parse(stdout.trim().replace(/(:\s*)-?(?:NaN|Infinity)\b/g, '$1null'))
      const rawGpu = Array.isArray(parsed.Gpu) ? parsed.Gpu : parsed.Gpu ? [parsed.Gpu] : []
      const finite = (v: unknown) =>
        v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null
      const temp = (v: unknown) => {
        const n = finite(v)
        return n != null && n > 0 && n < 150 ? n : null
      }
      this.windowsHardwareCache = {
        at: now,
        gpu: rawGpu.map((g: any) => ({
          name: String(g.Name || 'GPU'),
          loadPercent: finite(g.Load),
          temperature: temp(g.Temp),
          memoryUsedBytes: finite(g.MemUsedMB) != null ? finite(g.MemUsedMB)! * 1024 * 1024 : null,
          memoryTotalBytes:
            finite(g.MemTotalMB) != null ? finite(g.MemTotalMB)! * 1024 * 1024 : null
        })),
        cpuLoadPercent: finite(parsed.CpuLoad),
        cpuTemperature: temp(parsed.CpuTemp),
        gpuTemperature: temp(parsed.GpuTemp),
        diskReadBytesPerSec: Math.max(0, finite(parsed.Read) ?? 0),
        diskWriteBytesPerSec: Math.max(0, finite(parsed.Write) ?? 0),
        diskBusyPercent: finite(parsed.Busy)
      }
    } catch (err) {
      console.warn(
        '[perf-monitor] Windows hardware read failed:',
        err instanceof Error ? err.message : err
      )
      this.windowsHardwareCache = { ...this.windowsHardwareCache, at: now }
    }
    // Ignore bridge data once the collector stopped reporting, otherwise a frozen
    // temperature would be shown as if it were live.
    if (this.latestHardwareBridgeData && Date.now() - this.bridgeLastDataAt <= 5000) {
      this.windowsHardwareCache = this.mergeLibreHardwareMonitor(
        this.windowsHardwareCache,
        this.latestHardwareBridgeData
      )
    }
    return this.windowsHardwareCache
  }

  // Capacity/usage of every mounted volume. Cached with its own clock; the first
  // call waits for real data, later calls return the cache and refresh in background.
  private refreshDiskVolumes(): Promise<void> {
    if (this.diskVolumesFetch) return this.diskVolumesFetch
    this.diskVolumesFetch = (async () => {
      let volumes: VolumeInfo[] = []
      try {
        const fs = await si.fsSize()
        volumes = fs
          .filter((d) => d.size > 0)
          .map((d) => ({
            mount: d.mount,
            sizeBytes: d.size,
            usedBytes: d.used,
            availableBytes: d.available,
            percent: d.use
          }))
      } catch {
        // fall through to the native fallback
      }
      // systeminformation can return nothing on recent Windows builds (no WMIC,
      // PowerShell hiccups). Ask Windows directly before giving up.
      if (volumes.length === 0 && process.platform === 'win32') {
        try {
          const { stdout } = await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              psUtf8(
                "Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress"
              )
            ],
            { timeout: 8000, windowsHide: true, maxBuffer: 256 * 1024 }
          )
          volumes = parseLogicalDisks(stdout)
        } catch {
          // keep whatever we had
        }
      }
      if (volumes.length > 0) {
        this.diskVolumes = volumes
        this.diskVolumesAt = Date.now()
      } else {
        // Nothing usable: keep the previous list (if any) and retry soon.
        this.diskVolumesAt = Date.now() - (this.DISK_VOLUMES_POLL_MS - this.DISK_VOLUMES_RETRY_MS)
      }
    })().finally(() => {
      this.diskVolumesFetch = null
    })
    return this.diskVolumesFetch
  }

  private async getDiskVolumes(): Promise<VolumeInfo[]> {
    const stale = Date.now() - this.diskVolumesAt >= this.DISK_VOLUMES_POLL_MS
    if (stale) {
      const refresh = this.refreshDiskVolumes()
      // Never block the overlay on a refresh when we already have data.
      if (this.diskVolumes.length === 0) {
        await Promise.race([refresh, new Promise<void>((resolve) => setTimeout(resolve, 9000))])
      }
    }
    return this.diskVolumes
  }

  private composeOverlayStats(snapshot: PerfSnapshot, volumes: VolumeInfo[]): PerfOverlayStats {
    return {
      timestamp: snapshot.timestamp,
      cpu: snapshot.cpu.overall,
      cpuTemperature: snapshot.temperature.cpu,
      memory: snapshot.memory,
      network: snapshot.network,
      // Activity is applied here (not cached) so it is always the live value.
      disks: volumes.map((v) => ({ ...v, busyPercent: snapshot.disk.busyPercent })),
      diskIo: {
        readBytesPerSec: snapshot.disk.readBytesPerSec,
        writeBytesPerSec: snapshot.disk.writeBytesPerSec,
        busyPercent: snapshot.disk.busyPercent
      },
      gpu: snapshot.gpu,
      sensorHint:
        snapshot.sensorHint ??
        this.getSensorHint(snapshot.temperature.cpu, snapshot.temperature.gpu)
    }
  }

  async getOverlayStats(): Promise<PerfOverlayStats> {
    const now = Date.now()
    const volumes = await this.getDiskVolumes()
    const latest = this.latestSnapshot

    // The overlay must not take a second CPU/GPU/memory sample. Reuse the exact
    // snapshot already sent to the Performance page so both surfaces always
    // display the same authoritative numbers.
    if (latest && now - latest.timestamp <= 3000) {
      return this.composeOverlayStats(latest, volumes)
    }

    // Bootstrap from the same monitoring stream before ever taking an
    // independent sample. This keeps the overlay and Performance page on one
    // authoritative snapshot.
    if (!this.latestSnapshot) {
      const sender = this.sender
      if (sender && !sender.isDestroyed()) {
        await this.collectSnapshot()
        // A tick may already be in flight (collectSnapshot returns immediately
        // then): wait for its snapshot instead of taking a second, different sample.
        for (let i = 0; i < 40 && !this.latestSnapshot; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    }
    const current = this.latestSnapshot
    if (current) return this.composeOverlayStats(current, volumes)

    // Last-resort bootstrap only when no monitoring sender exists yet.
    const memTotal = os.totalmem()
    const memUsed = memTotal - os.freemem()
    // Quick-stat/overlay bootstrap must not start a hardware collector when
    // the Performance page is not actively monitoring.
    const hardware = this.windowsHardwareCache
    // systeminformation.graphics() launches eight PowerShell queries on
    // Windows. The bundled hardware bridge already provides the GPU data.
    const gpu = hardware.gpu
    const usedBytes = memUsed
    const busyPercent = hardware.diskBusyPercent
    const gpuTemperature = hardware.gpuTemperature ?? gpu[0]?.temperature ?? null
    return {
      timestamp: now,
      cpu: this.resolveCpuOverall(this.sampleCpuUsage()),
      cpuTemperature: hardware.cpuTemperature,
      memory: {
        usedBytes,
        totalBytes: memTotal,
        percent: memTotal > 0 ? (usedBytes / memTotal) * 100 : 0
      },
      network: this.cachedNetworkStats,
      disks: volumes.map((v) => ({ ...v, busyPercent })),
      diskIo: {
        readBytesPerSec: hardware.diskReadBytesPerSec,
        writeBytesPerSec: hardware.diskWriteBytesPerSec,
        busyPercent
      },
      gpu,
      sensorHint: this.getSensorHint(hardware.cpuTemperature, gpuTemperature)
    }
  }

  async getSystemInfo(): Promise<PerfSystemInfo> {
    if (this.cachedSystemInfo) return this.cachedSystemInfo

    const [cpu, os, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()])

    this.cachedSystemInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      totalMemBytes: mem.total,
      osVersion: `${os.distro} ${os.release}`,
      hostname: os.hostname
    }
    return this.cachedSystemInfo
  }

  async startMonitoring(
    sender: Electron.WebContents,
    getStartupItems?: () => Promise<StartupItem[]>
  ): Promise<void> {
    // If already running, just update the sender
    if (this.fastTimer) {
      this.sender = sender
      return
    }

    this.sender = sender

    // Build startup exe map for correlation
    if (getStartupItems) {
      try {
        const items = await getStartupItems()
        this.startupExeMap.clear()
        for (const item of items) {
          // Extract exe name from command string
          const match = item.command.match(/([^/\\]+\.exe)/i)
          if (match) {
            this.startupExeMap.set(match[1].toLowerCase(), item.displayName || item.name)
          }
        }
      } catch {
        // Startup correlation is optional
      }
    }

    // Systeminformation and Windows hardware fallbacks are comparatively
    // expensive. Keep the UI responsive without polling the full snapshot
    // every second; the dedicated CPU counter sampler still runs at 1s.
    this.fastTimer = setInterval(() => this.collectSnapshot(), 2000)
    // Collect immediately
    this.collectSnapshot()

    // A full process snapshot opens every process and reads its metadata.
    // Five seconds is responsive enough for the table while limiting repeated
    // enumeration and icon extraction on machines with many processes.
    this.processTimer = setInterval(() => this.collectProcesses(), 5000)
    this.collectProcesses()
  }

  stopMonitoring(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = null
    }
    if (this.processTimer) {
      clearInterval(this.processTimer)
      this.processTimer = null
    }
    this.stopLiveSampler()
    this.stopHardwareBridge()
    this.processIconCache.clear()
    this.processIconSentAt.clear()
    this.startupExeMap.clear()
    this.sender = null
  }

  async getProcessName(pid: number): Promise<string | null> {
    try {
      const data = await si.processes()
      const proc = data.list.find((p) => p.pid === pid)
      return proc?.name ?? null
    } catch {
      return null
    }
  }

  async killProcess(pid: number): Promise<PerfKillResult> {
    try {
      process.kill(pid)
      return { success: true }
    } catch {
      // Fallback to platform-specific kill command
      try {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/F', '/PID', String(pid)])
        } else {
          await execFileAsync('kill', ['-9', String(pid)])
        }
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const requiresAdmin =
          message.includes('Access') ||
          message.includes('denied') ||
          message.includes('Operation not permitted')
        return {
          success: false,
          error: requiresAdmin
            ? 'Access denied. Run Atlas as Administrator to end this process.'
            : `Failed to end process: ${message}`,
          requiresAdmin
        }
      }
    }
  }

  async getDiskHealth(): Promise<DiskSmartInfo[]> {
    if (this.diskHealthCache && Date.now() - this.diskHealthCache.at < 300000) {
      return this.diskHealthCache.value
    }
    if (this.diskHealthFetch) return this.diskHealthFetch
    const fetch = this.readDiskHealth()
      .then((value) => {
        this.diskHealthCache = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        if (this.diskHealthFetch === fetch) this.diskHealthFetch = null
      })
    this.diskHealthFetch = fetch
    return fetch
  }

  private async readDiskHealth(): Promise<DiskSmartInfo[]> {
    try {
      const disks = await si.diskLayout()
      const reliabilityMap = await this.getStorageReliability()
      const nativeMap = await readNativeSmart()
      const bridgeStorage =
        this.latestHardwareBridgeData && Date.now() - this.bridgeLastDataAt <= 5000
          ? (this.latestHardwareBridgeData.storage ?? [])
          : []

      const result: DiskSmartInfo[] = []
      for (const d of disks) {
        const smartStatus =
          d.smartStatus === 'Ok'
            ? 'Healthy'
            : d.smartStatus === 'Caution'
              ? 'Caution'
              : d.smartStatus === 'Bad'
                ? 'Bad'
                : 'Unknown'

        let diskType: DiskSmartInfo['type'] = 'Unknown'
        if (d.interfaceType === 'NVMe') diskType = 'NVMe'
        else if (d.type === 'SSD') diskType = 'SSD'
        else if (d.type === 'HD') diskType = 'HDD'

        const deviceIndex = d.device.replace(/\D/g, '')
        const rel = reliabilityMap.get(deviceIndex)
        const sensor = this.matchBridgeStorage(bridgeStorage, d.name)
        const smart = await this.readSmartctl(d.device)
        const native = nativeMap.get(deviceIndex)
        const isFlash = diskType === 'SSD' || diskType === 'NVMe'

        // Temperatura: sensor ao vivo > smartctl > contador do Windows (que fica em cache).
        const temperature =
          this.validTemp(sensor?.temperature) ??
          this.validTemp(smart?.temperature) ??
          this.validTemp(native?.temperature) ??
          this.validTemp(rel?.temperature) ??
          this.validTemp(d.temperature)

        // Vida útil: só valores reais. HDD não tem desgaste -> null (nunca "100%").
        let remainingLife: number | null = null
        let lifeSource: DiskSmartInfo['lifeSource'] = null
        if (isFlash) {
          const fromSensor =
            this.validPercent(sensor?.remainingLifePercent) ??
            (this.validPercent(sensor?.percentUsed) != null
              ? 100 - (sensor!.percentUsed as number)
              : null)
          if (fromSensor != null) {
            remainingLife = Math.round(fromSensor)
            lifeSource = 'sensor'
          } else if (smart?.remainingLife != null) {
            remainingLife = smart.remainingLife
            lifeSource = 'smartctl'
          } else if (native?.percentUsed != null && native.percentUsed <= 100) {
            remainingLife = 100 - native.percentUsed
            lifeSource = 'native'
          } else if (native?.lifeLeft != null) {
            remainingLife = native.lifeLeft
            lifeSource = 'native'
          } else if (
            rel?.wear != null &&
            rel.wear >= 0 &&
            rel.wear <= 100 &&
            // Wear 0 sem nenhum outro contador costuma ser o Windows sem suporte real do disco.
            !(rel.wear === 0 && rel.powerOnHours == null)
          ) {
            remainingLife = 100 - rel.wear
            lifeSource = 'windows'
          }
        }

        let powerOnHours: number | null = null
        let hoursSource: DiskSmartInfo['hoursSource'] = null
        if (smart?.powerOnHours != null) {
          powerOnHours = smart.powerOnHours
          hoursSource = 'smartctl'
        } else if (native?.powerOnHours != null) {
          powerOnHours = native.powerOnHours
          hoursSource = 'native'
        } else if (rel?.powerOnHours != null && rel.powerOnHours > 0) {
          powerOnHours = rel.powerOnHours
          hoursSource = 'windows'
        }

        result.push({
          device: d.device,
          model: d.name,
          type: diskType,
          sizeBytes: d.size,
          temperature,
          healthStatus: smartStatus as DiskSmartInfo['healthStatus'],
          powerOnHours,
          remainingLife,
          readErrors: rel?.readErrors ?? null,
          writeErrors: rel?.writeErrors ?? null,
          reallocatedSectors: smart?.reallocatedSectors ?? native?.reallocatedSectors ?? null,
          smartAttributes: [],
          lifeSource,
          hoursSource
        })
      }
      return result
    } catch {
      return []
    }
  }

  private validTemp(v: number | null | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 120 ? Math.round(v) : null
  }

  private validPercent(v: number | null | undefined): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null
  }

  private normalizeModel(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  private matchBridgeStorage<T extends { name: string }>(list: T[], model: string): T | undefined {
    const target = this.normalizeModel(model)
    if (!target) return undefined
    return list.find((e) => {
      const n = this.normalizeModel(e.name)
      return n === target || n.includes(target) || target.includes(n)
    })
  }

  private smartctlPath: string | null | undefined

  private async findSmartctl(): Promise<string | null> {
    if (this.smartctlPath !== undefined) return this.smartctlPath
    const candidates = [
      join(
        process.env['ProgramFiles'] ?? 'C:\\Program Files',
        'smartmontools',
        'bin',
        'smartctl.exe'
      ),
      join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'smartmontools',
        'bin',
        'smartctl.exe'
      )
    ]
    let found = candidates.find((c) => existsSync(c)) ?? null
    if (!found) {
      try {
        const { stdout } = await execFileAsync('where.exe', ['smartctl'], {
          timeout: 3000,
          windowsHide: true
        })
        found =
          stdout
            .split(/\r?\n/)
            .find((l) => l.trim().length > 0)
            ?.trim() ?? null
      } catch {
        found = null
      }
    }
    this.smartctlPath = found
    return found
  }

  /** Lê o SMART real via smartctl (se instalado). Retorna null quando indisponível. */
  private async readSmartctl(device: string): Promise<{
    temperature: number | null
    powerOnHours: number | null
    remainingLife: number | null
    reallocatedSectors: number | null
  } | null> {
    if (process.platform !== 'win32') return null
    const exe = await this.findSmartctl()
    if (!exe) return null
    try {
      const { stdout } = await execFileAsync(exe, ['-a', '-j', device], {
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      }).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' })) // smartctl usa exit code != 0 para avisos
      if (!stdout) return null
      const j = JSON.parse(stdout)
      const nvme = j.nvme_smart_health_information_log
      const table: Array<{ id: number; value: number; raw: { value: number } }> =
        j.ata_smart_attributes?.table ?? []
      const attr = (id: number) => table.find((a) => a.id === id)

      let remainingLife: number | null = null
      if (nvme && typeof nvme.percentage_used === 'number') {
        remainingLife = Math.max(0, Math.min(100, 100 - nvme.percentage_used))
      } else {
        // 231 SSD Life Left, 233 Media Wearout Indicator, 177 Wear Leveling Count (valor normalizado = % restante)
        const a = attr(231) ?? attr(233) ?? attr(177) ?? attr(202)
        if (a && a.value > 0 && a.value <= 100) remainingLife = a.value
      }

      return {
        temperature: this.validTemp(j.temperature?.current),
        powerOnHours:
          typeof j.power_on_time?.hours === 'number'
            ? j.power_on_time.hours
            : (attr(9)?.raw.value ?? null),
        remainingLife,
        reallocatedSectors: attr(5)?.raw.value ?? null
      }
    } catch {
      return null
    }
  }

  async getSensorDriverStatus(): Promise<SensorDriverStatus> {
    if (process.platform !== 'win32') {
      return {
        platform: process.platform,
        pawnIoInstalled: null,
        wingetAvailable: false,
        elevated: null
      }
    }
    let pawnIoInstalled: boolean | null = null
    try {
      await execFileAsync('sc.exe', ['query', 'PawnIO'], { timeout: 4000, windowsHide: true })
      pawnIoInstalled = true
    } catch (err) {
      const code = (err as { code?: number }).code
      // 1060 = serviço inexistente. Outros erros -> não dá para afirmar.
      pawnIoInstalled = code === 1060 ? false : null
    }
    if (pawnIoInstalled === false) {
      const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
      if (existsSync(join(pf, 'PawnIO'))) pawnIoInstalled = true
    }
    let wingetAvailable = false
    try {
      await execFileAsync('winget', ['--version'], { timeout: 5000, windowsHide: true })
      wingetAvailable = true
    } catch {
      wingetAvailable = false
    }
    return { platform: 'win32', pawnIoInstalled, wingetAvailable, elevated: this.bridgeElevated }
  }

  async installPawnIo(): Promise<PawnIoInstallResult> {
    if (process.platform !== 'win32')
      return { success: false, error: 'Disponível apenas no Windows.' }
    try {
      await execFileAsync(
        'winget',
        [
          'install',
          '--id',
          'namazso.PawnIO',
          '-e',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity'
        ],
        { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 }
      )
      // O coletor precisa reiniciar para carregar o driver.
      try {
        this.hardwareBridge?.kill()
      } catch {
        /* ignore */
      }
      this.bridgeRespawnAt = 0
      return { success: true, requiresRestart: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 0x8A150061 = já instalado / nenhuma atualização aplicável
      if (/already installed|0x8a15002b|0x8a150061/i.test(message)) return { success: true }
      return { success: false, error: message.split(/\r?\n/).slice(-3).join(' ').slice(0, 300) }
    }
  }

  private async getStorageReliability(): Promise<
    Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >
  > {
    const map = new Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >()

    try {
      const script =
        'Get-PhysicalDisk | ForEach-Object { $disk = $_; $rel = $_ | Get-StorageReliabilityCounter; [PSCustomObject]@{ DeviceId = $disk.DeviceId; Temperature = $rel.Temperature; PowerOnHours = $rel.PowerOnHours; ReadErrorsTotal = $rel.ReadErrorsTotal; WriteErrorsTotal = $rel.WriteErrorsTotal; Wear = $rel.Wear } } | ConvertTo-Json -Compress'

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psUtf8(script)],
        {
          timeout: 10000,
          windowsHide: true
        }
      )

      const parsed = JSON.parse(stdout.trim())
      const entries = Array.isArray(parsed) ? parsed : [parsed]

      for (const entry of entries) {
        map.set(String(entry.DeviceId), {
          temperature: entry.Temperature ?? null,
          powerOnHours: entry.PowerOnHours ?? null,
          wear: entry.Wear ?? null,
          readErrors: entry.ReadErrorsTotal ?? null,
          writeErrors: entry.WriteErrorsTotal ?? null
        })
      }
    } catch {
      // Requires admin — return empty map, fall back to basic data
    }

    return map
  }

  private async collectSnapshot(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.snapshotRunning) return
    this.snapshotRunning = true

    try {
      // Poll network helpers sparingly; the dashboard does not need a frequent sample.
      const now = Date.now()
      const needsNetworkPoll = now - this.lastNetworkPoll >= this.NETWORK_POLL_INTERVAL_MS

      // On Windows, si.mem() costs ~290ms per call — use os.totalmem()/os.freemem()
      // instead (identical values, near-zero cost). On Linux/macOS, si.mem() is cheap
      // (reads /proc/meminfo or vm_stat) and os.freemem() excludes buffers/cache,
      // so we must keep si.mem() to avoid overstating memory pressure.
      const isWindows = process.platform === 'win32'

      const [load, disk, net, mem] = await Promise.all([
        si.currentLoad(),
        si.disksIO(),
        needsNetworkPoll ? si.networkStats() : Promise.resolve(null),
        isWindows ? Promise.resolve(null) : si.mem()
      ])
      if (isWindows) this.ensureCpuSampler()
      const hardware = isWindows
        ? await this.getWindowsHardwareFallback()
        : this.windowsHardwareCache
      // Do not call systeminformation.graphics() here: it launches eight
      // PowerShell jobs on every snapshot. The bundled bridge is the GPU source.
      const gpu = hardware.gpu

      if (net) {
        this.cachedNetworkStats = {
          rxBytesPerSec: net.reduce((sum, n) => sum + n.rx_sec, 0),
          txBytesPerSec: net.reduce((sum, n) => sum + n.tx_sec, 0)
        }
        this.lastNetworkPoll = now
      }

      let usedMem: number, totalMem: number, cachedMem: number
      if (isWindows) {
        totalMem = os.totalmem()
        usedMem = totalMem - os.freemem()
        cachedMem = 0
      } else if (process.platform === 'darwin') {
        totalMem = mem!.total
        // mem.active includes file-backed/reclaimable pages and vastly overstates
        // real pressure on macOS.  (total − available) matches Activity Monitor.
        usedMem = totalMem - mem!.available
        cachedMem = mem!.cached
      } else {
        usedMem = mem!.active
        totalMem = mem!.total
        cachedMem = mem!.cached
      }

      const cpuOverall = this.resolveCpuOverall(this.sampleCpuUsage())
      const snapshot: PerfSnapshot = {
        timestamp: Date.now(),
        cpu: {
          overall: cpuOverall,
          perCore: load.cpus.map((c) => c.load)
        },
        memory: {
          usedBytes: usedMem,
          totalBytes: totalMem,
          cachedBytes: cachedMem,
          percent: (usedMem / totalMem) * 100
        },
        disk: {
          readBytesPerSec:
            hardware.diskReadBytesPerSec > 0 ? hardware.diskReadBytesPerSec : (disk?.rIO_sec ?? 0),
          writeBytesPerSec:
            hardware.diskWriteBytesPerSec > 0
              ? hardware.diskWriteBytesPerSec
              : (disk?.wIO_sec ?? 0),
          busyPercent: hardware.diskBusyPercent
        },
        gpu,
        temperature: {
          cpu: hardware.cpuTemperature,
          gpu: hardware.gpuTemperature ?? gpu[0]?.temperature ?? null
        },
        network: this.cachedNetworkStats,
        uptime: si.time().uptime
      }
      snapshot.sensorHint = this.getSensorHint(snapshot.temperature.cpu, snapshot.temperature.gpu)

      this.latestSnapshot = snapshot
      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_SNAPSHOT, snapshot)
      }
    } catch (err) {
      // A failed tick is skipped, but never silently: log each distinct error once.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== this.lastTickError) {
        this.lastTickError = msg
        console.warn('[perf-monitor] snapshot tick failed:', msg)
      }
    } finally {
      this.snapshotRunning = false
    }
  }

  private async collectProcesses(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.processesRunning) return
    this.processesRunning = true

    try {
      let processEntries: ProcessSnapshotEntry[]
      let totalCount: number
      let totalMem: number
      if (process.platform === 'win32') {
        const nativeRows = await readNativeProcessSnapshot()
        if (nativeRows) {
          processEntries = nativeRows.map((row) => ({
            pid: row.pid,
            parentPid: row.parentPid,
            name: row.name,
            path: row.path,
            cpu: row.cpuPercent,
            memRss: row.memBytes,
            user: row.user,
            started: row.started
          }))
          totalCount = processEntries.length
          totalMem = os.totalmem()
        } else {
          const now = Date.now()
          if (now - this.nativeProcessFallbackAt < 15000) return
          this.nativeProcessFallbackAt = now
          if (!this.nativeProcessFallbackLogged) {
            this.nativeProcessFallbackLogged = true
            console.warn(
              '[perf-monitor] coletor nativo de processos indisponível; usando systeminformation:',
              getNativeProcessMonitorUnavailableReason()
            )
          }
          const [data, mem] = await Promise.all([si.processes(), si.mem()])
          processEntries = data.list.map((item) => ({
            pid: item.pid,
            parentPid: item.parentPid,
            name: item.name,
            path: item.path,
            cpu: item.cpu,
            memRss: item.memRss,
            user: item.user,
            started: item.started
          }))
          totalCount = data.all
          totalMem = mem.total
        }
      } else {
        const [data, mem] = await Promise.all([si.processes(), si.mem()])
        processEntries = data.list.map((item) => ({
          pid: item.pid,
          parentPid: item.parentPid,
          name: item.name,
          path: item.path,
          cpu: item.cpu,
          memRss: item.memRss,
          user: item.user,
          started: item.started
        }))
        totalCount = data.all
        totalMem = mem.total
      }
      const servicePids = await this.getWindowsServicePids()
      const processPids = new Set(processEntries.map((item) => item.pid))
      const processByPid = new Map(processEntries.map((item) => [item.pid, item]))
      const parentPidByPid = new Map<number, number>()
      for (const item of processEntries) {
        const parentPid = item.parentPid == null ? Number.NaN : Number(item.parentPid)
        if (!Number.isFinite(parentPid) || parentPid === item.pid) continue

        // PIDs are reused. A stale parent PID can point at a newer process
        // (for example, a new explorer.exe) and create a false subtree. Like
        // System Informer, only attach a live parent when its creation time is
        // no later than the child's. Missing timestamps remain usable.
        const parent = processByPid.get(parentPid)
        if (parent?.started && item.started) {
          const parentStarted = Date.parse(parent.started)
          const childStarted = Date.parse(item.started)
          if (
            Number.isFinite(parentStarted) &&
            Number.isFinite(childStarted) &&
            parentStarted > childStarted
          )
            continue
        }
        parentPidByPid.set(item.pid, parentPid)
      }

      // Some Windows builds return parent PIDs as missing or in an unexpected
      // format. Query native process metadata only when the snapshot has no usable links.
      const hasParentLinks = [...parentPidByPid.values()].some((parentPid) =>
        processPids.has(parentPid)
      )
      if (
        process.platform === 'win32' &&
        processEntries.length > 1 &&
        !hasParentLinks &&
        Date.now() - this.parentPidFallbackAt >= 300000
      ) {
        this.parentPidFallbackAt = Date.now()
        try {
          const script = psUtf8(
            `$source = @'
using System;
using System.Runtime.InteropServices;
public static class AtlasProcessParentLookup {
  [StructLayout(LayoutKind.Sequential)]
  private struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, out PROCESS_BASIC_INFORMATION info, uint length, out uint returned);
  public static int? GetParentProcessId(int processId) {
    IntPtr handle = OpenProcess(0x1000, false, processId);
    if (handle == IntPtr.Zero) return null;
    try {
      PROCESS_BASIC_INFORMATION info;
      uint returned;
      int status = NtQueryInformationProcess(handle, 0, out info, (uint)Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returned);
      if (status != 0 || info.InheritedFromUniqueProcessId == IntPtr.Zero) return null;
      return info.InheritedFromUniqueProcessId.ToInt32();
    } finally { CloseHandle(handle); }
  }
}
'@
Add-Type -TypeDefinition $source
$rows = @(Get-Process | ForEach-Object {
  $parentPid = [AtlasProcessParentLookup]::GetParentProcessId([int]$_.Id)
  if ($null -ne $parentPid) { [pscustomobject]@{ pid = [int]$_.Id; parentPid = [int]$parentPid } }
})
ConvertTo-Json -InputObject $rows -Compress`
          )
          const { stdout } = await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { timeout: 10000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
          )
          const parsed: unknown = JSON.parse(stdout.trim())
          const rows = Array.isArray(parsed) ? parsed : [parsed]
          const fallbackMap = new Map<number, number>()
          for (const row of rows as Array<{ pid?: unknown; parentPid?: unknown }>) {
            const pid = Number(row?.pid)
            const parentPid = Number(row?.parentPid)
            if (Number.isFinite(pid) && Number.isFinite(parentPid) && pid !== parentPid) {
              fallbackMap.set(pid, parentPid)
            }
          }
          if (fallbackMap.size > 0) this.parentPidFallbackMap = fallbackMap
        } catch {
          // Keep the available process data if native parent lookup is unavailable.
        }
      }
      if (!hasParentLinks) {
        for (const [pid, parentPid] of this.parentPidFallbackMap) {
          if (!processPids.has(pid) || !processPids.has(parentPid)) continue
          const child = processByPid.get(pid)
          const parent = processByPid.get(parentPid)
          if (parent?.started && child?.started) {
            const parentStarted = Date.parse(parent.started)
            const childStarted = Date.parse(child.started)
            if (
              Number.isFinite(parentStarted) &&
              Number.isFinite(childStarted) &&
              parentStarted > childStarted
            )
              continue
          }
          parentPidByPid.set(pid, parentPid)
        }
      }

      const executablePaths = [
        ...new Set(
          processEntries.map((item) => item.path?.trim()).filter((path): path is string => !!path)
        )
      ]
      // Resolve at most one small batch per poll. The native process snapshot
      // should reach the UI quickly even on machines with many unique icons.
      const missingIconPaths = executablePaths.filter(
        (path) => !this.processIconCache.has(path.toLocaleLowerCase())
      )
      await Promise.all(missingIconPaths.slice(0, 6).map((path) => this.resolveProcessIcon(path)))
      const iconKeysSentThisSnapshot = new Set<string>()
      const now = Date.now()

      // Keep the complete process list so parent rows and their child processes
      // can be represented together in the renderer's process tree.
      const currentUser = os.userInfo().username.toLocaleLowerCase()
      const serviceAccountPattern =
        /^(system|nt authority\\(system|local service|network service)|nt service\\.+|local service|network service|serviço local|serviço de rede|autoridade nt\\sistema)$/i
      const serviceAccountProcesses = new Set([
        'system',
        'secure system',
        'registry',
        'smss',
        'csrss',
        'wininit',
        'winlogon',
        'services',
        'lsass',
        'svchost',
        'fontdrvhost',
        'wmiprvse',
        'spoolsv',
        'audiodg'
      ])
      const packagedProcesses = new Set([
        'shellexperiencehost',
        'xboxpcappft',
        'startmenuexperiencehost'
      ])
      const processes: PerfProcess[] = processEntries.map((p) => {
        const parentPid = parentPidByPid.get(p.pid)
        const parentName = parentPid == null ? undefined : processByPid.get(parentPid)?.name
        const exeName = (p.name || '').toLowerCase()
        const owner = (p.user || '').trim()
        const ownerLower = owner.toLocaleLowerCase()
        const processPath = (p.path || '').toLocaleLowerCase()
        const baseName = exeName.replace(/\.exe$/i, '')
        const isProtected =
          processPath.includes('\\windowsapps\\') ||
          processPath.includes('\\systemapps\\') ||
          packagedProcesses.has(baseName)
        const isServiceAccount =
          serviceAccountPattern.test(owner) || serviceAccountProcesses.has(baseName)
        const isService =
          servicePids.has(p.pid) ||
          ['phoneexperiencehost', 'yourphone', 'librehardwaremonitor'].includes(baseName)
        const rowColor: PerfProcess['rowColor'] = isProtected
          ? 'protected'
          : isServiceAccount
            ? 'service-account'
            : isService
              ? 'service'
              : owner && ownerLower !== currentUser
                ? 'service-account'
                : 'current-user'
        const iconKey = p.path?.trim().toLocaleLowerCase() || undefined
        const cachedIcon = iconKey ? this.processIconCache.get(iconKey) : null
        const lastSentAt = iconKey ? (this.processIconSentAt.get(iconKey) ?? 0) : now
        const shouldSendIcon =
          !!iconKey &&
          !!cachedIcon &&
          !iconKeysSentThisSnapshot.has(iconKey) &&
          now - lastSentAt >= 30000
        if (shouldSendIcon && iconKey) {
          iconKeysSentThisSnapshot.add(iconKey)
          this.processIconSentAt.set(iconKey, now)
        }
        const startupName = this.startupExeMap.get(
          exeName.endsWith('.exe') ? exeName : `${exeName}.exe`
        )

        return {
          pid: p.pid,
          parentPid,
          parentName,
          rowColor,
          executablePath: p.path || undefined,
          iconKey,
          iconDataUrl: shouldSendIcon ? (cachedIcon ?? undefined) : undefined,
          name: p.name,
          cpuPercent: Number.isFinite(p.cpu) ? p.cpu : 0,
          memBytes: p.memRss,
          memPercent: totalMem > 0 ? (p.memRss / totalMem) * 100 : 0,
          user: p.user || '',
          started: p.started || '',
          isStartupItem: !!startupName,
          startupItemName: startupName
        }
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_PROCESS_LIST, result)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.processesRunning = false
    }
  }
}

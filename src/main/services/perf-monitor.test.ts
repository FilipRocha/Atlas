import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const GB = 1024 ** 3
const originalPlatform = process.platform

const si = vi.hoisted(() => ({
  fsSize: vi.fn(),
  currentLoad: vi.fn(),
  disksIO: vi.fn(),
  networkStats: vi.fn(),
  mem: vi.fn(),
  graphics: vi.fn(),
  time: vi.fn(),
  processes: vi.fn(),
  cpu: vi.fn(),
  osInfo: vi.fn(),
  diskLayout: vi.fn()
}))

vi.mock('systeminformation', () => si)

import { PerfMonitorService, parseLogicalDisks } from './perf-monitor'

const volumes = [
  { mount: 'C:', size: 500 * GB, used: 200 * GB, available: 300 * GB, use: 40 },
  { mount: 'D:', size: 1000 * GB, used: 100 * GB, available: 900 * GB, use: 10 }
]

function fakeSender() {
  return { isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents
}

beforeEach(() => {
  // These tests exercise the generic overlay path. Keep them independent of
  // a developer's Windows shell, where the service has a native PowerShell
  // fallback and starts the hardware bridge.
  Object.defineProperty(process, 'platform', { value: 'linux' })
  si.fsSize.mockResolvedValue(volumes)
  si.currentLoad.mockResolvedValue({ currentLoad: 12, cpus: [{ load: 12 }] })
  si.disksIO.mockResolvedValue({ rIO_sec: 1000, wIO_sec: 2000 })
  si.networkStats.mockResolvedValue([{ rx_sec: 10, tx_sec: 20 }])
  si.mem.mockResolvedValue({ total: 16 * GB, available: 8 * GB, active: 8 * GB, cached: 0 })
  si.graphics.mockResolvedValue({ controllers: [] })
  si.time.mockReturnValue({ uptime: 100 })
  si.processes.mockResolvedValue({ list: [], all: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('overlay disks', () => {
  it('returns the mounted volumes on the very first call (no monitoring running)', async () => {
    const service = new PerfMonitorService()
    const stats = await service.getOverlayStats()

    expect(stats.disks.map((d) => d.mount)).toEqual(['C:', 'D:'])
    expect(stats.disks[0]).toMatchObject({ sizeBytes: 500 * GB, usedBytes: 200 * GB, percent: 40 })
    expect(stats.diskIo).toBeDefined()
  })

  it('still has disks while the snapshot loop keeps running (the original bug)', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const sender = fakeSender()
    await service.startMonitoring(sender)
    await vi.advanceTimersByTimeAsync(1500)

    // Poll like the overlay does: once per second, for 25 s.
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      const stats = await service.getOverlayStats()
      expect(stats.disks.length, `tick ${i}`).toBe(2)
    }
    service.stopMonitoring()
  })

  it('refreshes volume usage after the cache expires', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    await service.startMonitoring(fakeSender())
    await vi.advanceTimersByTimeAsync(1500)
    expect((await service.getOverlayStats()).disks[0].usedBytes).toBe(200 * GB)

    si.fsSize.mockResolvedValue([
      { ...volumes[0], used: 250 * GB, available: 250 * GB, use: 50 },
      volumes[1]
    ])
    await vi.advanceTimersByTimeAsync(120_001)
    await service.getOverlayStats() // triggers the background refresh
    await vi.advanceTimersByTimeAsync(100)
    expect((await service.getOverlayStats()).disks[0].usedBytes).toBe(250 * GB)
    service.stopMonitoring()
  })

  it('carries the live disk activity and throughput from the shared snapshot', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    await service.startMonitoring(fakeSender())
    await vi.advanceTimersByTimeAsync(1500)
    const stats = await service.getOverlayStats()

    expect(stats.diskIo).toMatchObject({ readBytesPerSec: 1000, writeBytesPerSec: 2000 })
    service.stopMonitoring()
  })

  it('does not throw and keeps diskIo when volumes cannot be listed', async () => {
    si.fsSize.mockRejectedValue(new Error('boom'))
    const service = new PerfMonitorService()
    const stats = await service.getOverlayStats()

    expect(stats.disks).toEqual([])
    expect(stats.diskIo).toBeDefined()
  })
})

describe('parseLogicalDisks (Windows fallback)', () => {
  it('parses an array of drives', () => {
    const out = JSON.stringify([
      { DeviceID: 'C:', Size: 1000, FreeSpace: 250 },
      { DeviceID: 'D:', Size: 2000, FreeSpace: 2000 }
    ])
    expect(parseLogicalDisks(out)).toEqual([
      { mount: 'C:', sizeBytes: 1000, usedBytes: 750, availableBytes: 250, percent: 75 },
      { mount: 'D:', sizeBytes: 2000, usedBytes: 0, availableBytes: 2000, percent: 0 }
    ])
  })

  it('parses the single-object form PowerShell emits for one drive', () => {
    expect(parseLogicalDisks('{"DeviceID":"C:","Size":100,"FreeSpace":40}')).toHaveLength(1)
  })

  it('ignores empty output, invalid JSON and drives without size', () => {
    expect(parseLogicalDisks('')).toEqual([])
    expect(parseLogicalDisks('not json')).toEqual([])
    expect(parseLogicalDisks('[{"DeviceID":"E:","Size":null,"FreeSpace":null}]')).toEqual([])
  })
})

describe('sensor hint', () => {
  const realPlatform = process.platform
  beforeEach(() => Object.defineProperty(process, 'platform', { value: 'win32' }))
  afterEach(() => Object.defineProperty(process, 'platform', { value: realPlatform }))

  const withState = (state: string, extra: Record<string, unknown> = {}) => {
    const service = new PerfMonitorService() as unknown as Record<string, unknown> &
      PerfMonitorService
    Object.assign(service, { bridgeState: state, ...extra })
    return service
  }

  it('says nothing when both temperatures exist', () => {
    expect(withState('missing').getSensorHint(50, 60)).toBeNull()
  })

  it('explains a missing collector', () => {
    expect(withState('missing').getSensorHint(null, null)).toMatch(/ausente/)
  })

  it('reports the last error when the collector stopped', () => {
    const hint = withState('exited', { bridgeStderr: 'linha 1\nDriver bloqueado' }).getSensorHint(
      null,
      60
    )
    expect(hint).toMatch(/parou: Driver bloqueado/)
  })

  it('asks for administrator rights when the collector runs unelevated', () => {
    expect(withState('running', { bridgeElevated: false }).getSensorHint(null, 60)).toMatch(
      /administrador/
    )
  })

  it('blames the missing CPU sensor when elevated and still no temperature', () => {
    expect(withState('running', { bridgeElevated: true }).getSensorHint(null, 60)).toMatch(
      /CPU não expôs/
    )
  })

  it('is silent on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(withState('missing').getSensorHint(null, null)).toBeNull()
  })
})

describe('collector discovery', () => {
  it('looks in the project resources folder as well as the packaged one', () => {
    const service = new PerfMonitorService() as unknown as {
      getHardwareBridgeCandidates(): string[]
    }
    const candidates = service.getHardwareBridgeCandidates().map((c) => c.replace(/\\/g, '/'))
    expect(
      candidates.some((c) => c.endsWith('resources/hardware-bridge/LibreHardwareMonitorBridge.exe'))
    ).toBe(true)
    expect(new Set(candidates).size).toBe(candidates.length)
  })
})

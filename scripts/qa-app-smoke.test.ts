import { describe, expect, it } from 'vitest'
import qaAppSmoke from './qa-app-smoke.cjs'

describe('Atlas app smoke watchdog', () => {
  it('covers each declared primary app route exactly once', () => {
    expect(qaAppSmoke.APP_ROUTES).toHaveLength(30)
    expect(new Set(qaAppSmoke.APP_ROUTES).size).toBe(qaAppSmoke.APP_ROUTES.length)
    expect(qaAppSmoke.APP_ROUTES).toContain('/settings')
  })

  it('limits functional IPC checks to known read-only methods', () => {
    expect(qaAppSmoke.READ_ONLY_IPC_CHECKS.map((check) => check.id)).toEqual([
      'settingsGet',
      'startupList',
      'diskTrimList',
      'recoveryList',
      'cleanupReceipts',
      'storageHistoryList'
    ])
    expect(qaAppSmoke.validateReadOnlyResult('array', [])).toBe(true)
    expect(qaAppSmoke.validateReadOnlyResult('array', {})).toBe(false)
    expect(
      qaAppSmoke.validateReadOnlyResult('recovery', {
        entries: [],
        unreadable: [],
        backups: [],
        total: 0
      })
    ).toBe(true)
    expect(
      qaAppSmoke.validateReadOnlyResult('storageHistory', {
        scopes: [],
        snapshots: [],
        total: 0,
        projection: {}
      })
    ).toBe(true)
    expect(
      qaAppSmoke.validateReadOnlyResult('driverScan', {
        packages: [],
        totalStaleSize: 0,
        totalStaleCount: 0,
        totalCurrentCount: 0
      })
    ).toBe(true)
    expect(
      qaAppSmoke.validateReadOnlyResult('driverUpdateScan', {
        updates: [],
        ignoredUpdates: [],
        totalAvailable: 0,
        scanDuration: 0,
        updatesDisabled: false
      })
    ).toBe(true)
    expect(
      qaAppSmoke.validateReadOnlyResult('storageHistory', {
        scopes: [],
        snapshots: [],
        total: 0,
        projection: null
      })
    ).toBe(true)
  })

  it('uses bounded startup and observation defaults', () => {
    const options = qaAppSmoke.parseArgs([])
    expect(options.startupTimeoutMs).toBe(120_000)
    expect(options.observeMs).toBe(5_000)
    expect(qaAppSmoke.DRIVER_MANAGER_SCAN_TIMEOUT_MS).toBe(150_000)
  })

  it('accepts a project directory and bounded timing overrides', () => {
    const options = qaAppSmoke.parseArgs([
      '--project-dir',
      'project',
      '--startup-timeout-ms',
      '30000',
      '--observe-ms',
      '1000'
    ])
    expect(options.projectDir).toMatch(/project$/)
    expect(options.startupTimeoutMs).toBe(30_000)
    expect(options.observeMs).toBe(1000)
  })

  it('rejects unbounded or malformed timing values', () => {
    expect(() => qaAppSmoke.parseArgs(['--observe-ms', '0'])).toThrow()
    expect(() => qaAppSmoke.parseArgs(['--startup-timeout-ms', 'forever'])).toThrow()
  })

  it('validates only the shape of the read-only platform IPC response', () => {
    expect(
      qaAppSmoke.validatePlatformInfo({
        isPortable: false,
        platform: 'win32',
        features: {
          registry: true,
          debloater: true,
          drivers: true,
          restorePoint: true,
          bootTrace: true,
          gameMode: true,
          firewallAudit: true,
          contextMenu: true
        }
      })
    ).toEqual({ platform: 'win32', featureCount: 8 })
    expect(() => qaAppSmoke.validatePlatformInfo({ platform: 'win32' })).toThrow()
  })

  it('summarizes build, application, and renderer readiness', () => {
    const report = qaAppSmoke.markdownReport({
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:05.000Z',
      build: { status: 'PASS', details: 'Build completed.' },
      application: {
        status: 'PASS',
        details: 'Renderer remained responsive.',
        rendererReady: true,
        checks: [
          {
            id: 'platform-info',
            status: 'PASS',
            details: 'Valid platform capabilities.'
          },
          {
            id: 'onboarding-flow',
            status: 'PASS',
            details: 'All onboarding screens completed and the dashboard opened.'
          },
          {
            id: 'route:/settings',
            status: 'PASS',
            details: 'Route /settings opened in the app shell.'
          },
          {
            id: 'ipc:settingsGet',
            status: 'PASS',
            details: 'settingsGet returned the expected object response.'
          },
          {
            id: 'driver-manager-ui-scan',
            status: 'PASS',
            details: 'The Driver Manager scan button completed.'
          }
        ],
        logFile: 'qa-reports/atlas.log'
      }
    })
    expect(report).toContain('Build: PASS')
    expect(report).toContain('Application: PASS')
    expect(report).toContain('Renderer ready: yes')
    expect(report).toContain('Read-only IPC platform-info: PASS')
    expect(report).toContain('onboarding-flow: PASS')
    expect(report).toContain('route:/settings: PASS')
    expect(report).toContain('ipc:settingsGet: PASS')
    expect(report).toContain('driver-manager-ui-scan: PASS')
  })
})

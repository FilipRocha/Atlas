import { BrowserWindow, ipcMain } from 'electron'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { IPC } from '../../shared/channels'
import type {
  SystemTweakSetting,
  SystemTweaksState,
  SystemTweaksApplyResult
} from '../../shared/types'
import type { WindowGetter } from './index'
import { validateStringArray } from '../services/ipc-validation'
import { execNativeUtf8 } from '../services/exec-utf8'
import { recordRecoveryChange } from '../services/recovery-store'
import { readRecoveryTarget } from '../services/recovery'

const execFileAsync = promisify(execFile)

// Hard timeout wrapper — guarantees a check never hangs forever, matching
// the safety net used by Privacy Shield's scan loop.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ])
}

// ─── Setting definition ───────────────────────────────────────

interface TweakDef {
  id: string
  category: SystemTweakSetting['category']
  label: string
  description: string
  requiresAdmin: boolean
  check: () => Promise<boolean> // true = tweak is already applied
  apply: () => Promise<void>
  revert?: () => Promise<void> // absent = irreversible (e.g. an uninstall)
  applicable?: () => Promise<boolean> // false if the underlying resource doesn't exist
}

// ─── Registry helpers (same approach as privacy-shield.ipc.ts) ─

async function regQueryDword(key: string, value: string): Promise<number | null> {
  try {
    const { stdout } = await execNativeUtf8('reg', ['query', key, '/v', value], {
      timeout: 5000,
      windowsHide: true
    })
    const match = stdout.match(new RegExp(`${value}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`, 'i'))
    return match ? parseInt(match[1], 16) : null
  } catch {
    return null
  }
}

async function regSetDword(
  key: string,
  value: string,
  data: number,
  source: 'registry' = 'registry'
): Promise<void> {
  const target = { kind: 'registry-dword' as const, key, name: value }
  const before = await readRecoveryTarget(target)
  await recordRecoveryChange(source, value, target, before, data, async () => {
    await execNativeUtf8(
      'reg',
      ['add', key, '/v', value, '/t', 'REG_DWORD', '/d', String(data), '/f'],
      { timeout: 5000, windowsHide: true }
    )
  })
}

async function regDeleteValue(key: string, value: string): Promise<void> {
  const target = { kind: 'registry-dword' as const, key, name: value }
  const before = await readRecoveryTarget(target)
  if (before === null) return
  await recordRecoveryChange('registry', value, target, before, null, async () => {
    try {
      await execNativeUtf8('reg', ['delete', key, '/v', value, '/f'], {
        timeout: 5000,
        windowsHide: true
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const stderr = (err as { stderr?: string })?.stderr ?? ''
      if ((msg + stderr).toLowerCase().includes('unable to find')) return
      throw err
    }
  })
}

async function keyExists(key: string): Promise<boolean> {
  try {
    await execNativeUtf8('reg', ['query', key], { timeout: 5000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

function sendProgress(win: BrowserWindow | null, data: object): void {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.TWEAKS_PROGRESS, data)
  } catch {
    // Window may have been closed during scan
  }
}

// GUIDs for the built-in power schemes Windows ships with.
const BALANCED_SCHEME = '381b4222-f694-41f0-9685-ff5bb260df2e'
const ULTIMATE_PERFORMANCE_TEMPLATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61'

async function getActiveSchemeName(): Promise<string> {
  const { stdout } = await execFileAsync('powercfg', ['/getactivescheme'])
  return stdout
}

// ─── All tweaks (Windows only) ─────────────────────────────────

const SETTINGS: TweakDef[] = [
  // ─── PERSONALIZATION ───
  {
    id: 'dark-mode',
    category: 'personalization',
    label: 'Dark Mode',
    description: 'Switch apps and the system UI to the dark color theme',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        'AppsUseLightTheme'
      )
      return val === 0
    },
    apply: async () => {
      await regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        'AppsUseLightTheme',
        0
      )
      await regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        'SystemUsesLightTheme',
        0
      )
    },
    revert: async () => {
      await regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        'AppsUseLightTheme',
        1
      )
      await regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        'SystemUsesLightTheme',
        1
      )
    }
  },
  {
    id: 'taskbar-left-align',
    category: 'personalization',
    label: 'Left-Align Taskbar',
    description: 'Move the Windows 11 taskbar icons back to the left, Windows 10 style',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'TaskbarAl'
      )
      return val === 0
    },
    apply: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'TaskbarAl',
        0
      ),
    revert: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'TaskbarAl',
        1
      )
  },
  {
    id: 'taskbar-search-icon-only',
    category: 'personalization',
    label: 'Compact Search Box',
    description: 'Shrink the taskbar search box down to a small icon',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search',
        'SearchboxTaskbarMode'
      )
      return val === 1
    },
    apply: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search',
        'SearchboxTaskbarMode',
        1
      ),
    revert: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search',
        'SearchboxTaskbarMode',
        2
      )
  },
  {
    id: 'show-hidden-files',
    category: 'personalization',
    label: 'Show Hidden Files',
    description: 'Make File Explorer display hidden files and folders',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'Hidden'
      )
      return val === 1
    },
    apply: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'Hidden',
        1
      ),
    revert: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'Hidden',
        2
      )
  },
  {
    id: 'show-file-extensions',
    category: 'personalization',
    label: 'Show File Extensions',
    description: 'Make File Explorer show file extensions for known file types',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'HideFileExt'
      )
      return val === 0
    },
    apply: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'HideFileExt',
        0
      ),
    revert: () =>
      regSetDword(
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
        'HideFileExt',
        1
      )
  },
  {
    id: 'classic-context-menu',
    category: 'personalization',
    label: 'Classic Right-Click Menu',
    description: 'Restore the full Windows 10-style right-click menu on Windows 11',
    requiresAdmin: false,
    check: () =>
      keyExists(
        'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32'
      ),
    apply: () =>
      execNativeUtf8(
        'reg',
        [
          'add',
          'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32',
          '/f',
          '/ve'
        ],
        { timeout: 5000, windowsHide: true }
      ).then(() => undefined),
    revert: () =>
      execNativeUtf8(
        'reg',
        ['delete', 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}', '/f'],
        { timeout: 5000, windowsHide: true }
      )
        .then(() => undefined)
        .catch(() => undefined)
  },
  {
    id: 'disable-mouse-acceleration',
    category: 'personalization',
    label: 'Disable Mouse Acceleration',
    description: 'Turn off "Enhance pointer precision" for consistent 1:1 mouse movement',
    requiresAdmin: false,
    check: async () => {
      const speed = await regQueryDword('HKCU\\Control Panel\\Mouse', 'MouseSpeed')
      return speed === 0
    },
    apply: async () => {
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseSpeed', 0)
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseThreshold1', 0)
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseThreshold2', 0)
    },
    revert: async () => {
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseSpeed', 1)
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseThreshold1', 6)
      await regSetDword('HKCU\\Control Panel\\Mouse', 'MouseThreshold2', 10)
    }
  },
  {
    id: 'always-show-scrollbars',
    category: 'personalization',
    label: 'Always Show Scrollbars',
    description: 'Keep scrollbars visible at all times instead of auto-hiding them',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\Control Panel\\Accessibility', 'DynamicScrollbars')
      return val === 0
    },
    apply: () => regSetDword('HKCU\\Control Panel\\Accessibility', 'DynamicScrollbars', 0),
    revert: () => regSetDword('HKCU\\Control Panel\\Accessibility', 'DynamicScrollbars', 1)
  },
  {
    id: 'numlock-on-startup',
    category: 'personalization',
    label: 'Enable NumLock at Startup',
    description: 'Force NumLock on every time Windows starts, including the login screen',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword('HKCU\\Control Panel\\Keyboard', 'InitialKeyboardIndicators')
      return val === 2
    },
    apply: async () => {
      await regSetDword('HKCU\\Control Panel\\Keyboard', 'InitialKeyboardIndicators', 2)
      await regSetDword(
        'HKU\\.DEFAULT\\Control Panel\\Keyboard',
        'InitialKeyboardIndicators',
        2147483650
      )
    },
    revert: async () => {
      await regSetDword('HKCU\\Control Panel\\Keyboard', 'InitialKeyboardIndicators', 2147483648)
      await regSetDword(
        'HKU\\.DEFAULT\\Control Panel\\Keyboard',
        'InitialKeyboardIndicators',
        2147483648
      )
    }
  },
  {
    id: 'disable-sticky-keys-hotkey',
    category: 'personalization',
    label: 'Disable Sticky Keys Prompt',
    description: 'Stop the "press Shift 5 times" Sticky Keys popup from appearing',
    requiresAdmin: false,
    check: async () => {
      const val = await regQueryDword('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags')
      return val === 506
    },
    apply: () => regSetDword('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags', 506),
    revert: () => regSetDword('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags', 510)
  },
  {
    id: 'verbose-logon-messages',
    category: 'personalization',
    label: 'Verbose Logon Messages',
    description: 'Show detailed status messages during startup, sign-in and shutdown',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'VerboseStatus'
      )
      return val === 1
    },
    apply: () =>
      regSetDword(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'VerboseStatus',
        1
      ),
    revert: () =>
      regDeleteValue(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'VerboseStatus'
      )
  },
  {
    id: 'enable-long-paths',
    category: 'personalization',
    label: 'Enable Long Path Support',
    description: 'Allow file paths longer than 260 characters (Windows 10 1607+)',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem',
        'LongPathsEnabled'
      )
      return val === 1
    },
    apply: () =>
      regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled', 1),
    revert: () =>
      regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'LongPathsEnabled', 0)
  },

  // ─── POWER ───
  {
    id: 'ultimate-performance-plan',
    category: 'power',
    label: 'Ultimate Performance Power Plan',
    description: 'Unlock and activate the hidden "Ultimate Performance" power plan',
    requiresAdmin: true,
    check: async () => {
      const name = await getActiveSchemeName()
      return /ultimate performance/i.test(name)
    },
    apply: async () => {
      const { stdout } = await execFileAsync('powercfg', [
        '-duplicatescheme',
        ULTIMATE_PERFORMANCE_TEMPLATE
      ])
      const match = stdout.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
      if (!match) throw new Error('Could not read the new power scheme GUID')
      await execFileAsync('powercfg', ['-setactive', match[1]])
    },
    revert: () => execFileAsync('powercfg', ['-setactive', BALANCED_SCHEME]).then(() => undefined)
  },
  {
    id: 'disable-hibernation',
    category: 'power',
    label: 'Disable Hibernation',
    description: 'Turn off hibernation and delete hiberfil.sys to free up disk space',
    requiresAdmin: true,
    check: async () => {
      try {
        const { stdout } = await execFileAsync('powercfg', ['/a'])
        return /hibernation.*has not been enabled|hibernate.*not enabled/i.test(stdout)
      } catch {
        return false
      }
    },
    apply: () => execFileAsync('powercfg', ['/hibernate', 'off']).then(() => undefined),
    revert: () => execFileAsync('powercfg', ['/hibernate', 'on']).then(() => undefined)
  },

  // ─── NETWORK ───
  {
    id: 'disable-ipv6',
    category: 'network',
    label: 'Disable IPv6',
    description: 'Disable IPv6 system-wide on all network adapters (requires a restart)',
    requiresAdmin: true,
    check: async () => {
      const val = await regQueryDword(
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters',
        'DisabledComponents'
      )
      return val === 0xff
    },
    apply: () =>
      regSetDword(
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters',
        'DisabledComponents',
        0xff
      ),
    revert: () =>
      regDeleteValue(
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters',
        'DisabledComponents'
      )
  },
  {
    id: 'disable-teredo',
    category: 'network',
    label: 'Disable Teredo',
    description: 'Turn off the Teredo IPv6 tunneling interface',
    requiresAdmin: true,
    check: async () => {
      const { stdout } = await execFileAsync('netsh', ['interface', 'teredo', 'show', 'state'])
      return /type\s*:\s*disabled/i.test(stdout)
    },
    apply: () =>
      execFileAsync('netsh', ['interface', 'teredo', 'set', 'state', 'disabled']).then(
        () => undefined
      ),
    revert: () =>
      execFileAsync('netsh', ['interface', 'teredo', 'set', 'state', 'default']).then(
        () => undefined
      )
  },

  // ─── SYSTEM ───
  {
    id: 'remove-onedrive',
    category: 'system',
    label: 'Uninstall OneDrive',
    description:
      'Silently uninstall Microsoft OneDrive and remove it from Explorer. Cannot be undone automatically — reinstall from microsoft.com if needed.',
    requiresAdmin: false,
    check: async () => !(await keyExists('HKCU\\Software\\Microsoft\\OneDrive')),
    applicable: async () => keyExists('HKCU\\Software\\Microsoft\\OneDrive'),
    apply: async () => {
      const localAppData = process.env.LOCALAPPDATA ?? ''
      const setupPath = `${localAppData}\\Microsoft\\OneDrive\\OneDriveSetup.exe`
      await execFileAsync(setupPath, ['/uninstall']).catch(() => undefined)
    }
    // No revert: uninstalling third-party/Microsoft software isn't something
    // we can safely reinstall automatically. Matches the existing pattern for
    // irreversible actions elsewhere in Atlas (the toggle simply stays locked on).
  }
]

function getSettings(): TweakDef[] {
  return process.platform === 'win32' ? SETTINGS : []
}

export async function scanTweaks(
  onProgress?: (data: {
    current: number
    total: number
    currentId: string
    currentLabel: string
    category: string
  }) => void
): Promise<SystemTweaksState> {
  const defs = getSettings()
  const settings: SystemTweakSetting[] = []
  const total = defs.length

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]
    onProgress?.({
      current: i + 1,
      total,
      currentId: def.id,
      currentLabel: def.label,
      category: def.category
    })

    const enabled = await withTimeout(
      def.check().catch(() => false),
      10000,
      false
    )
    const isApplicable = def.applicable
      ? await withTimeout(
          def.applicable().catch(() => true),
          10000,
          true
        )
      : true
    const reversible = typeof def.revert === 'function' && isApplicable

    settings.push({
      id: def.id,
      category: def.category,
      label: def.label,
      description: def.description,
      enabled,
      reversible,
      requiresAdmin: def.requiresAdmin
    })
  }

  const applied = settings.filter((s) => s.enabled).length
  return { settings, total, applied }
}

export async function applyTweaks(ids: string[]): Promise<SystemTweaksApplyResult> {
  const defs = getSettings()
  let succeeded = 0
  let failed = 0
  const errors: SystemTweaksApplyResult['errors'] = []

  for (const id of ids) {
    const def = defs.find((s) => s.id === id)
    if (!def) continue
    try {
      await def.apply()
      succeeded++
    } catch (err) {
      failed++
      errors.push({
        id: def.id,
        label: def.label,
        reason: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }
  return { succeeded, failed, errors }
}

export async function revertTweaks(ids: string[]): Promise<SystemTweaksApplyResult> {
  const defs = getSettings()
  let succeeded = 0
  let failed = 0
  const errors: SystemTweaksApplyResult['errors'] = []

  for (const id of ids) {
    const def = defs.find((s) => s.id === id)
    if (!def || !def.revert) {
      failed++
      errors.push({ id, label: id, reason: 'Revert not supported for this tweak' })
      continue
    }
    try {
      await def.revert()
      succeeded++
    } catch (err) {
      failed++
      errors.push({
        id: def.id,
        label: def.label,
        reason: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }
  return { succeeded, failed, errors }
}

// ─── IPC handlers ────────────────────────────────────────────

export function registerSystemTweaksIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.TWEAKS_SCAN, () =>
    scanTweaks((data) => {
      sendProgress(getWindow(), data)
    })
  )

  ipcMain.handle(IPC.TWEAKS_APPLY, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 1_000)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return applyTweaks(valid)
  })

  ipcMain.handle(IPC.TWEAKS_REVERT, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 1_000)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return revertTweaks(valid)
  })
}

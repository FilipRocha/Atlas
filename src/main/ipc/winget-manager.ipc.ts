import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { isAbsolute, join, win32 } from 'node:path'
import { IPC } from '../../shared/channels'
import type {
  WingetSearchResult,
  WingetListResult,
  WingetUpgradeCheckResult,
  WingetUpgradeOneResult,
  WingetUpgradeAllResult,
  WingetInstallResult,
  WingetUninstallResult,
  WingetIconResult,
  WingetOperationProgress,
  WingetPrereqState,
  WingetBootstrapInstallResult,
  WingetLogPage
} from '../../shared/winget'
import type { WindowGetter } from './index'
import { isAdmin } from '../services/elevation'
import {
  isWingetAvailable,
  resetWingetAvailabilityCache,
  parseWingetTable,
  rowToSearchItem,
  rowToListOrUpgradeItem,
  runWinget
} from '../services/winget-engine'
import { resolveLocalIcon } from '../services/winget-icons'
import { showOpenDialog } from './open-dialog'
import {
  clearWingetLog,
  getWingetLogPath,
  logWinget,
  logWingetStderr,
  readWingetLog,
  revealWingetLog
} from '../services/winget-logger'

const execFileAsync = promisify(execFile)
const APP_INSTALLER_BUNDLE = 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle'

function getAppInstallerBundlePath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'winget', APP_INSTALLER_BUNDLE)
  return join(app.getAppPath(), 'resources', 'winget', APP_INSTALLER_BUNDLE)
}

async function installAppInstallerBundle(): Promise<WingetBootstrapInstallResult> {
  if (process.platform !== 'win32') return { success: false, error: 'Windows only' }

  const bundlePath = getAppInstallerBundlePath()
  if (!existsSync(bundlePath))
    return { success: false, error: 'WinGet installer bundle is missing.' }

  const escapedPath = bundlePath.replace(/'/g, "''")
  const script = `$ErrorActionPreference = 'Stop'; Add-AppxPackage -Path '${escapedPath}' -ErrorAction Stop; Write-Output 'APPINSTALLER_INSTALLED'`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')

  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedScript
      ],
      { windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024 }
    )
    resetWingetAvailabilityCache()
    return { success: true }
  } catch (error) {
    resetWingetAvailabilityCache()
    const detail = error as { stderr?: string; message?: string }
    return {
      success: false,
      error: (detail.stderr || detail.message || 'App Installer deployment failed.')
        .trim()
        .slice(-2000)
    }
  }
}

// Flags required on every install/upgrade call so winget never blocks on an
// interactive prompt in the background (rule #13 — "Zero Touch").
// NOTE: --accept-package-agreements is only valid on commands that actually
// install/upgrade something. Passing it to `search` or `list` makes winget
// reject the whole command line with APPINSTALLER_CLI_ERROR_INVALID_CL_ARGUMENTS
// (0x8A150002) — that was the root cause of search/list always coming back
// empty. Those two read-only commands only need --accept-source-agreements.
const AUTO_ACCEPT_FLAGS = ['--accept-package-agreements', '--accept-source-agreements']
const SOURCE_AGREEMENTS_FLAG = '--accept-source-agreements'
const DISABLE_INTERACTIVITY = '--disable-interactivity'

function sendProgress(win: BrowserWindow | null, data: WingetOperationProgress): void {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.WINGET_OPERATION_PROGRESS, data)
  } catch {
    // window may have closed mid-operation
  }
}

function newRequestId(): string {
  return `wg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function checkPrereqs(): Promise<WingetPrereqState> {
  const [admin, available] = await Promise.all([isAdmin(), isWingetAvailable()])
  return { isAdmin: admin, wingetAvailable: available }
}

// ─── Search (Feature 9) ────────────────────────────────────────

async function search(term: string): Promise<WingetSearchResult> {
  const query = term.trim().slice(0, 200)
  if (!query) return { query, items: [], truncated: false, durationMs: 0 }
  const start = Date.now()
  // `search` is read-only — it never hits an interactive prompt, so it
  // doesn't need --disable-interactivity. Some older winget builds reject
  // that flag on this verb with an "unknown argument" error, which used to
  // make every search look like "no results" instead of surfacing the real
  // failure. --accept-source-agreements is kept: a first-run machine that
  // hasn't accepted the source terms yet would otherwise return 0 rows too.
  const { stdout, exitCode, stderr } = await runWinget(['search', query, SOURCE_AGREEMENTS_FLAG])
  if (exitCode !== 0 && stderr.trim()) logWingetStderr('search', stderr.trim())
  logWinget('search', `query="${query}" exit=${exitCode}`)

  const rows = parseWingetTable(stdout)
  const items = rows.map(rowToSearchItem).filter((i) => i.id)
  // exitCode 0 with 0 rows is a genuine "no matches"; a non-zero exit means
  // winget itself failed (offline, source unreachable, bad argument, etc.)
  // and that failure should reach the UI instead of looking like "no results".
  // WinGet uses 0x8A150014 for the normal "no packages found" case.
  // That is not a technical failure and should not become a scary error toast
  // when the user simply mistypes a program name (for example, "steamm").
  const noPackagesFound = exitCode === 0x8a150014 || exitCode === -1978335212
  const error =
    exitCode !== 0 && !noPackagesFound
      ? stderr.trim() || `winget exited with code ${exitCode}`
      : undefined
  return {
    query,
    items: items.slice(0, 200),
    truncated: items.length > 200,
    durationMs: Date.now() - start,
    error
  }
}

// ─── Installed packages (Feature 11) ───────────────────────────

async function listInstalled(): Promise<WingetListResult> {
  // Same reasoning as search(): `list` is read-only, drop --disable-interactivity.
  const { stdout, exitCode, stderr } = await runWinget(['list', SOURCE_AGREEMENTS_FLAG])
  if (exitCode !== 0 && stderr.trim()) logWingetStderr('list', stderr.trim())
  logWinget('list', `exit=${exitCode}`)

  const rows = parseWingetTable(stdout)
  const apps = rows
    .map(rowToListOrUpgradeItem)
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      availableVersion: r.available,
      source: r.source
    }))
  const error = exitCode !== 0 ? stderr.trim() || `winget exited with code ${exitCode}` : undefined
  return { apps, totalCount: apps.length, scannedAt: new Date().toISOString(), error }
}

async function uninstallOne(id: string, name: string): Promise<WingetUninstallResult> {
  logWinget('uninstall', `starting id="${id}"`)
  const { exitCode, stderr } = await runWinget([
    'uninstall',
    '--id',
    id,
    '--silent',
    ...AUTO_ACCEPT_FLAGS,
    DISABLE_INTERACTIVITY
  ])
  const success = exitCode === 0
  if (!success && stderr.trim()) logWingetStderr('uninstall', `id="${id}" ${stderr.trim()}`)
  logWinget('uninstall', `finished id="${id}" exit=${exitCode}`)
  return {
    success,
    id,
    name,
    exitCode,
    error: success ? undefined : stderr.trim() || `exit code ${exitCode}`
  }
}

async function installOne(
  getWindow: WindowGetter,
  id: string,
  name: string,
  location: string | undefined,
  requestId: string
): Promise<WingetInstallResult> {
  logWinget('install', `starting id="${id}"`)
  const args = [
    'install',
    '--id',
    id,
    '--exact',
    '--silent',
    ...AUTO_ACCEPT_FLAGS,
    DISABLE_INTERACTIVITY
  ]
  if (location) {
    // The drive picker supplies a parent such as `C:\\Program Files`. Passing
    // that directly makes some EXE installers (including 7-Zip/WinRAR) place
    // every file in the parent itself. Give each package its own subfolder.
    const folderName = name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 80)
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    const target =
      folderName && normalize(win32.basename(location)) === normalize(folderName)
        ? location
        : folderName
          ? win32.join(location, folderName)
          : location
    args.push('--location', target)
    logWinget('install', `resolved location="${target}"`)
  }
  sendProgress(getWindow(), {
    requestId,
    op: 'install',
    phase: 'starting',
    current: 1,
    total: 1,
    currentLabel: name,
    percent: -1
  })
  const { exitCode, stderr } = await runWinget(args, {
    timeoutMs: 30 * 60_000,
    onLine: (line) => {
      const percentMatch = /(\d{1,3})\s*%/.exec(line)
      const percent = percentMatch ? Math.max(0, Math.min(100, Number(percentMatch[1]))) : -1
      sendProgress(getWindow(), {
        requestId,
        op: 'install',
        phase: 'running',
        current: 1,
        total: 1,
        currentLabel: line.trim() || name,
        percent,
        line: line.trim()
      })
    }
  })
  const success = exitCode === 0
  if (!success && stderr.trim()) logWingetStderr('install', `id="${id}" ${stderr.trim()}`)
  logWinget('install', `finished id="${id}" exit=${exitCode}`)
  sendProgress(getWindow(), {
    requestId,
    op: 'install',
    phase: success ? 'done' : 'failed',
    current: 1,
    total: 1,
    currentLabel: name,
    percent: success ? 100 : -1
  })
  return {
    success,
    id,
    name,
    exitCode,
    error: success ? undefined : stderr.trim() || `exit code ${exitCode}`
  }
}

// ─── Update manager (Feature 10) ───────────────────────────────

async function upgradeCheck(): Promise<WingetUpgradeCheckResult> {
  const { stdout, exitCode, stderr } = await runWinget([
    'upgrade',
    '--include-unknown',
    ...AUTO_ACCEPT_FLAGS,
    DISABLE_INTERACTIVITY
  ])
  if (exitCode !== 0 && stderr.trim()) logWingetStderr('upgrade-check', stderr.trim())
  logWinget('upgrade-check', `exit=${exitCode}`)

  const rows = parseWingetTable(stdout)
  const items = rows
    .map(rowToListOrUpgradeItem)
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      currentVersion: r.version,
      availableVersion: r.available ?? r.version,
      source: r.source
    }))
  return { items, totalCount: items.length, scannedAt: new Date().toISOString() }
}

async function upgradeOne(
  id: string,
  name: string,
  onLine: (line: string) => void
): Promise<WingetUpgradeOneResult> {
  logWinget('upgrade-one', `starting id="${id}"`)
  const { exitCode, stderr } = await runWinget(
    ['upgrade', '--id', id, '--exact', '--silent', ...AUTO_ACCEPT_FLAGS, DISABLE_INTERACTIVITY],
    { onLine: (line) => onLine(line) }
  )
  const success = exitCode === 0
  if (!success && stderr.trim()) logWingetStderr('upgrade-one', `id="${id}" ${stderr.trim()}`)
  logWinget('upgrade-one', `finished id="${id}" exit=${exitCode}`)
  return {
    id,
    name,
    success,
    exitCode,
    error: success ? undefined : stderr.trim() || `exit code ${exitCode}`
  }
}

/** `winget upgrade --all` — used by the "Atualizar Tudo" button (Feature 10). */
async function upgradeAll(
  getWindow: WindowGetter,
  requestId: string
): Promise<WingetUpgradeAllResult> {
  const start = Date.now()
  logWinget('upgrade-all', 'starting')

  const before = await upgradeCheck().catch(() => ({ totalCount: -1 }) as WingetUpgradeCheckResult)

  sendProgress(getWindow(), {
    requestId,
    op: 'upgrade-all',
    phase: 'starting',
    current: 0,
    total: 0,
    currentLabel: '',
    percent: -1
  })

  const { exitCode, stdout, stderr } = await runWinget(
    [
      'upgrade',
      '--all',
      '--include-unknown',
      '--silent',
      ...AUTO_ACCEPT_FLAGS,
      DISABLE_INTERACTIVITY
    ],
    {
      timeoutMs: 30 * 60_000, // updating everything can legitimately take a while
      onLine: (line) => {
        const pctMatch = /(\d{1,3})\s*%/.exec(line)
        sendProgress(getWindow(), {
          requestId,
          op: 'upgrade-all',
          phase: 'running',
          current: 0,
          total: 0,
          currentLabel: line.trim(),
          percent: pctMatch ? Number(pctMatch[1]) : -1,
          line: line.trim()
        })
      }
    }
  )

  if (exitCode !== 0 && stderr.trim()) logWingetStderr('upgrade-all', stderr.trim())
  logWinget('upgrade-all', `finished exit=${exitCode}`)

  const after = await upgradeCheck().catch(
    () => ({ totalCount: before.totalCount }) as WingetUpgradeCheckResult
  )

  // Best-effort per-package failure line parsing, for the error list shown
  // in the summary toast — the full transcript is already in the console/log.
  const failLines = stdout
    .split('\n')
    .filter((l) => /failed|error|falhou|erro/i.test(l) && /\S/.test(l))

  const succeeded =
    before.totalCount >= 0 && after.totalCount >= 0
      ? Math.max(0, before.totalCount - after.totalCount)
      : 0

  const result: WingetUpgradeAllResult = {
    succeeded,
    failed: after.totalCount, // whatever is still outdated afterwards counts as failed/remaining
    errors: failLines.slice(0, 50).map((l) => ({ id: '', name: '', reason: l.trim() })),
    durationMs: Date.now() - start
  }

  sendProgress(getWindow(), {
    requestId,
    op: 'upgrade-all',
    phase: exitCode === 0 ? 'done' : 'failed',
    current: 0,
    total: 0,
    currentLabel: '',
    percent: 100
  })

  return result
}

// ─── IPC registration ──────────────────────────────────────────

export function registerWingetManagerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINGET_SELECT_INSTALL_DIR, async (_event, title: unknown) => {
    if (process.platform !== 'win32') return null
    const result = await showOpenDialog(getWindow(), {
      title: typeof title === 'string' ? title.slice(0, 120) : 'Choose installation folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.WINGET_PREREQS, () => checkPrereqs())

  ipcMain.handle(IPC.WINGET_OPEN_STORE, async (event) => {
    if (process.platform !== 'win32' || event.sender !== getWindow()?.webContents) return false
    await shell.openExternal('ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1')
    return true
  })

  ipcMain.handle(
    IPC.WINGET_INSTALL_APPINSTALLER,
    async (event): Promise<WingetBootstrapInstallResult> => {
      if (process.platform !== 'win32' || event.sender !== getWindow()?.webContents) {
        return { success: false, error: 'The request could not be verified.' }
      }
      if (await isWingetAvailable()) return { success: true }
      return installAppInstallerBundle()
    }
  )

  ipcMain.handle(IPC.WINGET_SEARCH, async (_event, term: unknown) => {
    if (typeof term !== 'string') return { query: '', items: [], truncated: false, durationMs: 0 }
    return search(term)
  })

  ipcMain.handle(IPC.WINGET_LIST_INSTALLED, () => listInstalled())

  ipcMain.handle(
    IPC.WINGET_GET_ICON,
    async (_event, id: unknown, name: unknown): Promise<WingetIconResult> => {
      const safeId = typeof id === 'string' ? id : ''
      const safeName = typeof name === 'string' ? name : ''
      if (!safeName) return { id: safeId, dataUrl: null }
      const dataUrl = await resolveLocalIcon(safeName)
      return { id: safeId, dataUrl }
    }
  )

  ipcMain.handle(IPC.WINGET_UNINSTALL, async (_event, id: unknown, name: unknown) => {
    const admin = await isAdmin()
    if (!admin) {
      return {
        success: false,
        id: String(id ?? ''),
        name: String(name ?? ''),
        exitCode: null,
        error: 'needs-admin'
      }
    }
    if (typeof id !== 'string' || !id) {
      return {
        success: false,
        id: '',
        name: String(name ?? ''),
        exitCode: null,
        error: 'invalid-id'
      }
    }
    return uninstallOne(id, typeof name === 'string' ? name : id)
  })

  ipcMain.handle(
    IPC.WINGET_INSTALL,
    async (_event, id: unknown, name: unknown, location: unknown) => {
      const admin = await isAdmin()
      if (!admin) {
        return {
          success: false,
          id: String(id ?? ''),
          name: String(name ?? ''),
          exitCode: null,
          error: 'needs-admin'
        }
      }
      if (typeof id !== 'string' || !id) {
        return {
          success: false,
          id: '',
          name: String(name ?? ''),
          exitCode: null,
          error: 'invalid-id'
        }
      }
      if (
        location !== undefined &&
        (typeof location !== 'string' || !isAbsolute(location) || location.length > 2048)
      ) {
        return {
          success: false,
          id,
          name: String(name ?? id),
          exitCode: null,
          error: 'invalid-location'
        }
      }
      return installOne(
        getWindow,
        id,
        typeof name === 'string' ? name : id,
        location as string | undefined,
        newRequestId()
      )
    }
  )

  ipcMain.handle(IPC.WINGET_UPGRADE_CHECK, () => upgradeCheck())

  ipcMain.handle(IPC.WINGET_UPGRADE_ONE, async (_event, id: unknown, name: unknown) => {
    const admin = await isAdmin()
    if (!admin) {
      return {
        id: String(id ?? ''),
        name: String(name ?? ''),
        success: false,
        exitCode: null,
        error: 'needs-admin'
      }
    }
    if (typeof id !== 'string' || !id) {
      return {
        id: '',
        name: String(name ?? ''),
        success: false,
        exitCode: null,
        error: 'invalid-id'
      }
    }
    const requestId = newRequestId()
    return upgradeOne(id, typeof name === 'string' ? name : id, (line) =>
      sendProgress(getWindow(), {
        requestId,
        op: 'upgrade-one',
        phase: 'running',
        current: 0,
        total: 1,
        currentLabel: name as string,
        percent: -1,
        line
      })
    )
  })

  ipcMain.handle(IPC.WINGET_UPGRADE_ALL, async () => {
    const admin = await isAdmin()
    if (!admin) {
      return {
        succeeded: 0,
        failed: 0,
        errors: [{ id: '', name: '', reason: 'needs-admin' }],
        durationMs: 0
      }
    }
    const requestId = newRequestId()
    return upgradeAll(getWindow, requestId)
  })

  // Winget console / log (Feature 15)
  ipcMain.handle(IPC.WINGET_LOG_GET, (): WingetLogPage => ({
    entries: readWingetLog(),
    logPath: getWingetLogPath()
  }))
  ipcMain.handle(IPC.WINGET_LOG_OPEN, () => revealWingetLog())
  ipcMain.handle(IPC.WINGET_LOG_CLEAR, () => clearWingetLog())
}

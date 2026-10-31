import { BrowserWindow, ipcMain, shell } from 'electron'
import { lstat, readdir, realpath, stat } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join, basename, sep, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { IPC } from '../../shared/channels'
import { extname } from 'path'
import { isAdmin } from '../services/elevation'
import type {
  DiskNode,
  DriveInfo,
  FileTypeInfo,
  DiskRepairResult,
  DiskRepairProgress,
  AdvancedRepairResult,
  AdvancedRepairToolId
} from '../../shared/types'
import type { WindowGetter } from './index'
import { psUtf8, ConsoleOutputDecoder } from '../services/exec-utf8'

const execFileAsync = promisify(execFile)

const MAX_DEPTH = 3
const FILE_TYPE_MAX_DEPTH = 4

/** Resolve Windows repair tools from System32 instead of relying on PATH/cmd.exe. */
function windowsSystemTool(name: 'sfc.exe' | 'dism.exe' | 'chkdsk.exe'): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return join(systemRoot, 'System32', name)
}

function windowsSystemCommand(name: string): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return join(systemRoot, 'System32', name)
}

// ── Internal helpers ──

async function analyzeDirectory(
  dirPath: string,
  depth: number,
  mainWindow: BrowserWindow | null
): Promise<DiskNode> {
  const node: DiskNode = {
    name: basename(dirPath) || dirPath,
    path: dirPath,
    size: 0,
    fileCount: 0,
    modifiedAt: undefined,
    children: [],
    isFile: false
  }

  if (depth >= MAX_DEPTH) {
    // Keep the returned tree shallow for the renderer, but continue measuring
    // the complete subtree. Stopping the size scan here silently omitted every
    // file nested below the tree depth limit.
    node.children = undefined
    const metadata = await measureDirectoryMetadata(dirPath)
    node.size = metadata.size
    node.fileCount = metadata.fileCount
    node.modifiedAt = metadata.modifiedAt
    return node
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const child = await analyzeDirectory(fullPath, depth + 1, mainWindow)
          node.children!.push(child)
          node.size += child.size
          node.fileCount = (node.fileCount ?? 0) + (child.fileCount ?? 0)
          node.modifiedAt = Math.max(node.modifiedAt ?? 0, child.modifiedAt ?? 0) || undefined
        } else {
          const s = await lstat(fullPath)
          if (!s.isSymbolicLink() && s.isFile()) {
            node.children!.push({
              name: entry.name,
              path: fullPath,
              size: s.size,
              fileCount: 1,
              modifiedAt: s.mtimeMs,
              isFile: true
            })
            node.size += s.size
            node.fileCount = (node.fileCount ?? 0) + 1
            node.modifiedAt = Math.max(node.modifiedAt ?? 0, s.mtimeMs) || undefined
          }
        }
      } catch {
        // Skip inaccessible
      }
    }

    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk',
        currentPath: dirPath,
        progress: 50,
        itemsFound: node.children!.length,
        sizeFound: node.size
      })
    }
  } catch {
    // Inaccessible directory
  }

  node.children?.sort((a, b) => b.size - a.size)
  return node
}

async function collectFileTypes(
  dirPath: string,
  depth: number,
  extMap: Map<string, { size: number; count: number }>,
  mainWindow: BrowserWindow | null
): Promise<void> {
  if (depth >= FILE_TYPE_MAX_DEPTH) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          await collectFileTypes(fullPath, depth + 1, extMap, mainWindow)
        } else {
          const s = await stat(fullPath)
          const ext = (extname(entry.name) || '(no extension)').toLowerCase()
          const existing = extMap.get(ext)
          if (existing) {
            existing.size += s.size
            existing.count += 1
          } else {
            extMap.set(ext, { size: s.size, count: 1 })
          }
        }
      } catch {
        // Skip inaccessible
      }
    }
    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk-file-types',
        currentPath: dirPath,
        progress: 50,
        itemsFound: extMap.size,
        sizeFound: 0
      })
    }
  } catch {
    // Inaccessible directory
  }
}

interface DirectoryMetadata {
  size: number
  fileCount: number
  modifiedAt?: number
}

const DIRECTORY_STATS_CACHE_TTL_MS = 2 * 60 * 1000
const directoryStatsCache = new Map<string, { metadata: DirectoryMetadata; cachedAt: number }>()
const directoryStatsInFlight = new Map<string, Promise<DirectoryMetadata>>()
let directoryStatsGeneration = 0

function invalidateDirectoryStatsCache(): void {
  directoryStatsGeneration += 1
  directoryStatsCache.clear()
  directoryStatsInFlight.clear()
}

function getCachedDirectoryMetadata(dirPath: string): DirectoryMetadata | null {
  const key = process.platform === 'win32' ? dirPath.toLowerCase() : dirPath
  const cached = directoryStatsCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > DIRECTORY_STATS_CACHE_TTL_MS) {
    directoryStatsCache.delete(key)
    return null
  }
  return cached.metadata
}

async function measureDirectoryMetadata(dirPath: string): Promise<DirectoryMetadata> {
  const cacheKey = process.platform === 'win32' ? dirPath.toLowerCase() : dirPath
  const cached = getCachedDirectoryMetadata(dirPath)
  if (cached) return cached
  const inFlight = directoryStatsInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const scanGeneration = directoryStatsGeneration
  const scan = measureDirectoryMetadataUncached(dirPath).then((metadata) => {
    if (scanGeneration === directoryStatsGeneration) {
      directoryStatsCache.set(cacheKey, { metadata, cachedAt: Date.now() })
    }
    return metadata
  })
  directoryStatsInFlight.set(cacheKey, scan)
  try {
    return await scan
  } finally {
    if (directoryStatsInFlight.get(cacheKey) === scan) directoryStatsInFlight.delete(cacheKey)
  }
}

async function measureDirectoryMetadataUncached(dirPath: string): Promise<DirectoryMetadata> {
  const result: DirectoryMetadata = { size: 0, fileCount: 0 }
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        if (entry.isSymbolicLink()) continue
        const fullPath = join(dirPath, entry.name)
        if (entry.isDirectory()) {
          const child = await measureDirectoryMetadata(fullPath)
          result.size += child.size
          result.fileCount += child.fileCount
          result.modifiedAt = Math.max(result.modifiedAt ?? 0, child.modifiedAt ?? 0) || undefined
        } else {
          const s = await lstat(fullPath)
          if (!s.isSymbolicLink() && s.isFile()) {
            result.size += s.size
            result.fileCount += 1
            result.modifiedAt = Math.max(result.modifiedAt ?? 0, s.mtimeMs) || undefined
          }
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return result
}

// ── Exported core logic ──

export async function getDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    try {
      // Enumerate filesystem PSDrives directly. WMI/CIM can be unavailable in
      // restricted Windows environments, which previously made every scan
      // appear empty even though the drives were accessible.
      const driveScript = `$system = $env:SystemDrive.TrimEnd(':'); Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\\\$' } | ForEach-Object { $used = if ($null -ne $_.Used) { $_.Used } else { 0 }; $free = if ($null -ne $_.Free) { $_.Free } else { 0 }; "$($_.Name)|$($_.Description)|$used|$free|$($_.Name -eq $system)" }`
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psUtf8(driveScript)],
        { timeout: 10000, windowsHide: true }
      )

      const drives: DriveInfo[] = []
      for (const line of stdout.trim().split('\n')) {
        const [letter, label, used, free, isSystem] = line.trim().split('|')
        if (letter) {
          const usedSpace = parseInt(used) || 0
          const freeSpace = parseInt(free) || 0
          drives.push({
            letter: letter.trim(),
            label: label?.trim() || letter.trim(),
            isSystem: isSystem?.trim().toLowerCase() === 'true',
            totalSize: usedSpace + freeSpace,
            freeSpace,
            usedSpace
          })
        }
      }
      return drives
    } catch {
      return []
    }
  }

  // macOS / Linux: parse `df` output for mounted filesystems
  try {
    const { stdout } = await execFileAsync('df', ['-Pk'], { timeout: 10000 })
    const drives: DriveInfo[] = []
    const lines = stdout.trim().split('\n').slice(1) // skip header
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 6) continue
      const totalKb = parseInt(parts[1]) || 0
      const usedKb = parseInt(parts[2]) || 0
      const freeKb = parseInt(parts[3]) || 0
      const mount = parts.slice(5).join(' ')
      // Only include real filesystems (skip tmpfs, devfs, etc.)
      if (!parts[0].startsWith('/dev/')) continue
      drives.push({
        letter: mount,
        label: mount === '/' ? 'Root' : basename(mount),
        isSystem: mount === '/',
        totalSize: totalKb * 1024,
        freeSpace: freeKb * 1024,
        usedSpace: usedKb * 1024
      })
    }
    return drives
  } catch {
    return []
  }
}

/** Resolve a drive identifier to a root path (Windows letter or Unix mount path) */
function resolveRootPath(drive: string): string | null {
  if (typeof drive !== 'string' || !drive) return null
  if (process.platform === 'win32') {
    if (/^[A-Za-z]$/.test(drive)) return `${drive.toUpperCase()}:\\`
    return null
  }
  // Unix: accept absolute paths (mount points returned by getDrives)
  if (drive.startsWith(sep)) return drive
  return null
}

export async function analyzeDisk(drive: string): Promise<DiskNode> {
  const rootPath = resolveRootPath(drive)
  if (!rootPath) return { name: '', path: '', size: 0, children: [] }
  return analyzeDirectory(rootPath, 0, null)
}

/** Ensure renderer-supplied paths remain on the selected volume and do not traverse links. */
async function validatedDiskPath(
  drive: unknown,
  targetPath: unknown,
  allowRoot: boolean
): Promise<{ root: string; target: string } | null> {
  if (typeof drive !== 'string' || typeof targetPath !== 'string' || !isAbsolute(targetPath)) {
    return null
  }
  const root = resolveRootPath(drive)
  if (!root) return null
  const resolvedRoot = resolve(root)
  const target = resolve(targetPath)
  const relativePath = relative(resolvedRoot, target)
  if (
    (!allowRoot && !relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null
  }
  try {
    const [rootReal, targetReal, targetStats] = await Promise.all([
      realpath(resolvedRoot),
      realpath(target),
      lstat(target)
    ])
    const realRelative = relative(rootReal, targetReal)
    if (
      targetStats.isSymbolicLink() ||
      realRelative === '..' ||
      realRelative.startsWith(`..${sep}`) ||
      isAbsolute(realRelative)
    ) {
      return null
    }
    return { root: resolvedRoot, target }
  } catch {
    return null
  }
}

/** List one folder immediately; deep totals are filled from cache or in a background request. */
async function listDirectoryContents(folderPath: string): Promise<DiskNode | null> {
  try {
    const folderStat = await lstat(folderPath)
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) return null
    const node: DiskNode = {
      name: basename(folderPath) || folderPath,
      path: folderPath,
      size: 0,
      fileCount: 0,
      modifiedAt: undefined,
      children: [],
      isFile: false
    }
    const entries = await readdir(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(folderPath, entry.name)
      try {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          const stats = await lstat(fullPath)
          const metadata = getCachedDirectoryMetadata(fullPath)
          node.children!.push({
            name: entry.name,
            path: fullPath,
            size: metadata?.size ?? 0,
            fileCount: metadata?.fileCount ?? 0,
            modifiedAt: metadata?.modifiedAt ?? stats.mtimeMs,
            statsLoading: metadata === null,
            isFile: false
          })
          node.size += metadata?.size ?? 0
          node.fileCount = (node.fileCount ?? 0) + (metadata?.fileCount ?? 0)
          node.modifiedAt =
            Math.max(node.modifiedAt ?? 0, metadata?.modifiedAt ?? stats.mtimeMs) || undefined
        } else if (entry.isFile()) {
          const itemStat = await lstat(fullPath)
          node.children!.push({
            name: entry.name,
            path: fullPath,
            size: itemStat.size,
            fileCount: 1,
            modifiedAt: itemStat.mtimeMs,
            isFile: true
          })
          node.size += itemStat.size
          node.fileCount = (node.fileCount ?? 0) + 1
          node.modifiedAt = Math.max(node.modifiedAt ?? 0, itemStat.mtimeMs) || undefined
        }
      } catch {
        // Skip entries that disappeared or cannot be read.
      }
    }
    node.statsLoading = node.children!.some((child) => child.statsLoading)
    node.children!.sort((a, b) => b.size - a.size)
    return node
  } catch {
    return null
  }
}

/** Calculate full descendant totals after the immediate folder listing is visible. */
async function analyzeDirectoryContentsWithStats(folderPath: string): Promise<DiskNode | null> {
  try {
    const node = await listDirectoryContents(folderPath)
    if (!node) return null
    await Promise.all(
      (node.children ?? [])
        .filter((child) => !child.isFile && child.statsLoading)
        .map(async (child) => {
          const metadata = await measureDirectoryMetadata(child.path)
          child.size = metadata.size
          child.fileCount = metadata.fileCount
          child.modifiedAt = metadata.modifiedAt
          child.statsLoading = false
        })
    )
    node.size = node.children?.reduce((total, child) => total + child.size, 0) ?? 0
    node.fileCount = node.children?.reduce((total, child) => total + (child.fileCount ?? 0), 0) ?? 0
    node.modifiedAt =
      node.children?.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0) ||
      undefined
    node.statsLoading = false
    node.children?.sort((a, b) => b.size - a.size)
    return node
  } catch {
    return null
  }
}

export async function getFileTypes(drive: string): Promise<FileTypeInfo[]> {
  const rootPath = resolveRootPath(drive)
  if (!rootPath) return []
  const extMap = new Map<string, { size: number; count: number }>()
  await collectFileTypes(rootPath, 0, extMap, null)
  const results: FileTypeInfo[] = []
  for (const [ext, info] of extMap) {
    results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
  }
  results.sort((a, b) => b.totalSize - a.totalSize)
  return results
}

// ── Disk Repair helpers (Windows SFC / DISM) ──

function sendRepairProgress(win: BrowserWindow | null, data: DiskRepairProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.DISK_REPAIR_PROGRESS, data)
  }
}

/**
 * Run SFC /scannow and stream progress to the renderer.
 * SFC outputs progress lines like "Verification 42% complete."
 */
async function runSfc(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (process.platform !== 'win32') {
    return {
      tool: 'sfc',
      success: false,
      exitCode: null,
      summary: 'SFC is only available on Windows',
      log: '',
      requiresReboot: false,
      needsAdmin: false
    }
  }
  if (!isAdmin()) {
    return {
      tool: 'sfc',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run SFC',
      log: '',
      requiresReboot: false,
      needsAdmin: true
    }
  }

  // Validate drive letter — must be a single A-Z character
  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    const args = ['/scannow']
    // If a non-system drive is specified, use /offbootdir and /offwindir
    if (safeDrive !== 'C') {
      args.push(`/offbootdir=${safeDrive}:\\`, `/offwindir=${safeDrive}:\\Windows`)
    }

    const child = spawn(windowsSystemTool('sfc.exe'), args, { windowsHide: true })
    let stdout = ''
    let lastPercent = 0
    // sfc.exe ignores the code page and emits UTF-16LE when stdout is a pipe
    const decoder = new ConsoleOutputDecoder()
    const stderrDecoder = new ConsoleOutputDecoder()

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      // Parse progress from SFC output like "Verification 42% complete."
      const match = text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = parseInt(match[1])
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'sfc',
            phase: 'running',
            percent: pct,
            message: `System File Checker: ${pct}% complete`
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: 'failed',
        percent: 0,
        message: `SFC failed to start: ${err.message}`
      })
      resolve({
        tool: 'sfc',
        success: false,
        exitCode: null,
        summary: `Failed to start SFC: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false
      })
    })

    child.on('close', (code) => {
      stdout += decoder.end() + stderrDecoder.end()
      const success = code === 0
      let summary: string
      if (stdout.includes('did not find any integrity violations')) {
        summary = 'No integrity violations found — your system files are healthy.'
      } else if (stdout.includes('successfully repaired')) {
        summary = 'Windows found and repaired corrupted system files.'
      } else if (stdout.includes('found corrupt files but was unable to fix')) {
        summary =
          'Corrupted files were found but could not be repaired. Try running DISM first, then SFC again.'
      } else if (success) {
        summary = 'SFC completed successfully.'
      } else {
        summary = `SFC exited with code ${code}.`
      }

      // Check for reboot indicators — use specific phrases, not generic words
      const requiresReboot = /pending system repair|restart your computer|reboot.*required/i.test(
        stdout
      )
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary
      })
      resolve({
        tool: 'sfc',
        success,
        exitCode: code,
        summary,
        log: stdout,
        requiresReboot,
        needsAdmin: false
      })
    })
  })
}

/**
 * Run DISM /Online /Cleanup-Image /RestoreHealth and stream progress.
 * DISM outputs progress like "[==                 10.0%                 ]"
 */
async function runDism(getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (process.platform !== 'win32') {
    return {
      tool: 'dism',
      success: false,
      exitCode: null,
      summary: 'DISM is only available on Windows',
      log: '',
      requiresReboot: false,
      needsAdmin: false
    }
  }
  if (!isAdmin()) {
    return {
      tool: 'dism',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run DISM',
      log: '',
      requiresReboot: false,
      needsAdmin: true
    }
  }

  return new Promise((resolve) => {
    const child = spawn(
      windowsSystemTool('dism.exe'),
      ['/Online', '/Cleanup-Image', '/RestoreHealth'],
      { windowsHide: true }
    )
    let stdout = ''
    let lastPercent = 0
    const dismDecoder = new ConsoleOutputDecoder()
    const dismStderrDecoder = new ConsoleOutputDecoder()

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = dismDecoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/i)
      if (match) {
        const pct = Math.round(parseFloat(match[1]))
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'dism',
            phase: 'running',
            percent: pct,
            message: `DISM RestoreHealth: ${pct}% complete`
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += dismStderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: 'failed',
        percent: 0,
        message: `DISM failed to start: ${err.message}`
      })
      resolve({
        tool: 'dism',
        success: false,
        exitCode: null,
        summary: `Failed to start DISM: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false
      })
    })

    child.on('close', (code) => {
      stdout += dismDecoder.end() + dismStderrDecoder.end()
      const success = code === 0
      let summary: string
      if (stdout.includes('The restore operation completed successfully')) {
        summary = 'DISM successfully repaired the Windows component store.'
      } else if (stdout.includes('No component store corruption detected')) {
        summary = 'No component store corruption detected — image is healthy.'
      } else if (success) {
        summary = 'DISM completed successfully.'
      } else {
        summary = `DISM exited with code ${code}. Check the log for details.`
      }

      // Check for reboot indicators — use specific phrases to avoid false positives
      const requiresReboot = /restart your computer|reboot.*required|pending reboot/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary
      })
      resolve({
        tool: 'dism',
        success,
        exitCode: code,
        summary,
        log: stdout,
        requiresReboot,
        needsAdmin: false
      })
    })
  })
}

/**
 * Run CHKDSK on a drive and stream progress to the renderer.
 * CHKDSK outputs progress like "Stage 1: ... (42% complete)"
 */
async function runChkdsk(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (process.platform !== 'win32') {
    return {
      tool: 'chkdsk',
      success: false,
      exitCode: null,
      summary: 'CHKDSK is only available on Windows',
      log: '',
      requiresReboot: false,
      needsAdmin: false
    }
  }
  if (!isAdmin()) {
    return {
      tool: 'chkdsk',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run CHKDSK',
      log: '',
      requiresReboot: false,
      needsAdmin: true
    }
  }

  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    const child = spawn(windowsSystemTool('chkdsk.exe'), [`${safeDrive}:`, '/scan'], {
      windowsHide: true
    })
    let stdout = ''
    let lastPercent = 0
    const decoder = new ConsoleOutputDecoder()
    const stderrDecoder = new ConsoleOutputDecoder()

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+)\s*percent/i) || text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = parseInt(match[1])
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'chkdsk',
            phase: 'running',
            percent: pct,
            message: `CHKDSK: ${pct}% complete`
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: 'failed',
        percent: 0,
        message: `CHKDSK failed to start: ${err.message}`
      })
      resolve({
        tool: 'chkdsk',
        success: false,
        exitCode: null,
        summary: `Failed to start CHKDSK: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false
      })
    })

    child.on('close', (code) => {
      stdout += decoder.end() + stderrDecoder.end()
      // CHKDSK exit codes: 0 = no errors, 1 = errors found & fixed,
      // 2 = cleanup performed, 3 = could not check the disk.
      // Codes 0–2 are successful completions.
      const success = code !== null && code <= 2
      let summary: string
      if (stdout.includes('Windows has scanned the file system and found no problems')) {
        summary = 'No file system errors found — disk is healthy.'
      } else if (stdout.includes('Windows has made corrections to the file system')) {
        summary = 'File system errors were found and repaired.'
      } else if (stdout.includes('no further action is required')) {
        summary = 'CHKDSK completed — no further action required.'
      } else if (code === 1) {
        summary = 'Errors were found and fixed successfully.'
      } else if (code === 2) {
        summary = 'CHKDSK completed disk cleanup.'
      } else if (code === 0) {
        summary = 'CHKDSK completed successfully.'
      } else {
        summary = `CHKDSK exited with code ${code}. Check the log for details.`
      }

      const requiresReboot =
        /restart your computer|schedule.*check.*restart|cannot run.*volume is in use/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary
      })
      resolve({
        tool: 'chkdsk',
        success,
        exitCode: code,
        summary,
        log: stdout,
        requiresReboot,
        needsAdmin: false
      })
    })
  })
}

const ADVANCED_REPAIR_COMMANDS: Record<
  AdvancedRepairToolId,
  { executable: string; args: string[]; requiresAdmin: boolean; requiresReboot?: boolean }
> = {
  dismCheckHealth: {
    executable: 'dism.exe',
    args: ['/Online', '/Cleanup-Image', '/CheckHealth'],
    requiresAdmin: true
  },
  dismScanHealth: {
    executable: 'dism.exe',
    args: ['/Online', '/Cleanup-Image', '/ScanHealth'],
    requiresAdmin: true
  },
  netshWinsockReset: {
    executable: 'netsh.exe',
    args: ['winsock', 'reset'],
    requiresAdmin: true,
    requiresReboot: true
  },
  netshTcpReset: {
    executable: 'netsh.exe',
    args: ['int', 'ip', 'reset'],
    requiresAdmin: true,
    requiresReboot: true
  },
  ipconfigFlushDns: {
    executable: 'ipconfig.exe',
    args: ['/flushdns'],
    requiresAdmin: false
  },
  winmgmtVerify: {
    executable: 'winmgmt.exe',
    args: ['/verifyrepository'],
    requiresAdmin: true
  },
  winmgmtSalvage: {
    executable: 'winmgmt.exe',
    args: ['/salvagerepository'],
    requiresAdmin: true
  },
  reagentcInfo: {
    executable: 'reagentc.exe',
    args: ['/info'],
    requiresAdmin: true
  },
  vssListShadows: {
    executable: 'vssadmin.exe',
    args: ['list', 'shadows'],
    requiresAdmin: true
  },
  powercfgEnergy: {
    executable: 'powercfg.exe',
    args: [
      '/energy',
      '/duration',
      '30',
      '/output',
      join(tmpdir(), `atlas-energy-${process.pid}.html`)
    ],
    requiresAdmin: true
  },
  gpupdateForce: {
    executable: 'gpupdate.exe',
    args: ['/force'],
    requiresAdmin: false
  },
  fsutilQueryJournal: {
    executable: 'fsutil.exe',
    args: ['usn', 'queryjournal', 'C:'],
    requiresAdmin: true
  }
}

async function runAdvancedRepairTool(tool: AdvancedRepairToolId): Promise<AdvancedRepairResult> {
  const command = ADVANCED_REPAIR_COMMANDS[tool]
  if (process.platform !== 'win32' || !command) {
    return {
      tool,
      success: false,
      exitCode: null,
      summary: 'This repair command is not available on this system.',
      output: '',
      needsAdmin: false,
      requiresReboot: false
    }
  }
  if (command.requiresAdmin && !isAdmin()) {
    return {
      tool,
      success: false,
      exitCode: null,
      summary: 'Administrator privileges are required for this command.',
      output: '',
      needsAdmin: true,
      requiresReboot: false
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      windowsSystemCommand(command.executable),
      command.args,
      { windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 }
    )
    const outputParts = [stdout, stderr].filter(Boolean)
    if (tool === 'powercfgEnergy') {
      outputParts.push(`Energy report: ${command.args[command.args.length - 1]}`)
    }
    const output = outputParts.join('\n').trim()
    return {
      tool,
      success: true,
      exitCode: 0,
      summary: 'The command completed. Review its output for details.',
      output,
      needsAdmin: false,
      requiresReboot: command.requiresReboot === true
    }
  } catch (error) {
    const result = error as Error & {
      code?: number | string
      stdout?: string | Buffer
      stderr?: string | Buffer
    }
    const output = [result.stdout?.toString(), result.stderr?.toString(), result.message]
      .filter(Boolean)
      .join('\n')
      .slice(-200_000)
    return {
      tool,
      success: false,
      exitCode: typeof result.code === 'number' ? result.code : null,
      summary: 'The command reported an error. Review its output for details.',
      output,
      needsAdmin: false,
      requiresReboot: command.requiresReboot === true
    }
  }
}

// ── IPC registration ──

export function registerDiskAnalyzerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DISK_DRIVES, () => getDrives())

  ipcMain.handle(IPC.DISK_FILE_TYPES, async (_event, drive: string): Promise<FileTypeInfo[]> => {
    const rootPath = resolveRootPath(drive)
    if (!rootPath) return []
    const extMap = new Map<string, { size: number; count: number }>()
    await collectFileTypes(rootPath, 0, extMap, getWindow())
    const results: FileTypeInfo[] = []
    for (const [ext, info] of extMap) {
      results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
    }
    results.sort((a, b) => b.totalSize - a.totalSize)
    return results
  })

  ipcMain.handle(IPC.DISK_ANALYZE, async (_event, drive: string): Promise<DiskNode> => {
    const rootPath = resolveRootPath(drive)
    if (!rootPath) return { name: '', path: '', size: 0, children: [] }
    invalidateDirectoryStatsCache()
    return analyzeDirectory(rootPath, 0, getWindow())
  })

  ipcMain.handle(
    IPC.DISK_ANALYZE_PATH,
    async (_event, drive: unknown, folderPath: unknown): Promise<DiskNode | null> => {
      const safePath = await validatedDiskPath(drive, folderPath, true)
      if (!safePath) return null
      return listDirectoryContents(safePath.target)
    }
  )

  ipcMain.handle(
    IPC.DISK_ANALYZE_PATH_STATS,
    async (_event, drive: unknown, folderPath: unknown): Promise<DiskNode | null> => {
      const safePath = await validatedDiskPath(drive, folderPath, true)
      if (!safePath) return null
      return analyzeDirectoryContentsWithStats(safePath.target)
    }
  )

  ipcMain.handle(
    IPC.DISK_OPEN_PATH,
    async (_event, drive: unknown, targetPath: unknown): Promise<boolean> => {
      const safePath = await validatedDiskPath(drive, targetPath, true)
      if (!safePath) return false
      try {
        const targetStat = await lstat(safePath.target)
        if (targetStat.isDirectory()) {
          const openError = await shell.openPath(safePath.target)
          if (openError) shell.showItemInFolder(safePath.target)
          return true
        }
        if (targetStat.isFile()) {
          shell.showItemInFolder(safePath.target)
          return true
        }
        return false
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.DISK_TRASH_PATH,
    async (_event, drive: unknown, targetPath: unknown): Promise<boolean> => {
      const safePath = await validatedDiskPath(drive, targetPath, false)
      if (!safePath) return false
      try {
        await shell.trashItem(safePath.target)
        invalidateDirectoryStatsCache()
        return true
      } catch {
        return false
      }
    }
  )

  // Disk repair
  ipcMain.handle(IPC.DISK_REPAIR_SFC, async (_event, drive: unknown): Promise<DiskRepairResult> => {
    const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
    return runSfc(safeDrive, getWindow)
  })

  ipcMain.handle(IPC.DISK_REPAIR_DISM, async (): Promise<DiskRepairResult> => {
    return runDism(getWindow)
  })

  ipcMain.handle(
    IPC.DISK_REPAIR_CHKDSK,
    async (_event, drive: unknown): Promise<DiskRepairResult> => {
      const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
      return runChkdsk(safeDrive, getWindow)
    }
  )

  ipcMain.handle(
    IPC.DISK_REPAIR_ADVANCED,
    async (_event, requestedTool: unknown): Promise<AdvancedRepairResult> => {
      if (
        typeof requestedTool !== 'string' ||
        !Object.hasOwn(ADVANCED_REPAIR_COMMANDS, requestedTool)
      ) {
        return {
          tool: 'ipconfigFlushDns',
          success: false,
          exitCode: null,
          summary: 'Unknown repair command.',
          output: '',
          needsAdmin: false,
          requiresReboot: false
        }
      }
      return runAdvancedRepairTool(requestedTool as AdvancedRepairToolId)
    }
  )
}

import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { delimiter, join } from 'path'
import { app } from 'electron'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)
const executableCache = new Map<string, string>()
const getClamAvDataDirectory = () => join(app.getPath('userData'), 'clamav', 'database')
const getFreshClamConfigPath = () => join(app.getPath('userData'), 'clamav', 'freshclam.conf')
const getFreshClamLogPath = () => join(app.getPath('userData'), 'clamav', 'freshclam.log')
const WINDOWS_CLAMAV_DIRS = ['C:\\Program Files\\ClamAV', 'C:\\Program Files (x86)\\ClamAV']

export interface ClamAvInfo {
  available: boolean
  scannerVersion: string | null
  updaterAvailable: boolean
  databaseVersion: string | null
  architectureMismatch: { clamAv: string; atlas: string } | null
}

const PE_ARCHITECTURES: Record<number, string> = {
  0x014c: 'ia32',
  0x8664: 'x64',
  0xaa64: 'arm64'
}

async function getPeArchitecture(executable: string): Promise<string | null> {
  try {
    const contents = await readFile(executable)
    if (contents.length < 64 || contents.toString('ascii', 0, 2) !== 'MZ') return null
    const headerOffset = contents.readUInt32LE(0x3c)
    if (
      headerOffset + 6 > contents.length ||
      contents.toString('ascii', headerOffset, headerOffset + 4) !== 'PE\0\0'
    ) {
      return null
    }
    return PE_ARCHITECTURES[contents.readUInt16LE(headerOffset + 4)] ?? null
  } catch {
    return null
  }
}

async function findArchitectureMismatch(): Promise<{ clamAv: string; atlas: string } | null> {
  if (process.platform !== 'win32') return null
  const candidates = await Promise.all(
    ['clamscan', 'freshclam'].map(async (name) =>
      (await executableCandidates(name)).filter((candidate) => existsSync(candidate))
    )
  )
  for (const candidate of candidates.flat()) {
    const architecture = await getPeArchitecture(candidate)
    if (architecture && architecture !== process.arch) {
      return { clamAv: architecture, atlas: process.arch }
    }
  }
  return null
}

async function windowsInstallDirectories(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const directories = new Set<string>([
    ...WINDOWS_CLAMAV_DIRS,
    'C:\\ClamAV',
    ...(process.env.ProgramFiles ? [join(process.env.ProgramFiles, 'ClamAV')] : []),
    ...(process.env['ProgramFiles(x86)'] ? [join(process.env['ProgramFiles(x86)'], 'ClamAV')] : [])
  ])

  // ClamAV's Windows installer records its configuration and database locations here.
  // Query both registry views because 32-bit and 64-bit installs use different views.
  for (const key of ['HKLM\\SOFTWARE\\ClamAV', 'HKLM\\SOFTWARE\\WOW6432Node\\ClamAV']) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key], {
        timeout: 3_000,
        windowsHide: true
      })
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = line.match(/^\s*(ConfDir|DataDir)\s+REG_\w+\s+(.+?)\s*$/i)
        if (!match) continue
        const value = match[2].replace(/^"|"$/g, '')
        directories.add(value)
        // Some packages put the executables beside the config/database directory;
        // others use a bin subdirectory or keep configuration under conf_examples.
        directories.add(join(value, 'bin'))
        if (/\\(conf(?:_examples)?|database|db)$/i.test(value)) {
          const parent = value.replace(/\\[^\\]+$/, '')
          directories.add(parent)
          directories.add(join(parent, 'bin'))
        }
      }
    } catch {
      // Missing keys are normal for portable and nonstandard installations.
    }
  }
  return [...directories]
}

async function executableCandidates(name: string): Promise<string[]> {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const executable = `${name}${suffix}`
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const installDirectories = await windowsInstallDirectories()
    candidates.push(
      ...installDirectories.flatMap((directory) => [
        join(directory, executable),
        join(directory, 'bin', executable)
      ])
    )
  } else if (process.platform === 'linux') {
    candidates.push(`/usr/bin/${executable}`, `/usr/local/bin/${executable}`)
  } else if (process.platform === 'darwin') {
    candidates.push(`/opt/homebrew/bin/${executable}`, `/usr/local/bin/${executable}`)
  }
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  candidates.push(
    ...pathValue
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory.replace(/^"|"$/g, ''), executable))
  )
  return [...new Set(candidates)]
}

async function findExecutable(name: string): Promise<string | null> {
  const cached = executableCache.get(name)
  if (cached) return cached
  for (const candidate of await executableCandidates(name)) {
    if (!existsSync(candidate)) continue
    const version = await getVersion(candidate)
    if (version && /clamav/i.test(version)) {
      executableCache.set(name, candidate)
      return candidate
    }
  }
  return null
}

async function getVersion(executable: string | null, args: string[] = []): Promise<string | null> {
  if (!executable) return null
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...args, '--version'], {
      timeout: 5_000,
      windowsHide: true
    })
    return `${stdout || stderr}`.trim().split(/\r?\n/, 1)[0] || null
  } catch (error: any) {
    return `${error?.stdout || error?.stderr || ''}`.trim().split(/\r?\n/, 1)[0] || null
  }
}

export async function getClamAvInfo(): Promise<ClamAvInfo> {
  const [scanner, updater] = await Promise.all([
    findExecutable('clamscan'),
    findExecutable('freshclam')
  ])
  const architectureMismatch = scanner && updater ? null : await findArchitectureMismatch()
  const dataDirectory = getClamAvDataDirectory()
  const [scannerVersion, databaseInfo, updaterVersion] = await Promise.all([
    getVersion(scanner),
    getVersion(scanner, ['--database', dataDirectory]),
    getVersion(updater)
  ])
  const databaseMatch = databaseInfo?.match(/\/(\d+)\//)
  return {
    available: scanner !== null && scannerVersion !== null,
    scannerVersion,
    updaterAvailable: updater !== null && updaterVersion !== null,
    databaseVersion: databaseMatch?.[1] ?? null,
    architectureMismatch
  }
}

async function ensureFreshClamConfig(): Promise<string> {
  const dataDirectory = getClamAvDataDirectory()
  const configPath = getFreshClamConfigPath()
  await mkdir(dataDirectory, { recursive: true })
  await writeFile(
    configPath,
    `DatabaseDirectory "${dataDirectory}"\nDatabaseMirror database.clamav.net\nUpdateLogFile "${getFreshClamLogPath()}"\nLogTime yes\n`,
    'utf-8'
  )
  return configPath
}

export async function scanClamAvFiles(
  filePaths: string[],
  onBatch?: (processed: number, total: number, currentPath: string) => void
): Promise<Array<{ filePath: string; threatName: string }>> {
  const scanner = await findExecutable('clamscan')
  if (!scanner || filePaths.length === 0) return []

  const listDirectory = join(app.getPath('temp'), 'atlas-clamav')
  const listPath = join(listDirectory, `scan-${randomUUID()}.txt`)
  const detections: Array<{ filePath: string; threatName: string }> = []
  let processed = 0
  const seen = new Set<string>()

  const handleOutputLine = (rawLine: string) => {
    const line = rawLine.trim()
    const infected = line.match(/^(.*):\s*(.+?)\s+FOUND\s*$/i)
    const clean = infected ? null : line.match(/^(.*):\s*OK\s*$/i)
    const match = infected ?? clean
    if (!match) return

    const filePath = match[1]
    const pathKey = process.platform === 'win32' ? filePath.toLowerCase() : filePath
    if (!seen.has(pathKey)) {
      seen.add(pathKey)
      processed += 1
      onBatch?.(processed, filePaths.length, filePath)
    }

    if (infected && !detections.some((item) => item.filePath === filePath)) {
      detections.push({ filePath, threatName: infected[2] })
    }
  }

  await mkdir(listDirectory, { recursive: true })
  await writeFile(listPath, `${filePaths.join('\n')}\n`, 'utf8')
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        scanner,
        [
          '--database',
          getClamAvDataDirectory(),
          '--no-summary',
          '--verbose',
          `--file-list=${listPath}`
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const stdoutLines = createInterface({ input: child.stdout })
      const stderrLines = createInterface({ input: child.stderr })
      stdoutLines.on('line', handleOutputLine)
      stderrLines.on('line', handleOutputLine)
      child.once('error', reject)
      child.once('close', resolve)
      const timeout = setTimeout(() => child.kill(), 15 * 60_000)
      child.once('close', () => clearTimeout(timeout))
    })

    // ClamAV exits with 1 when it found a detection; 2 indicates a scan error.
    if (exitCode !== 0 && exitCode !== 1) {
      throw new Error(`ClamAV scan failed with exit code ${exitCode ?? 'unknown'}.`)
    }
  } finally {
    await rm(listPath, { force: true }).catch(() => undefined)
  }

  return detections
}

export async function updateClamAvDatabase(): Promise<{ success: boolean; message?: string }> {
  const updater = await findExecutable('freshclam')
  if (!updater) return { success: false, message: 'FreshClam was not found.' }
  try {
    const configPath = await ensureFreshClamConfig()
    await execFileAsync(updater, ['--config-file', configPath, '--quiet'], {
      timeout: 10 * 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    return { success: true }
  } catch (error: any) {
    const message = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`.trim()
    const launchError = [error?.message, error?.code, error?.syscall, error?.path]
      .filter(Boolean)
      .join(' — ')
    return {
      success: false,
      message: message.slice(-4000) || launchError || 'FreshClam failed.'
    }
  }
}

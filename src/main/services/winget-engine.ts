import { spawn } from 'child_process'

// ─── Winget Engine ─────────────────────────────────────────────
// Every call is 100% async (spawn, never execSync) so the renderer's table UI
// never blocks waiting on the terminal — rule #12 from the winget spec.
//
// winget has no stable JSON output for search/list/upgrade (tracked upstream
// as microsoft/winget-cli#2595 / #3051, still open), so we parse its aligned
// text table. The parser below is column-position based, not header-text
// based, so it keeps working regardless of the UI language Windows is set to
// (the Atlas install this ships with defaults to Portuguese).

export interface RunWingetOptions {
  /** Called for every full line winget writes to stdout or stderr. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  timeoutMs?: number
}

export interface RunWingetResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function quoteArg(arg: string): string {
  // cmd.exe-safe quoting. Only wraps in quotes when needed, and escapes
  // embedded quotes the way cmd expects.
  if (arg === '') return '""'
  if (!/[\s"&|<>^%]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

/**
 * Runs `winget <args>` via spawn, routed through cmd.exe with `chcp 65001`
 * first. winget's console output otherwise comes back in the system's OEM
 * codepage, which mangles accented package names (common in pt-PT/pt-BR
 * catalog entries) — the same class of problem exec-utf8.ts already solves
 * for `reg`/`netsh` elsewhere in Atlas, applied here to a streamed spawn
 * instead of a one-shot execFile.
 */
export function runWinget(args: string[], opts: RunWingetOptions = {}): Promise<RunWingetResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({
        exitCode: null,
        stdout: '',
        stderr: 'winget is only available on Windows',
        timedOut: false
      })
      return
    }

    const cmdLine = `chcp 65001>nul && winget ${args.map(quoteArg).join(' ')}`
    // windowsVerbatimArguments is required here: cmdLine already contains
    // cmd.exe-correct quoting (quoteArg above doubles embedded quotes, the
    // way cmd.exe itself expects). Without this flag, Node re-escapes the
    // whole cmdLine string using the MSVCRT/CommandLineToArgvW convention
    // (backslash-escaped quotes) before handing it to CreateProcess — a
    // different, incompatible convention from cmd.exe's own. That mangles
    // any argument that needs quoting (i.e. any query with a space), so a
    // single-word search like "7zip" works while "google chrome" reaches
    // winget as garbage and fails with APPINSTALLER_CLI_ERROR_INVALID_CL_ARGUMENTS
    // (0x8A150002, printed to the user as exit code 2316632066). exec-utf8.ts
    // sets the same flag for the same reason — see runNativeUtf8 there.
    const child = spawn('cmd.exe', ['/d', '/s', '/c', cmdLine], {
      windowsHide: true,
      env: process.env,
      windowsVerbatimArguments: true
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let stdoutTail = ''
    let stderrTail = ''
    let settled = false
    let timedOut = false

    const timeoutMs = opts.timeoutMs ?? 120_000
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    function emitLines(chunk: string, stream: 'stdout' | 'stderr'): void {
      // winget redraws progress bars using \r without a trailing \n — treat a
      // lone \r the same as a line break so the console view still streams.
      const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const combined = (stream === 'stdout' ? stdoutTail : stderrTail) + normalized
      const parts = combined.split('\n')
      if (stream === 'stdout') stdoutTail = parts.pop() ?? ''
      else stderrTail = parts.pop() ?? ''
      for (const line of parts) {
        if (line.trim().length === 0) continue
        opts.onLine?.(line, stream)
      }
    }

    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stdoutBuf += text
      emitLines(text, 'stdout')
    })
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderrBuf += text
      emitLines(text, 'stderr')
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: null, stdout: stdoutBuf, stderr: err.message, timedOut })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (stdoutTail.trim()) opts.onLine?.(stdoutTail, 'stdout')
      if (stderrTail.trim()) opts.onLine?.(stderrTail, 'stderr')
      resolve({ exitCode: code, stdout: stdoutBuf, stderr: stderrBuf, timedOut })
    })
  })
}

let availabilityCache: boolean | null = null

export function resetWingetAvailabilityCache(): void {
  availabilityCache = null
}

export async function isWingetAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (availabilityCache !== null) return availabilityCache
  const { exitCode } = await runWinget(['--version'], { timeoutMs: 8000 })
  availabilityCache = exitCode === 0
  return availabilityCache
}

// ─── Table parsing ──────────────────────────────────────────────

interface ColumnSpan {
  start: number
  end: number // exclusive; Infinity for the last column
}

function findHeaderColumns(headerLine: string): ColumnSpan[] {
  const spans: ColumnSpan[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null

  while ((m = re.exec(headerLine))) {
    spans.push({ start: m.index, end: m.index + m[0].length })
  }
  for (let i = 0; i < spans.length - 1; i++) spans[i].end = spans[i + 1].start
  if (spans.length) spans[spans.length - 1].end = Infinity
  return spans
}

/**
 * Parses one of winget's aligned tables (search / list / upgrade) into rows
 * of raw string values, in column order. Locale-independent: it finds the
 * column boundaries from the header's own spacing rather than matching
 * header text, then reads every data row through those same boundaries.
 * Table always ends at the first blank line or the trailing summary line
 * winget prints ("N upgrades available" / "N pacotes encontrados" / etc).
 */
export function parseWingetTable(stdout: string): string[][] {
  const lines = stdout.split('\n').map((l) => l.replace(/\s+$/, ''))
  const sepIdx = lines.findIndex((l) => /^-{5,}\s*$/.test(l.trim()))
  if (sepIdx <= 0) return []
  const headerLine = lines[sepIdx - 1]
  const cols = findHeaderColumns(headerLine)
  if (cols.length < 2) return []

  const rows: string[][] = []
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line == null || line.trim().length === 0) break
    // Trailing summary / "No packages found" style lines never line up with
    // the header columns — bail out as soon as we hit one instead of trying
    // to parse it as a row.
    if (!/^\s/.test(line) && cols[0].start > 0) break
    const values = cols.map((c, idx) => {
      const end = c.end === Infinity ? line.length : cols[idx + 1] ? cols[idx + 1].start : c.end
      return line.slice(c.start, end).trim()
    })
    if (values.every((v) => v.length === 0)) continue
    rows.push(values)
  }
  return rows
}

/** Name is always first, Id always second, Source always last — regardless
 *  of whether winget also printed a Match/Available column in between. */
export function rowToSearchItem(row: string[]): {
  name: string
  id: string
  version: string
  source: string
} {
  return {
    name: row[0] ?? '',
    id: row[1] ?? '',
    version: row[2] ?? '',
    source: row[row.length - 1] ?? ''
  }
}

export function rowToListOrUpgradeItem(row: string[]): {
  name: string
  id: string
  version: string
  available: string | null
  source: string
} {
  const name = row[0] ?? ''
  const id = row[1] ?? ''
  const version = row[2] ?? ''
  const source = row[row.length - 1] ?? ''
  // 5 columns => Name Id Version Available Source; 4 columns => no Available.
  const available = row.length >= 5 ? (row[3] ?? null) : null
  return { name, id, version, available: available && available.length ? available : null, source }
}

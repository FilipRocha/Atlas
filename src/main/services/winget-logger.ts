import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { shell } from 'electron'
import { getBackupDir } from './backup-dir'
import type { WingetLogEntry } from '../../shared/winget'

// ─── Winget Log (Feature 15) ─────────────────────────────────────
// A flat atlas-winget-logs.txt next to Atlas's existing backup folder — reuses
// the same writable, portable-aware directory the recovery/backup system
// already resolves, instead of inventing a second data path.

const LOG_FILE_NAME = 'atlas-winget-logs.txt'
const MAX_LOG_BYTES = 2 * 1024 * 1024 // rotate before this gets unwieldy to open in Notepad
const MAX_IN_MEMORY_ENTRIES = 500

function logPath(): string {
  const dir = getBackupDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort — a failed mkdir just means the write below will also fail,
    // which logWinget() already treats as non-fatal
  }
  return join(dir, LOG_FILE_NAME)
}

export function getWingetLogPath(): string {
  return logPath()
}

function rotateIfNeeded(path: string): void {
  try {
    const size = statSync(path).size
    if (size > MAX_LOG_BYTES) {
      // Keep the tail, drop the head — cheap, no external deps.
      const content = readFileSync(path, 'utf-8')
      const keep = content.slice(-Math.floor(MAX_LOG_BYTES / 2))
      const cut = keep.indexOf('\n')
      writeFileSync(path, cut >= 0 ? keep.slice(cut + 1) : keep, 'utf-8')
    }
  } catch {
    // no existing file yet, or unreadable — nothing to rotate
  }
}

/** Appends one line. Never throws — a logging failure must not break winget ops. */
export function logWinget(
  op: string,
  message: string,
  level: WingetLogEntry['level'] = 'info'
): void {
  try {
    const path = logPath()
    if (existsSync(path)) rotateIfNeeded(path)
    const entry: WingetLogEntry = { ts: new Date().toISOString(), level, op, message }
    const line = `[${entry.ts}] [${level.toUpperCase()}] [${op}] ${message.replace(/\r?\n/g, ' \\n ')}\n`
    appendFileSync(path, line, 'utf-8')
  } catch {
    // swallow — logging is best-effort diagnostics, not a critical path
  }
}

/** Convenience wrapper: forwards winget stderr lines from the engine straight to the log. */
export function logWingetStderr(op: string, line: string): void {
  logWinget(op, line, 'error')
}

export function readWingetLog(maxEntries = MAX_IN_MEMORY_ENTRIES): WingetLogEntry[] {
  const path = logPath()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const tail = lines.slice(-maxEntries)
    const entries: WingetLogEntry[] = []
    const re = /^\[(.+?)\]\s\[(INFO|ERROR)\]\s\[(.+?)\]\s(.*)$/
    for (const line of tail) {
      const m = re.exec(line)
      if (!m) continue
      entries.push({
        ts: m[1],
        level: m[2].toLowerCase() as WingetLogEntry['level'],
        op: m[3],
        message: m[4]
      })
    }
    return entries
  } catch {
    return []
  }
}

export function clearWingetLog(): void {
  try {
    writeFileSync(logPath(), '', 'utf-8')
  } catch {
    // best-effort
  }
}

export async function revealWingetLog(): Promise<void> {
  const path = logPath()
  if (existsSync(path)) {
    shell.showItemInFolder(path)
  } else {
    await shell.openPath(dirname(path))
  }
}

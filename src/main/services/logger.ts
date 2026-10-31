import { join } from 'path'
import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { app } from 'electron'

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB
const ROTATION_CHECK_INTERVAL_MS = 60_000 // only stat the file every 60s

// Lazy getters — LOG_DIR must not be resolved at import time because
// app.setPath('userData', ...) may run later (e.g. elevated relaunch).
let _logDir: string | null = null
function logDir(): string {
  if (!_logDir) {
    _logDir = join(app.getPath('userData'), 'logs')
    try {
      mkdirSync(_logDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }
  return _logDir
}
function logFile(): string {
  return join(logDir(), 'atlas.log')
}
function logFileOld(): string {
  return join(logDir(), 'atlas.old.log')
}

const lastRotationCheck = new Map<string, number>()

function rotateIfNeeded(file: string, oldFile: string): void {
  const now = Date.now()
  const lastCheck = lastRotationCheck.get(file) ?? 0
  if (now - lastCheck < ROTATION_CHECK_INTERVAL_MS) return

  lastRotationCheck.set(file, now)
  try {
    const stats = statSync(file)
    if (stats.size > MAX_LOG_SIZE) {
      try {
        unlinkSync(oldFile)
      } catch {
        /* ignore */
      }
      renameSync(file, oldFile)
    }
  } catch {
    // File doesn't exist yet, no rotation needed
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

export function logInfo(message: string): void {
  const line = `[${timestamp()}] INFO: ${message}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}

export function logError(message: string, error?: unknown): void {
  const errStr = error instanceof Error ? error.message : String(error ?? '')
  const line = `[${timestamp()}] ERROR: ${message} ${errStr}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}

export function logDebug(message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const line = `[${timestamp()}] DEBUG: ${message}${extra}\n`
  try {
    rotateIfNeeded(logFile(), logFileOld())
    appendFileSync(logFile(), line)
  } catch {
    // Ignore
  }
}

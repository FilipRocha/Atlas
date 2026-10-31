// ─── Winget Manager ────────────────────────────────────────────
// Types shared between main and renderer for the three new winget-powered
// tabs: Global Search, Update Manager and Installed Packages.
//
// Atlas already has an aggregated, multi-manager "Software Updater"
// (UpdateCheckResult / UpdatableApp in shared/types.ts) and a registry-based
// "Program Uninstaller" (InstalledProgram in shared/types.ts). This module is
// intentionally separate: it talks to winget only, exposes the raw
// name/id/version/source shape winget itself reports, and drives its own
// dedicated UI (search-as-you-go, a "technician mode" table, local/online
// icons). Nothing here renames or replaces the existing modules.

export interface WingetSearchItem {
  id: string
  name: string
  version: string
  source: string
}

export interface WingetSearchResult {
  query: string
  items: WingetSearchItem[]
  /** true when winget itself truncated the result set (it caps at 100 rows) */
  truncated: boolean
  durationMs: number
  /** Set when `winget search` exited non-zero — lets the UI tell "no results"
   *  apart from "winget itself failed" instead of showing an empty state either way. */
  error?: string
}

export interface WingetUpgradeItem {
  id: string
  name: string
  currentVersion: string
  availableVersion: string
  source: string
}

export interface WingetUpgradeCheckResult {
  items: WingetUpgradeItem[]
  totalCount: number
  scannedAt: string
}

export type WingetOperation =
  'search' | 'list' | 'upgrade-check' | 'upgrade-one' | 'upgrade-all' | 'install' | 'uninstall'

export type WingetOperationPhase = 'starting' | 'running' | 'done' | 'failed'

/** Streamed main -> renderer while a winget child process is running. */
export interface WingetOperationProgress {
  requestId: string
  op: WingetOperation
  phase: WingetOperationPhase
  /** Index of the package currently being processed (upgrade-all / batch ops) */
  current: number
  total: number
  currentLabel: string
  /** -1 = indeterminate. winget doesn't always report a clean percentage. */
  percent: number
  /** Raw stdout/stderr line, for the technician console view. */
  line?: string
}

export interface WingetUpgradeOneResult {
  id: string
  name: string
  success: boolean
  exitCode: number | null
  error?: string
}

export interface WingetUpgradeAllResult {
  succeeded: number
  failed: number
  errors: { id: string; name: string; reason: string }[]
  durationMs: number
}

export interface WingetInstalledApp {
  id: string
  name: string
  version: string
  /** Present only when winget also detected a newer version is available */
  availableVersion: string | null
  source: string
}

export interface WingetListResult {
  apps: WingetInstalledApp[]
  totalCount: number
  scannedAt: string
  /** Set when `winget list` exited non-zero — same reasoning as WingetSearchResult.error. */
  error?: string
}

export interface WingetUninstallResult {
  success: boolean
  id: string
  name: string
  exitCode: number | null
  error?: string
}

export interface WingetInstallResult {
  success: boolean
  id: string
  name: string
  exitCode: number | null
  error?: string
}

/** Result of a lazy, best-effort local icon lookup for one installed app. */
export interface WingetIconResult {
  id: string
  /** data: URL (PNG) from Electron's app.getFileIcon, or null if none was found */
  dataUrl: string | null
}

export interface WingetLogEntry {
  ts: string
  level: 'info' | 'error'
  op: string
  message: string
}

export interface WingetLogPage {
  entries: WingetLogEntry[]
  logPath: string
}

/** Admin/prereq gate shown at the top of every winget tab. */
export interface WingetPrereqState {
  isAdmin: boolean
  wingetAvailable: boolean
}

export interface WingetBootstrapInstallResult {
  success: boolean
  error?: string
}

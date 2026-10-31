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
} from '../shared/winget'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  PlatformInfo,
  ScanResult,
  CleanResult,
  CleanerBlocker,
  ProgressData,
  DiskRepairProgress,
  DiskRepairResult,
  AdvancedRepairToolId,
  AdvancedRepairResult,
  TrimDriveInfo,
  TrimRunResult,
  TrimProgress,
  RegistryEntry,
  StartupItem,
  StartupBootTrace,
  DiskNode,
  DriveInfo,
  AtlasSettings,
  BloatwareApp,
  ScanHistoryEntry,
  DeletionLogPage,
  DeletionOrigin,
  NetworkItem,
  NetworkCleanResult,
  MalwareScanResult,
  MalwareScanProgress,
  MalwareActionResult,
  MalwareRestoreResult,
  PrivacyShieldState,
  PrivacyApplyResult,
  PrivacyScanProgress,
  SystemTweaksState,
  SystemTweaksApplyResult,
  SystemTweaksScanProgress,
  RestorePointResult,
  DriverScanResult,
  DriverProblemScanResult,
  DriverCleanResult,
  DriverScanProgress,
  DriverUpdateScanResult,
  DriverUpdateIgnoreResult,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  PerfSystemInfo,
  PerfSnapshot,
  PerfOverlayStats,
  PerfProcessList,
  PerfKillResult,
  DiskSmartInfo,
  SensorDriverStatus,
  PawnIoInstallResult,
  UpdateStatus,
  ServiceScanResult,
  ServiceApplyResult,
  ServiceScanProgress,
  FirewallScanResult,
  FirewallApplyResult,
  FirewallScanProgress,
  FirewallAction,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult,
  UninstallScanMode,
  UninstallScanResult,
  UninstallCleanupResult,
  UpdateCheckResult,
  UpdateProgress,
  UpdateRequestItem,
  UpdateResult,
  FileTypeInfo,
  DuplicateScanOptions,
  DuplicateScanResult,
  DuplicateScanProgress,
  DuplicateDeleteMode,
  DuplicateDeleteResult,
  ShredderEntry,
  ShredderProgress,
  ShredderResult,
  LargeFileScanOptions,
  LargeFileScanResult,
  LargeFileScanProgress,
  LargeFileDeleteMode,
  LargeFileDeleteResult,
  EmptyFolderScanOptions,
  EmptyFolderScanResult,
  EmptyFolderScanProgress,
  EmptyFolderDeleteResult,
  GameModeConfig,
  GameModeActivateResult,
  GameModeDeactivateResult,
  GameModeStatus,
  GameModeProgress,
  ContextMenuApplyProgress,
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuScanResult
} from '../shared/types'

const api = {
  storageHistoryList: (
    scopeId?: string,
    offset = 0
  ): Promise<{
    scopes: import('../shared/storage-history').StorageScope[]
    snapshots: import('../shared/storage-history').StorageSnapshotSummary[]
    total: number
    capture: { scopeId: string; startedAt: string } | null
    projection: ReturnType<typeof import('../shared/storage-history').projectStorageCapacity>
  }> => ipcRenderer.invoke(IPC.STORAGE_HISTORY_LIST, scopeId, offset),
  storageHistoryAdd: (): Promise<import('../shared/storage-history').StorageScope | null> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_ADD),
  storageHistoryConfigure: (
    id: string,
    settings: Pick<
      import('../shared/storage-history').StorageScope,
      'daily' | 'growthAlertBytes' | 'freeAlertPercent'
    >
  ): Promise<void> => ipcRenderer.invoke(IPC.STORAGE_HISTORY_CONFIGURE, id, settings),
  storageHistoryCapture: (id: string): Promise<string> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_CAPTURE, id),
  storageHistoryCancel: (): Promise<void> => ipcRenderer.invoke(IPC.STORAGE_HISTORY_CANCEL),
  storageHistoryDelete: (id: string, scope = false): Promise<void> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_DELETE, id, scope),
  storageHistoryCompare: (
    before: string,
    after: string,
    offset = 0
  ): Promise<import('../shared/storage-history').StorageComparison & { total: number }> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_COMPARE, before, after, offset),
  storageHistoryExport: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_EXPORT, id),
  storageHistoryOpen: (id: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IPC.STORAGE_HISTORY_OPEN, id, path),
  recoveryList: (
    offset = 0
  ): Promise<{
    entries: import('../shared/recovery').RecoveryEntry[]
    /** IDs of sealed records on this page that could not be decrypted or validated */
    unreadable: string[]
    total: number
    backups: Array<{ name: string; size: number; modifiedAt: string }>
    gameMode: import('../shared/types').GameModeStatus | null
  }> => ipcRenderer.invoke(IPC.RECOVERY_LIST, offset),
  recoveryRemove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.RECOVERY_REMOVE, id),
  recoveryRestore: (id: string): Promise<import('../shared/recovery').RecoveryEntry> =>
    ipcRenderer.invoke(IPC.RECOVERY_RESTORE, id),
  recoveryOpenBackups: (): Promise<void> => ipcRenderer.invoke(IPC.RECOVERY_OPEN_BACKUPS),
  recoveryExport: (): Promise<boolean> => ipcRenderer.invoke(IPC.RECOVERY_EXPORT),
  recoveryRegistryBackups: (): Promise<import('../shared/recovery').RegistryBackup[]> =>
    ipcRenderer.invoke(IPC.RECOVERY_REGISTRY_BACKUPS),
  recoveryRegistryRestore: (
    name: string
  ): Promise<import('../shared/recovery').RegistryRestoreResult> =>
    ipcRenderer.invoke(IPC.RECOVERY_REGISTRY_RESTORE, name),
  recoveryShowBackup: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RECOVERY_SHOW_BACKUP, name),
  cleanupReceiptDetails: (
    id: string,
    page: number
  ): Promise<{ items: import('../shared/cleanup-receipts').CleanupReceiptItem[]; total: number }> =>
    ipcRenderer.invoke(IPC.RECEIPTS_GET, id, page),
  cleanupReceipts: (): Promise<
    Array<import('../shared/cleanup-receipts').CleanupReceipt & { retryable: number }>
  > => ipcRenderer.invoke(IPC.RECEIPTS_LIST),
  cleanupReceiptRetry: (id: string): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.RECEIPTS_RETRY, id),
  cleanupReceiptExport: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.RECEIPTS_EXPORT, id),
  cleanupReceiptsClear: (): Promise<void> => ipcRenderer.invoke(IPC.RECEIPTS_CLEAR),
  // Platform
  platformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke(IPC.PLATFORM_INFO),

  // Window controls
  windowMinimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
  windowSetChromeTheme: (theme: 'light' | 'dark') =>
    ipcRenderer.send(IPC.WINDOW_SET_CHROME_THEME, theme),
  externalToolOpenSite: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.EXTERNAL_TOOL_OPEN_SITE, id),
  externalToolDownload: (id: string): Promise<{ path: string }> =>
    ipcRenderer.invoke(IPC.EXTERNAL_TOOL_DOWNLOAD, id),

  // System cleaner
  systemScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SYSTEM_SCAN),
  systemClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.SYSTEM_CLEAN, itemIds),

  // Browser cleaner
  browserScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.BROWSER_SCAN),
  browserClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.BROWSER_CLEAN, itemIds),

  // App cleaner
  appScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.APP_SCAN),
  appClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.APP_CLEAN, itemIds),

  // Gaming cleaner
  gamingScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.GAMING_SCAN),
  gamingClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.GAMING_CLEAN, itemIds),

  // Database optimizer
  databaseScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.DATABASE_SCAN),
  databaseClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.DATABASE_CLEAN, itemIds),

  // Uninstall leftovers
  uninstallLeftoversScan: (): Promise<ScanResult[]> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_SCAN),
  uninstallLeftoversClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_CLEAN, itemIds),

  // Recycle bin
  recycleBinScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.RECYCLE_BIN_SCAN),
  recycleBinClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.RECYCLE_BIN_CLEAN),

  // Shortcut cleaner
  shortcutScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SHORTCUT_SCAN),
  shortcutClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.SHORTCUT_CLEAN, itemIds),

  // Cleaner: open location
  cleanerOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLEANER_OPEN_LOCATION, filePath),
  cleanerBlockers: (itemIds: string[]): Promise<CleanerBlocker[]> =>
    ipcRenderer.invoke(IPC.CLEANER_BLOCKERS, itemIds),
  cleanerPrepareClean: (): Promise<boolean> => ipcRenderer.invoke(IPC.CLEANER_PREPARE_CLEAN),

  // Environment cleaner
  environmentScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.ENVIRONMENT_SCAN),
  environmentClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.ENVIRONMENT_CLEAN, itemIds),

  // Privacy traces (opt-in only)
  privacyTracesScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.PRIVACY_TRACES_SCAN),
  privacyTracesClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_TRACES_CLEAN, itemIds),

  // Registry
  registryScan: (): Promise<RegistryEntry[]> => ipcRenderer.invoke(IPC.REGISTRY_SCAN),
  registryFix: (
    entryIds: string[]
  ): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> =>
    ipcRenderer.invoke(IPC.REGISTRY_FIX, entryIds),
  registryScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_SCAN_CANCEL),
  registryFixCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_FIX_CANCEL),
  registrySetTweakIgnored: (signatures: string[], ignored: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.REGISTRY_SET_TWEAK_IGNORED, signatures, ignored),

  // Context Menu Cleaner
  contextMenuScan: (): Promise<ContextMenuScanResult> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN),
  contextMenuScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN_CANCEL),
  contextMenuApply: (requests: ContextMenuApplyRequest[]): Promise<ContextMenuApplyResult> =>
    ipcRenderer.invoke(IPC.CONTEXT_MENU_APPLY, requests),
  onContextMenuApplyProgress: (callback: (data: ContextMenuApplyProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ContextMenuApplyProgress) =>
      callback(data)
    ipcRenderer.on(IPC.CONTEXT_MENU_APPLY_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.CONTEXT_MENU_APPLY_PROGRESS, handler)
    }
  },

  // Debloater
  debloaterScan: (): Promise<BloatwareApp[]> => ipcRenderer.invoke(IPC.DEBLOATER_SCAN),
  debloaterRemove: (packageNames: string[]): Promise<{ removed: number; failed: number }> =>
    ipcRenderer.invoke(IPC.DEBLOATER_REMOVE, packageNames),
  onDebloaterRemoveProgress: (
    callback: (data: {
      current: number
      total: number
      currentApp: string
      status: 'removing' | 'done' | 'failed'
    }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        current: number
        total: number
        currentApp: string
        status: 'removing' | 'done' | 'failed'
      }
    ) => callback(data)
    ipcRenderer.on(IPC.DEBLOATER_REMOVE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DEBLOATER_REMOVE_PROGRESS, handler)
    }
  },

  // Startup manager
  startupList: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC.STARTUP_LIST),
  startupToggle: (
    name: string,
    location: string,
    command: string,
    source: string,
    enabled: boolean
  ): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_TOGGLE, name, location, command, source, enabled),
  startupDelete: (name: string, location: string, source: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_DELETE, name, location, source),
  startupBootTrace: (): Promise<StartupBootTrace> => ipcRenderer.invoke(IPC.STARTUP_BOOT_TRACE),

  // Network cleanup
  networkScan: (): Promise<NetworkItem[]> => ipcRenderer.invoke(IPC.NETWORK_SCAN),
  networkClean: (itemIds: string[]): Promise<NetworkCleanResult> =>
    ipcRenderer.invoke(IPC.NETWORK_CLEAN, itemIds),

  // Disk analyzer
  diskAnalyze: (driveLetter: string): Promise<DiskNode> =>
    ipcRenderer.invoke(IPC.DISK_ANALYZE, driveLetter),
  diskAnalyzePath: (driveLetter: string, folderPath: string): Promise<DiskNode | null> =>
    ipcRenderer.invoke(IPC.DISK_ANALYZE_PATH, driveLetter, folderPath),
  diskAnalyzePathStats: (driveLetter: string, folderPath: string): Promise<DiskNode | null> =>
    ipcRenderer.invoke(IPC.DISK_ANALYZE_PATH_STATS, driveLetter, folderPath),
  diskOpenPath: (driveLetter: string, targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.DISK_OPEN_PATH, driveLetter, targetPath),
  diskTrashPath: (driveLetter: string, targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.DISK_TRASH_PATH, driveLetter, targetPath),
  diskDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IPC.DISK_DRIVES),
  diskFileTypes: (driveLetter: string): Promise<FileTypeInfo[]> =>
    ipcRenderer.invoke(IPC.DISK_FILE_TYPES, driveLetter),

  // Disk repair
  diskRepairSfc: (drive: string): Promise<DiskRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_SFC, drive),
  diskRepairDism: (): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_DISM),
  diskRepairChkdsk: (drive: string): Promise<DiskRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_CHKDSK, drive),
  diskRepairAdvanced: (tool: AdvancedRepairToolId): Promise<AdvancedRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_ADVANCED, tool),
  onDiskRepairProgress: (callback: (data: DiskRepairProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DiskRepairProgress) => callback(data)
    ipcRenderer.on(IPC.DISK_REPAIR_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DISK_REPAIR_PROGRESS, handler)
    }
  },

  // Disk maintenance (SSD TRIM)
  diskTrimList: (): Promise<TrimDriveInfo[]> => ipcRenderer.invoke(IPC.DISK_TRIM_LIST),
  diskTrimRun: (driveIds: string[]): Promise<TrimRunResult[]> =>
    ipcRenderer.invoke(IPC.DISK_TRIM_RUN, driveIds),
  onDiskTrimProgress: (callback: (data: TrimProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TrimProgress) => callback(data)
    ipcRenderer.on(IPC.DISK_TRIM_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DISK_TRIM_PROGRESS, handler)
    }
  },

  // Onboarding
  onboardingGet: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_GET),
  onboardingSet: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_SET, value),

  // Settings
  settingsGet: (): Promise<AtlasSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (settings: Partial<AtlasSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  settingsSelectBackupDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SETTINGS_SELECT_BACKUP_DIR),
  settingsOpenBackupDir: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_BACKUP_DIR),

  // Elevation
  elevationCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.ELEVATION_CHECK),
  elevationRelaunch: (): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_RELAUNCH),

  // System Restore Point
  createRestorePoint: (description: string): Promise<RestorePointResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_CREATE, description),

  // Scheduled scans (legacy)
  scheduleNextScan: (): Promise<string | null> => ipcRenderer.invoke(IPC.SCHEDULE_NEXT_SCAN),
  applyStartup: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_APPLY_STARTUP, enabled),
  applyTray: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_TRAY, enabled),
  onScheduledScanTrigger: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.SCHEDULE_SCAN_TRIGGER, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SCHEDULE_SCAN_TRIGGER, handler)
    }
  },
  notifyScheduledScanComplete: (totalSize: number, itemCount: number) =>
    ipcRenderer.send(IPC.SCHEDULE_SCAN_COMPLETE, totalSize, itemCount),

  // Multi-schedule
  onScheduleRunTrigger: (
    callback: (data: {
      runId: string
      cleanerSubcategories?: import('../shared/types').ScheduleEntry['cleanerSubcategories']
      scheduleId: string
      scheduleName: string
      tasks: string[]
      autoApply: boolean
    }) => void
  ) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(IPC.SCHEDULE_RUN_TRIGGER, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SCHEDULE_RUN_TRIGGER, handler)
    }
  },
  scheduleRuntime: (): Promise<import('../shared/schedule-policy').ScheduleRuntime[]> =>
    ipcRenderer.invoke(IPC.SCHEDULE_RUNTIME),
  scheduleRunNow: (
    id: string
  ): Promise<import('../shared/schedule-policy').ScheduleRuntime | undefined> =>
    ipcRenderer.invoke(IPC.SCHEDULE_RUN_NOW, id),
  scheduleAuthorize: (
    id: string,
    runId: string
  ): Promise<{
    allowed: boolean
    reason: import('../shared/schedule-policy').ScheduleWaitingReason | null
  }> => ipcRenderer.invoke(IPC.SCHEDULE_AUTHORIZE, id, runId),
  scheduleRunAck: (scheduleId: string, runId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SCHEDULE_RUN_ACK, scheduleId, runId),
  scheduleRunComplete: (scheduleId: string, status: string, runId: string) =>
    ipcRenderer.invoke(IPC.SCHEDULE_RUN_COMPLETE, scheduleId, status, runId),

  // Scan history
  historyGet: (): Promise<ScanHistoryEntry[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
  historyAdd: (entry: ScanHistoryEntry): Promise<void> =>
    ipcRenderer.invoke(IPC.HISTORY_ADD, entry),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  onHistoryChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.HISTORY_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.HISTORY_CHANGED, handler)
    }
  },

  // Deletion log — individual paths removed by past cleans
  deletionLogQuery: (query: {
    from?: string
    to?: string
    origin?: DeletionOrigin
    offset?: number
    limit?: number
  }): Promise<DeletionLogPage> => ipcRenderer.invoke(IPC.DELETION_LOG_QUERY, query),
  deletionLogExport: (query: {
    from?: string
    to?: string
    origin?: DeletionOrigin
  }): Promise<string | null> => ipcRenderer.invoke(IPC.DELETION_LOG_EXPORT, query),
  deletionLogReveal: (): Promise<string> => ipcRenderer.invoke(IPC.DELETION_LOG_REVEAL),
  deletionLogClear: (): Promise<void> => ipcRenderer.invoke(IPC.DELETION_LOG_CLEAR),

  // Privacy Shield
  privacyScan: (): Promise<PrivacyShieldState> => ipcRenderer.invoke(IPC.PRIVACY_SCAN),
  privacyApply: (ids: string[]): Promise<PrivacyApplyResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_APPLY, ids),
  privacyRevert: (ids: string[]): Promise<PrivacyApplyResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_REVERT, ids),
  onPrivacyProgress: (callback: (data: PrivacyScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PrivacyScanProgress) => callback(data)
    ipcRenderer.on(IPC.PRIVACY_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.PRIVACY_PROGRESS, handler)
    }
  },

  // System Tweaks
  tweaksScan: (): Promise<SystemTweaksState> => ipcRenderer.invoke(IPC.TWEAKS_SCAN),
  tweaksApply: (ids: string[]): Promise<SystemTweaksApplyResult> =>
    ipcRenderer.invoke(IPC.TWEAKS_APPLY, ids),
  tweaksRevert: (ids: string[]): Promise<SystemTweaksApplyResult> =>
    ipcRenderer.invoke(IPC.TWEAKS_REVERT, ids),
  onTweaksProgress: (callback: (data: SystemTweaksScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SystemTweaksScanProgress) =>
      callback(data)
    ipcRenderer.on(IPC.TWEAKS_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.TWEAKS_PROGRESS, handler)
    }
  },

  // Winget Manager (Search / Update Manager / Installed Packages)
  wingetPrereqs: (): Promise<WingetPrereqState> => ipcRenderer.invoke(IPC.WINGET_PREREQS),
  wingetOpenStore: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINGET_OPEN_STORE),
  wingetInstallAppInstaller: (): Promise<WingetBootstrapInstallResult> =>
    ipcRenderer.invoke(IPC.WINGET_INSTALL_APPINSTALLER),
  wingetSearch: (term: string): Promise<WingetSearchResult> =>
    ipcRenderer.invoke(IPC.WINGET_SEARCH, term),
  wingetListInstalled: (): Promise<WingetListResult> =>
    ipcRenderer.invoke(IPC.WINGET_LIST_INSTALLED),
  wingetGetIcon: (id: string, name: string): Promise<WingetIconResult> =>
    ipcRenderer.invoke(IPC.WINGET_GET_ICON, id, name),
  wingetSelectInstallDir: (title?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.WINGET_SELECT_INSTALL_DIR, title),
  wingetInstall: (id: string, name: string, location?: string): Promise<WingetInstallResult> =>
    ipcRenderer.invoke(IPC.WINGET_INSTALL, id, name, location),
  wingetUninstall: (id: string, name: string): Promise<WingetUninstallResult> =>
    ipcRenderer.invoke(IPC.WINGET_UNINSTALL, id, name),
  wingetUpgradeCheck: (): Promise<WingetUpgradeCheckResult> =>
    ipcRenderer.invoke(IPC.WINGET_UPGRADE_CHECK),
  wingetUpgradeOne: (id: string, name: string): Promise<WingetUpgradeOneResult> =>
    ipcRenderer.invoke(IPC.WINGET_UPGRADE_ONE, id, name),
  wingetUpgradeAll: (): Promise<WingetUpgradeAllResult> =>
    ipcRenderer.invoke(IPC.WINGET_UPGRADE_ALL),
  onWingetOperationProgress: (callback: (data: WingetOperationProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: WingetOperationProgress) =>
      callback(data)
    ipcRenderer.on(IPC.WINGET_OPERATION_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.WINGET_OPERATION_PROGRESS, handler)
    }
  },
  wingetLogGet: (): Promise<WingetLogPage> => ipcRenderer.invoke(IPC.WINGET_LOG_GET),
  wingetLogOpen: (): Promise<void> => ipcRenderer.invoke(IPC.WINGET_LOG_OPEN),
  wingetLogClear: (): Promise<void> => ipcRenderer.invoke(IPC.WINGET_LOG_CLEAR),

  // Malware scanner
  malwareScan: (): Promise<MalwareScanResult> => ipcRenderer.invoke(IPC.MALWARE_SCAN),
  malwareQuarantine: (
    paths: string[],
    meta?: import('../shared/types').QuarantineMeta[]
  ): Promise<MalwareActionResult> => ipcRenderer.invoke(IPC.MALWARE_QUARANTINE, paths, meta),
  malwareDelete: (paths: string[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_DELETE, paths),
  malwareRestore: (quarantinedPath: string, originalPath: string): Promise<MalwareRestoreResult> =>
    ipcRenderer.invoke(IPC.MALWARE_RESTORE, quarantinedPath, originalPath),
  malwareQuarantineList: (): Promise<import('../shared/types').QuarantinedItem[]> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE_LIST),
  malwareIgnore: (
    path: string,
    meta?: import('../shared/types').QuarantineMeta
  ): Promise<import('../shared/types').MalwareAllowlistEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_IGNORE, path, meta),
  malwareAllowlistList: (): Promise<import('../shared/types').MalwareAllowlistEntry[]> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_LIST),
  malwareAllowlistRemove: (sha256: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_REMOVE, sha256),
  onMalwareProgress: (callback: (data: MalwareScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: MalwareScanProgress) => callback(data)
    ipcRenderer.on(IPC.MALWARE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.MALWARE_PROGRESS, handler)
    }
  },
  malwareYaraInfo: (): Promise<import('../shared/types').YaraRulesInfo> =>
    ipcRenderer.invoke(IPC.MALWARE_YARA_INFO),
  malwareYaraUpdate: (): Promise<{
    success: boolean
    error?: string
    stats?: { rulesCount: number; version: string }
  }> => ipcRenderer.invoke(IPC.MALWARE_YARA_UPDATE),
  malwareScanCoverage: (): Promise<import('../shared/types').MalwareScanCoverage> =>
    ipcRenderer.invoke(IPC.MALWARE_SCAN_COVERAGE),
  malwareClamAvInfo: (): Promise<import('../shared/types').ClamAvInfo> =>
    ipcRenderer.invoke(IPC.MALWARE_CLAMAV_INFO),
  malwareClamAvUpdate: (): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke(IPC.MALWARE_CLAMAV_UPDATE),
  onYaraCompileProgress: (callback: (data: { loaded: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { loaded: number; total: number }) =>
      callback(data)
    ipcRenderer.on(IPC.MALWARE_YARA_COMPILE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.MALWARE_YARA_COMPILE_PROGRESS, handler)
    }
  },

  // Driver Manager
  driverScan: (): Promise<DriverScanResult> => ipcRenderer.invoke(IPC.DRIVER_SCAN),
  driverProblemScan: (): Promise<DriverProblemScanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_PROBLEM_SCAN),
  driverClean: (publishedNames: string[]): Promise<DriverCleanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_CLEAN, publishedNames),
  onDriverProgress: (callback: (data: DriverScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DriverScanProgress) => callback(data)
    ipcRenderer.on(IPC.DRIVER_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DRIVER_PROGRESS, handler)
    }
  },

  // Driver Updates
  driverUpdateScan: (): Promise<DriverUpdateScanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_SCAN),
  driverUpdateInstall: (updateIds: string[]): Promise<DriverUpdateInstallResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_INSTALL, updateIds),
  driverUpdateIgnore: (updateId: string, ignored: boolean): Promise<DriverUpdateIgnoreResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_IGNORE, updateId, ignored),
  onDriverUpdateProgress: (callback: (data: DriverUpdateProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DriverUpdateProgress) =>
      callback(data)
    ipcRenderer.on(IPC.DRIVER_UPDATE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DRIVER_UPDATE_PROGRESS, handler)
    }
  },

  // Performance Monitor
  perfQuickStats: (): Promise<import('../shared/types').PerfQuickStats> =>
    ipcRenderer.invoke(IPC.PERF_QUICK_STATS),
  perfGetSystemInfo: (): Promise<PerfSystemInfo> => ipcRenderer.invoke(IPC.PERF_GET_SYSTEM_INFO),
  perfStartMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_MONITORING),
  perfStopMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_MONITORING),
  perfKillProcess: (pid: number): Promise<PerfKillResult> =>
    ipcRenderer.invoke(IPC.PERF_KILL_PROCESS, pid),
  perfGetDiskHealth: (): Promise<DiskSmartInfo[]> => ipcRenderer.invoke(IPC.PERF_DISK_HEALTH),
  perfGetSensorDriverStatus: (): Promise<SensorDriverStatus> =>
    ipcRenderer.invoke(IPC.PERF_SENSOR_DRIVER_STATUS),
  perfInstallPawnIo: (): Promise<PawnIoInstallResult> =>
    ipcRenderer.invoke(IPC.PERF_INSTALL_PAWNIO),
  perfGetOverlayStats: (): Promise<PerfOverlayStats> => ipcRenderer.invoke(IPC.PERF_OVERLAY_STATS),
  perfOpenOverlay: (): Promise<boolean> => ipcRenderer.invoke(IPC.PERF_OVERLAY_OPEN),
  perfOverlaySetAlwaysOnTop: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PERF_OVERLAY_SET_ALWAYS_ON_TOP, enabled),
  perfOverlayGetAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PERF_OVERLAY_GET_ALWAYS_ON_TOP),
  perfOverlaySetSize: (width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PERF_OVERLAY_SET_SIZE, width, height),
  perfOverlayMinimize: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_OVERLAY_MINIMIZE),
  perfOverlayMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_OVERLAY_MAXIMIZE),
  perfOverlayClose: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_OVERLAY_CLOSE),
  perfOverlaySetTopBar: (visible: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PERF_OVERLAY_SET_TOP_BAR, visible),
  perfOverlaySetMetric: (key: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PERF_OVERLAY_SET_METRIC, key, enabled),
  onPerfOverlayCommand: (
    callback: (data: {
      type: 'top-bar' | 'pin' | 'metric'
      visible?: boolean
      enabled?: boolean
      key?: string
    }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        type: 'top-bar' | 'pin' | 'metric'
        visible?: boolean
        enabled?: boolean
        key?: string
      }
    ) => callback(data)
    ipcRenderer.on(IPC.PERF_OVERLAY_COMMAND, handler)
    return () => ipcRenderer.removeListener(IPC.PERF_OVERLAY_COMMAND, handler)
  },
  onPerfSnapshot: (callback: (data: PerfSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PerfSnapshot) => callback(data)
    ipcRenderer.on(IPC.PERF_SNAPSHOT, handler)
    return () => {
      ipcRenderer.removeListener(IPC.PERF_SNAPSHOT, handler)
    }
  },
  onPerfProcessList: (callback: (data: PerfProcessList) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PerfProcessList) => callback(data)
    ipcRenderer.on(IPC.PERF_PROCESS_LIST, handler)
    return () => {
      ipcRenderer.removeListener(IPC.PERF_PROCESS_LIST, handler)
    }
  },

  // Auto-updater
  updaterCheck: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  updaterDownload: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  updaterGetStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATER_GET_STATUS),
  onUpdaterStatus: (callback: (data: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: UpdateStatus) => callback(data)
    ipcRenderer.on(IPC.UPDATER_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.UPDATER_STATUS, handler)
    }
  },

  // Service Manager
  serviceScan: (): Promise<ServiceScanResult> => ipcRenderer.invoke(IPC.SERVICE_SCAN),
  serviceApply: (
    changes: { name: string; targetStartType: string }[],
    force?: boolean
  ): Promise<ServiceApplyResult> => ipcRenderer.invoke(IPC.SERVICE_APPLY, changes, force),
  onServiceProgress: (callback: (data: ServiceScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ServiceScanProgress) => callback(data)
    ipcRenderer.on(IPC.SERVICE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SERVICE_PROGRESS, handler)
    }
  },

  // Firewall Audit (Windows-only)
  firewallScan: (): Promise<FirewallScanResult> => ipcRenderer.invoke(IPC.FIREWALL_SCAN),
  firewallApply: (
    changes: { name: string; action: FirewallAction }[]
  ): Promise<FirewallApplyResult> => ipcRenderer.invoke(IPC.FIREWALL_APPLY, changes),
  onFirewallProgress: (callback: (data: FirewallScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: FirewallScanProgress) =>
      callback(data)
    ipcRenderer.on(IPC.FIREWALL_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.FIREWALL_PROGRESS, handler)
    }
  },

  // Program Uninstaller
  uninstallerList: (): Promise<UninstallerListResult> => ipcRenderer.invoke(IPC.UNINSTALLER_LIST),
  uninstallerUninstall: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_UNINSTALL, programId),
  uninstallerScan: (programId: string, mode: UninstallScanMode): Promise<UninstallScanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_SCAN, programId, mode),
  uninstallerClean: (programId: string, itemIds: string[]): Promise<UninstallCleanupResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_CLEAN, programId, itemIds),
  programGetIcon: (
    displayName: string,
    publisher?: string,
    displayIcon?: string,
    installLocation?: string
  ): Promise<string | null> =>
    ipcRenderer.invoke(
      IPC.PROGRAM_GET_ICON,
      displayName,
      publisher || '',
      displayIcon || '',
      installLocation || ''
    ),
  uninstallerForceRemove: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_FORCE_REMOVE, programId),
  onUninstallerProgress: (callback: (data: UninstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: UninstallProgress) => callback(data)
    ipcRenderer.on(IPC.UNINSTALLER_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.UNINSTALLER_PROGRESS, handler)
    }
  },

  // Software Updater
  softwareUpdateCheck: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_CHECK),
  softwareUpdateRun: (items: UpdateRequestItem[]): Promise<UpdateResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_RUN, items),
  onSoftwareUpdateProgress: (callback: (data: UpdateProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: UpdateProgress) => callback(data)
    ipcRenderer.on(IPC.SOFTWARE_UPDATE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SOFTWARE_UPDATE_PROGRESS, handler)
    }
  },

  // Duplicate Finder
  duplicatesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.DUPLICATES_SELECT_DIR),
  duplicatesScan: (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_SCAN, options),
  duplicatesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.DUPLICATES_CANCEL),
  duplicatesDelete: (paths: string[], mode: DuplicateDeleteMode): Promise<DuplicateDeleteResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_DELETE, paths, mode),
  duplicatesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DUPLICATES_OPEN_LOCATION, filePath),
  onDuplicatesProgress: (callback: (data: DuplicateScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DuplicateScanProgress) =>
      callback(data)
    ipcRenderer.on(IPC.DUPLICATES_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.DUPLICATES_PROGRESS, handler)
    }
  },

  // Large File Finder
  largeFilesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.LARGE_FILES_SELECT_DIR),
  largeFilesScan: (options: LargeFileScanOptions): Promise<LargeFileScanResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_SCAN, options),
  largeFilesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.LARGE_FILES_CANCEL),
  largeFilesDelete: (paths: string[], mode: LargeFileDeleteMode): Promise<LargeFileDeleteResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_DELETE, paths, mode),
  largeFilesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_OPEN_LOCATION, filePath),
  onLargeFilesProgress: (callback: (data: LargeFileScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: LargeFileScanProgress) =>
      callback(data)
    ipcRenderer.on(IPC.LARGE_FILES_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.LARGE_FILES_PROGRESS, handler)
    }
  },

  // Empty Folder Cleaner
  emptyFoldersSelectDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SELECT_DIR),
  emptyFoldersScan: (options: EmptyFolderScanOptions): Promise<EmptyFolderScanResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SCAN, options),
  emptyFoldersCancel: (): Promise<void> => ipcRenderer.invoke(IPC.EMPTY_FOLDERS_CANCEL),
  emptyFoldersDelete: (paths: string[], mode: string): Promise<EmptyFolderDeleteResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_DELETE, paths, mode),
  emptyFoldersOpenLocation: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_OPEN_LOCATION, folderPath),
  onEmptyFoldersProgress: (callback: (data: EmptyFolderScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: EmptyFolderScanProgress) =>
      callback(data)
    ipcRenderer.on(IPC.EMPTY_FOLDERS_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.EMPTY_FOLDERS_PROGRESS, handler)
    }
  },

  // File Shredder
  shredderSelectFiles: (): Promise<ShredderEntry[]> =>
    ipcRenderer.invoke(IPC.SHREDDER_SELECT_FILES),
  shredderSelectFolders: (): Promise<ShredderEntry[]> =>
    ipcRenderer.invoke(IPC.SHREDDER_SELECT_FOLDERS),
  shredderShred: (paths: string[]): Promise<ShredderResult> =>
    ipcRenderer.invoke(IPC.SHREDDER_SHRED, paths),
  shredderCancel: (): Promise<void> => ipcRenderer.invoke(IPC.SHREDDER_CANCEL),
  shredderOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SHREDDER_OPEN_LOCATION, filePath),
  onShredderProgress: (callback: (data: ShredderProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ShredderProgress) => callback(data)
    ipcRenderer.on(IPC.SHREDDER_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SHREDDER_PROGRESS, handler)
    }
  },

  // Progress events
  onScanProgress: (callback: (data: ProgressData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ProgressData) => callback(data)
    ipcRenderer.on(IPC.SCAN_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.SCAN_PROGRESS, handler)
    }
  },
  onRegistryFixProgress: (
    callback: (data: { current: number; total: number; currentEntry: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { current: number; total: number; currentEntry: string }
    ) => callback(data)
    ipcRenderer.on(IPC.REGISTRY_FIX_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.REGISTRY_FIX_PROGRESS, handler)
    }
  },

  // Game Mode
  gameModeActivate: (config: GameModeConfig): Promise<GameModeActivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_ACTIVATE, config),
  gameModeDeactivate: (): Promise<GameModeDeactivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_DEACTIVATE),
  gameModeStatus: (): Promise<GameModeStatus> => ipcRenderer.invoke(IPC.GAME_MODE_STATUS),
  gameModeDiscardPending: (): Promise<{ discarded: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.GAME_MODE_DISCARD_PENDING),
  onGameModeProgress: (callback: (data: GameModeProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: GameModeProgress) => callback(data)
    ipcRenderer.on(IPC.GAME_MODE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.GAME_MODE_PROGRESS, handler)
    }
  },
  onGameModeAutoEvent: (
    callback: (data: { type: 'game-detected' | 'game-exited'; processName: string | null }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { type: 'game-detected' | 'game-exited'; processName: string | null }
    ) => callback(data)
    ipcRenderer.on(IPC.GAME_MODE_AUTO_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IPC.GAME_MODE_AUTO_EVENT, handler)
    }
  }
}

export type AtlasAPI = typeof api

contextBridge.exposeInMainWorld('atlas', api)

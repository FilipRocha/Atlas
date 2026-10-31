import {
  projectStorageCapacity,
  type StorageScope,
  type StorageSnapshotSummary
} from '@shared/storage-history'
import type { RecoveryEntry, RegistryBackup } from '@shared/recovery'

const now = Date.now()
const GB = 1024 ** 3
const scope: StorageScope = {
  id: 'preview-folder',
  name: 'Downloads',
  path: 'C:\\Users\\Preview\\Downloads',
  volumeId: 'preview-disk',
  relativeRoot: 'Downloads',
  daily: false,
  growthAlertBytes: null,
  freeAlertPercent: null,
  lastAttemptAt: null,
  lastAlertAt: null
}
const snapshots: StorageSnapshotSummary[] = [0, 1, 2, 3, 4].map((i) => ({
  version: 1,
  id: 'snapshot-' + i,
  scopeId: scope.id,
  scopeKey: 'preview-downloads',
  createdAt: new Date(now - (4 - i) * 86400000 * 3).toISOString(),
  durationMs: 4800,
  status: 'complete',
  reason: null,
  volumeId: scope.volumeId,
  totalBytes: (24 + i * 2) * GB,
  files: 2300 + i * 200,
  skipped: 0,
  errors: 0,
  volumeSize: 512 * GB,
  volumeFree: (200 - i * 2) * GB,
  metadataBytes: 4096,
  checksum: 'preview'
}))
const entries: RecoveryEntry[] = ['Diagnostic data preference', 'Background service startup'].map(
  (label, i) => ({
    version: 1,
    id: 'recovery-' + i,
    createdAt: new Date(now - i * 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    source: 'privacy',
    label,
    target: { kind: 'registry-dword', key: 'HKCU\\Software\\Preview', name: 'Setting' + i },
    before: 1,
    after: 0,
    status: i === 0 ? 'ready' : 'restored'
  })
)
export const featureReads = (empty: boolean) => ({
  recoveryList: () => ({
    entries: empty ? [] : entries,
    unreadable: [],
    total: empty ? 0 : entries.length,
    backups: [],
    gameMode: null
  }),
  recoveryRegistryBackups: (): RegistryBackup[] =>
    empty
      ? []
      : [
          {
            name: 'registry-backup-targeted-2026-09-20T20-02-42-445Z.reg',
            source: 'registry',
            size: 42338,
            modifiedAt: new Date(now - 86400000).toISOString(),
            keys: [
              'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.jpg\\OpenWithList',
              'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient'
            ],
            keyCount: 2,
            restorable: true,
            requiresAdmin: true
          },
          {
            name: 'registry-backup-context-menu-Directory-2026-09-18T09-12-00-000Z.reg',
            source: 'context-menu',
            size: 18_400_000,
            modifiedAt: new Date(now - 3 * 86400000).toISOString(),
            keys: ['HKEY_CLASSES_ROOT\\Directory\\shellex'],
            keyCount: 1,
            restorable: false,
            blocked: 'full-export',
            requiresAdmin: false
          }
        ],
  storageHistoryList: () => ({
    scopes: empty ? [] : [scope],
    snapshots: empty ? [] : snapshots,
    total: empty ? 0 : snapshots.length,
    capture: null,
    projection: empty ? null : projectStorageCapacity(snapshots)
  }),
  scheduleRuntime: () => []
})

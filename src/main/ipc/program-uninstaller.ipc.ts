import { ipcMain } from 'electron'
import { stat } from 'fs/promises'
import { IPC } from '../../shared/channels'
import {
  getInstalledProgramsFull,
  runUninstaller,
  verifyUninstall,
  deleteRegistryKey,
  scanLeftoversForProgram
} from '../services/program-uninstaller'
import { deletionTouchesExclusions, safeDelete } from '../services/file-utils'
import { getSettings } from '../services/settings-store'
import { cleanDeepUninstall, scanDeepUninstall } from '../services/deep-uninstaller'
import { resolveProgramIcon } from '../services/program-icons'
import type { UninstallScanMode, UninstallResidue } from '../../shared/types'
import type {
  InstalledProgram,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult
} from '../../shared/types'
import type { WindowGetter } from './index'

let cachedPrograms: InstalledProgram[] = []
const pendingScans = new Map<string, UninstallResidue[]>()

export function registerProgramUninstallerIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: UninstallProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.UNINSTALLER_PROGRESS, data)
  }

  ipcMain.handle(IPC.UNINSTALLER_LIST, async (): Promise<UninstallerListResult> => {
    const programs = await getInstalledProgramsFull()
    // Resolve real Windows application icons in small batches so listing 100+
    // installed programs does not spawn a PowerShell process for every row at once.
    for (let i = 0; i < programs.length; i += 8) {
      const batch = programs.slice(i, i + 8)
      await Promise.all(
        batch.map(async (program) => {
          program.iconDataUrl = (await resolveProgramIcon(program)) ?? undefined
        })
      )
    }
    cachedPrograms = programs
    return { programs, totalCount: programs.length }
  })

  ipcMain.handle(
    IPC.UNINSTALLER_UNINSTALL,
    async (_event, programId: string): Promise<UninstallResult> => {
      const program = cachedPrograms.find((p) => p.id === programId)
      if (!program) {
        return {
          success: false,
          programName: 'Unknown',
          exitCode: null,
          error: 'Program not found in cache. Please refresh the list.',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0
        }
      }

      // Phase 1: Run the native uninstaller
      sendProgress({
        phase: 'uninstalling',
        currentProgram: program.displayName,
        progress: 10,
        detail: 'Running native uninstaller...'
      })

      const exitCode = await runUninstaller(program)

      // Phase 2: Verify the uninstall. If the native uninstaller succeeded
      // but left its own uninstall key behind, remove that stale key only
      // when the installation directory is already gone (or no location was
      // registered). This gives the normal uninstall flow Revo-like cleanup
      // without deleting a registry entry for a program that is still present.
      let removed = await verifyUninstall(program.registryKey)
      if (!removed && (exitCode === 0 || exitCode === 3010)) {
        const installPath = program.installLocation
        let installStillExists = false
        if (installPath) {
          try {
            installStillExists = (await stat(installPath)).isDirectory()
          } catch {
            installStillExists = false
          }
        }
        if (!installStillExists) {
          await deleteRegistryKey(program.registryKey)
          removed = await verifyUninstall(program.registryKey)
        }
      }

      if (!removed) {
        // Registry key still exists — program is likely still installed.
        // Exit codes: 0 may mean cancelled, 1602/1603 are MSI cancel/fail,
        // 3010 means success but reboot needed (registry may clear after reboot).
        const rebootPending = exitCode === 3010
        if (!rebootPending) {
          return {
            success: false,
            programName: program.displayName,
            exitCode,
            error:
              'Uninstall may have been cancelled or failed. The program still appears in the registry.',
            leftoversFound: 0,
            leftoversCleaned: 0,
            leftoversSize: 0
          }
        }
      }

      // Phase 3 is intentionally separated from the native uninstall. The
      // renderer now shows a Revo-style review of files/registry leftovers
      // before anything is deleted.
      return {
        success: true,
        programName: program.displayName,
        exitCode,
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0
      }
    }
  )

  ipcMain.handle(
    IPC.PROGRAM_GET_ICON,
    async (
      _event,
      displayName: unknown,
      publisher: unknown,
      displayIcon: unknown,
      installLocation: unknown
    ) => {
      if (typeof displayName !== 'string') throw new Error('Invalid program icon request')
      return await resolveProgramIcon({
        displayName,
        publisher: typeof publisher === 'string' ? publisher : '',
        displayIcon: typeof displayIcon === 'string' ? displayIcon : '',
        installLocation: typeof installLocation === 'string' ? installLocation : ''
      })
    }
  )

  ipcMain.handle(IPC.UNINSTALLER_SCAN, async (_event, programId: unknown, mode: unknown) => {
    if (typeof programId !== 'string' || (mode !== 'simple' && mode !== 'advanced')) {
      throw new Error('Invalid uninstall scan request')
    }
    const program = cachedPrograms.find((p) => p.id === programId)
    if (!program) throw new Error('Program not found in cache. Please refresh the list.')
    const result = await scanDeepUninstall(program, mode as UninstallScanMode)
    pendingScans.set(programId, result.items)
    return result
  })

  ipcMain.handle(IPC.UNINSTALLER_CLEAN, async (_event, programId: unknown, itemIds: unknown) => {
    if (
      typeof programId !== 'string' ||
      !Array.isArray(itemIds) ||
      itemIds.some((id) => typeof id !== 'string')
    ) {
      throw new Error('Invalid uninstall cleanup request')
    }
    const pending = pendingScans.get(programId)
    if (!pending) throw new Error('No uninstall scan is available. Run the scan again.')
    const selected = pending.filter((item) => itemIds.includes(item.id))
    const result = await cleanDeepUninstall(selected)
    pendingScans.delete(programId)
    return result
  })

  ipcMain.handle(
    IPC.UNINSTALLER_FORCE_REMOVE,
    async (_event, programId: string): Promise<UninstallResult> => {
      const program = cachedPrograms.find((p) => p.id === programId)
      if (!program) {
        return {
          success: false,
          programName: 'Unknown',
          exitCode: null,
          error: 'Program not found in cache. Please refresh the list.',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0
        }
      }

      // Phase 1: Delete registry key
      sendProgress({
        phase: 'force-removing',
        currentProgram: program.displayName,
        progress: 10,
        detail: 'Removing registry entry...'
      })

      const deleted = await deleteRegistryKey(program.registryKey)
      if (!deleted) {
        return {
          success: false,
          programName: program.displayName,
          exitCode: null,
          error: 'Failed to delete the registry entry. This may require administrator privileges.',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0
        }
      }

      // Phase 2: Scan for leftovers
      sendProgress({
        phase: 'scanning-leftovers',
        currentProgram: program.displayName,
        progress: 40,
        detail: 'Scanning for leftover files...'
      })

      const leftovers = await scanLeftoversForProgram(program)

      if (leftovers.length === 0) {
        return {
          success: true,
          programName: program.displayName,
          exitCode: null,
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0
        }
      }

      // Phase 3: Clean leftovers
      sendProgress({
        phase: 'cleaning-leftovers',
        currentProgram: program.displayName,
        progress: 70,
        detail: `Cleaning ${leftovers.length} leftover items...`
      })

      let cleaned = 0
      let cleanedSize = 0
      const { exclusions } = getSettings()
      for (const item of leftovers) {
        // Leftovers are removed without a review step, so anything the user
        // excluded — the folder itself or something inside it — is kept.
        if (await deletionTouchesExclusions(item.path, exclusions)) continue
        const result = await safeDelete(item.path)
        if (result.success) {
          cleaned++
          cleanedSize += item.size
        }
      }

      return {
        success: true,
        programName: program.displayName,
        exitCode: null,
        leftoversFound: leftovers.length,
        leftoversCleaned: cleaned,
        leftoversSize: cleanedSize
      }
    }
  )
}

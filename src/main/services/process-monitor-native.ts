import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export interface NativeProcessRow {
  pid: number
  parentPid: number
  name: string
  path: string
  user: string
  started: string
  cpuPercent: number
  memBytes: number
}

interface ProcessMonitorAddon {
  getProcesses(): Promise<unknown>
}

let addon: ProcessMonitorAddon | null = null
let addonLoadAttempted = false
let addonUnavailableReason: string | null = null

function getAddonPath(): string | null {
  const resourcePath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcePath
      ? [
          join(
            resourcePath,
            'app.asar.unpacked',
            'native',
            'process-monitor',
            'build',
            'Release',
            'atlas_process_monitor.node'
          )
        ]
      : []),
    join(
      app.getAppPath(),
      'native',
      'process-monitor',
      'build',
      'Release',
      'atlas_process_monitor.node'
    ),
    join(
      process.cwd(),
      'native',
      'process-monitor',
      'build',
      'Release',
      'atlas_process_monitor.node'
    )
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function loadAddon(): ProcessMonitorAddon | null {
  if (addonLoadAttempted) return addon
  addonLoadAttempted = true

  if (process.platform !== 'win32') {
    addonUnavailableReason = 'o coletor nativo está disponível somente no Windows'
    return null
  }

  const addonPath = getAddonPath()
  if (!addonPath) {
    addonUnavailableReason = 'o addon nativo ainda não foi compilado'
    return null
  }

  try {
    // The stable Node-API binary is loaded only by Electron's main process.
    addon = require(addonPath) as ProcessMonitorAddon
    return addon
  } catch (error) {
    addonUnavailableReason = error instanceof Error ? error.message : String(error)
    return null
  }
}

function normalizeRows(value: unknown): NativeProcessRow[] | null {
  if (!Array.isArray(value)) return null
  const rows: NativeProcessRow[] = []
  for (const row of value as Array<Record<string, unknown>>) {
    const pid = Number(row?.pid)
    const parentPid = Number(row?.parentPid)
    const cpuPercent = Number(row?.cpuPercent)
    const memBytes = Number(row?.memBytes)
    if (
      !Number.isInteger(pid) ||
      pid < 0 ||
      !Number.isFinite(cpuPercent) ||
      !Number.isFinite(memBytes)
    )
      continue
    rows.push({
      pid,
      parentPid: Number.isInteger(parentPid) && parentPid >= 0 ? parentPid : 0,
      name: String(row.name ?? ''),
      path: String(row.path ?? ''),
      user: String(row.user ?? ''),
      started: String(row.started ?? ''),
      cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
      memBytes: Math.max(0, memBytes)
    })
  }
  return rows
}

export async function readNativeProcessSnapshot(): Promise<NativeProcessRow[] | null> {
  const nativeAddon = loadAddon()
  if (!nativeAddon) return null
  try {
    const rows = normalizeRows(await nativeAddon.getProcesses())
    if (rows) return rows
    addonUnavailableReason = 'o addon retornou uma lista inválida'
  } catch (error) {
    addonUnavailableReason = error instanceof Error ? error.message : String(error)
  }
  return null
}

export function getNativeProcessMonitorUnavailableReason(): string | null {
  return addonUnavailableReason
}

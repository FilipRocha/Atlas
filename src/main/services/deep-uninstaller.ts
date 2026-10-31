import { randomUUID } from 'crypto'
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  InstalledProgram,
  UninstallResidue,
  UninstallScanMode,
  UninstallScanResult,
  UninstallCleanupResult
} from '../../shared/types'
import { deletionTouchesExclusions, safeDelete } from './file-utils'
import { getSettings } from './settings-store'
import { deleteRegistryKey, isSafeFolder, scanLeftoversForProgram } from './program-uninstaller'

const execFileAsync = promisify(execFile)

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function meaningfulTokens(program: InstalledProgram): string[] {
  const raw = [
    program.displayName.replace(/\s+\(?\d[\d.\- x]*(?:edition|bit)?\)?$/i, ''),
    program.publisher,
    ...(!isSafeFolder(basename(program.installLocation || ''))
      ? [basename(program.installLocation || '')]
      : [])
  ]
  const tokens = new Set<string>()
  for (const value of raw) {
    const n = normalize(value)
    if (n.length >= 3) tokens.add(n)
    for (const part of value.split(/[\s\-_.()]+/)) {
      const p = normalize(part)
      if (p.length >= 4) tokens.add(p)
    }
  }
  return [...tokens]
}

function matchesKey(key: string, tokens: string[]): boolean {
  const leaf = normalize(key.split('\\').pop() || '')
  if (!leaf || leaf.length < 3) return false
  return tokens.some((t) => t.length >= 4 && (leaf === t || leaf.includes(t) || t.includes(leaf)))
}

async function queryTopLevelKeys(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', root], {
      windowsHide: true,
      timeout: 10000
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^HK(?:LM|CU|CR)\\/i.test(line))
  } catch {
    return []
  }
}

async function registryKeyExists(key: string): Promise<boolean> {
  try {
    await execFileAsync('reg', ['query', key], { windowsHide: true, timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function scanRegistry(
  program: InstalledProgram,
  mode: UninstallScanMode
): Promise<UninstallResidue[]> {
  if (process.platform !== 'win32') return []
  const tokens = meaningfulTokens(program)
  const candidates = new Set<string>()
  if (program.registryKey) candidates.add(program.registryKey)

  const roots = [
    'HKCU\\SOFTWARE',
    'HKLM\\SOFTWARE',
    'HKLM\\SOFTWARE\\WOW6432Node',
    'HKCU\\SOFTWARE\\WOW6432Node'
  ]
  for (const root of roots) {
    for (const key of await queryTopLevelKeys(root)) {
      if (matchesKey(key, tokens)) candidates.add(key)
    }
  }

  // Advanced mode also checks the Windows per-user/per-machine App Paths store.
  if (mode === 'advanced') {
    const appPathRoots = [
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
    ]
    const exeTokens = new Set(tokens)
    for (const value of [program.displayIcon, program.installLocation, program.displayName]) {
      const name = basename(value || '').replace(/\.exe.*$/i, '')
      const n = normalize(name)
      if (n.length >= 4) exeTokens.add(n)
    }
    for (const root of appPathRoots) {
      for (const key of await queryTopLevelKeys(root)) {
        if (matchesKey(key, [...exeTokens])) candidates.add(key)
      }
    }

    // Only direct per-user/per-machine Classes keys matching the app are considered.
    // We deliberately do not recurse through the global shell/CLSID trees.
    for (const root of ['HKCU\\SOFTWARE\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
      for (const key of await queryTopLevelKeys(root)) {
        if (matchesKey(key, tokens)) candidates.add(key)
      }
    }
  }

  const items: UninstallResidue[] = []
  for (const key of candidates) {
    if (!(await registryKeyExists(key))) continue
    // Never allow a broad/shared branch to become a deletion candidate.
    const upper = key.toUpperCase()
    if (
      /\\SOFTWARE\\(MICROSOFT|WINDOWS|CLASSES|POLICIES)(\\|$)/i.test(upper) ||
      /\\CURRENTVERSION(\\|$)/i.test(upper) ||
      upper.endsWith('\\UNINSTALL') ||
      upper.endsWith('\\APP PATHS')
    )
      continue
    items.push({
      id: randomUUID(),
      kind: 'registry',
      path: key,
      size: 0,
      category: 'Registro',
      selected: true,
      confidence: key === program.registryKey ? 'high' : 'medium'
    })
  }
  return items
}

async function scanAppData(
  program: InstalledProgram,
  mode: UninstallScanMode
): Promise<UninstallResidue[]> {
  if (process.platform !== 'win32' || mode !== 'advanced') return []
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.PROGRAMDATA].filter(
    Boolean
  ) as string[]
  const tokens = meaningfulTokens(program)
  const items: UninstallResidue[] = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const name of entries) {
      // Never offer shared AppData roots such as `Programs` for deletion.
      if (isSafeFolder(name)) continue
      const n = normalize(name)
      if (
        n.length < 4 ||
        !tokens.some((t) => t.length >= 4 && (n === t || n.includes(t) || t.includes(n)))
      )
        continue
      const path = join(root, name)
      try {
        const s = await stat(path)
        if (!s.isDirectory()) continue
        const size = await directorySize(path, 2)
        if (size < 1024) continue
        items.push({
          id: randomUUID(),
          kind: 'file',
          path,
          size,
          category: root === process.env.PROGRAMDATA ? 'Dados do sistema' : 'AppData',
          selected: true,
          confidence: 'medium'
        })
      } catch {
        // Skip paths that disappeared or became inaccessible during the scan.
      }
      if (items.length >= 40) return items
    }
  }
  return items
}

async function directorySize(path: string, depth: number): Promise<number> {
  if (depth < 0) return 0
  let total = 0
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) total += await directorySize(child, depth - 1)
      else {
        try {
          total += (await stat(child)).size
        } catch {
          // Ignore entries that became inaccessible while measuring the folder.
        }
      }
    }
  } catch {
    // An unreadable folder contributes no measurable bytes.
  }
  return total
}

export async function scanDeepUninstall(
  program: InstalledProgram,
  mode: UninstallScanMode
): Promise<UninstallScanResult> {
  const fileItems = await scanLeftoversForProgram(program)
  const leftovers: UninstallResidue[] = fileItems.map((item) => ({
    id: item.id,
    kind: 'file',
    path: item.path,
    size: item.size,
    category: item.subcategory || 'Arquivos',
    selected: true,
    confidence: 'high'
  }))
  const [appData, registry] = await Promise.all([
    scanAppData(program, mode),
    scanRegistry(program, mode)
  ])
  const dedup = new Map<string, UninstallResidue>()
  for (const item of [...leftovers, ...appData, ...registry])
    dedup.set(`${item.kind}:${item.path.toLowerCase()}`, item)
  const items = [...dedup.values()]
  return {
    items,
    totalSize: items.reduce((sum, item) => sum + item.size, 0),
    fileCount: items.filter((item) => item.kind === 'file').length,
    registryCount: items.filter((item) => item.kind === 'registry').length
  }
}

export async function cleanDeepUninstall(
  items: UninstallResidue[]
): Promise<UninstallCleanupResult> {
  const { exclusions } = getSettings()
  let cleaned = 0
  let cleanedSize = 0
  const errors: { path: string; reason: string }[] = []
  for (const item of items) {
    if (!item.selected) continue
    try {
      if (item.kind === 'registry') {
        if (await deleteRegistryKey(item.path)) cleaned++
        else
          errors.push({
            path: item.path,
            reason: 'Não foi possível remover a chave. Pode ser necessário confirmar o UAC.'
          })
      } else {
        if (await deletionTouchesExclusions(item.path, exclusions)) {
          errors.push({ path: item.path, reason: 'Protegido pelas exclusões do Atlas.' })
          continue
        }
        const result = await safeDelete(item.path)
        if (result.success) {
          cleaned++
          cleanedSize += item.size
        } else errors.push({ path: item.path, reason: result.reason || 'Falha ao remover.' })
      }
    } catch (error) {
      errors.push({
        path: item.path,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { cleaned, cleanedSize, errors }
}

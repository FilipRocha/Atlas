import { app } from 'electron'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { logWinget } from './winget-logger'

const execFileAsync = promisify(execFile)
const cache = new Map<string, string | null>()
interface RegistryIconEntry {
  name: string
  publisher: string
  icon: string
  installLocation: string
}
let registryCache: RegistryIconEntry[] | null = null

function cleanIconPath(raw: string): string | null {
  let value = raw.trim()
  const quoted = value.match(/^"([^"]+)"/)
  if (quoted) value = quoted[1]
  else {
    const exe = value.match(/^(.+?\.exe)(?:\s|$)/i)
    if (exe) value = exe[1]
  }
  value = value.replace(/,-?\d+$/, '').replace(/^"|"$/g, '')
  if (!value || value.startsWith('%')) return null
  return existsSync(value) ? value : null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

async function loadRegistryIcons(): Promise<RegistryIconEntry[]> {
  if (registryCache) return registryCache
  const script = `
    $ErrorActionPreference='SilentlyContinue'
    $roots=@(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    foreach($r in $roots){
      Get-ItemProperty $r | Where-Object {$_.DisplayName} | ForEach-Object {
        Write-Output (([string]$_.DisplayName)+'\t'+([string]$_.Publisher)+'\t'+([string]$_.DisplayIcon)+'\t'+([string]$_.InstallLocation))
      }
    }
  `
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }
    )
    registryCache = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name = '', publisher = '', icon = '', installLocation = ''] = line.split('\t')
        return {
          name: name.trim(),
          publisher: publisher.trim(),
          icon: icon.trim(),
          installLocation: installLocation.trim()
        }
      })
  } catch (err) {
    logWinget(
      'icons',
      `program icon registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      'error'
    )
    registryCache = []
  }
  return registryCache
}

function rank(entry: RegistryIconEntry, displayName: string, publisher: string): number {
  const target = normalize(displayName)
  const pub = normalize(publisher)
  const name = normalize(entry.name)
  const entryPub = normalize(entry.publisher)
  let score = 0
  if (name === target) score += 100
  else if (name.includes(target) || target.includes(name)) score += 60
  if (pub && entryPub && (entryPub === pub || entryPub.includes(pub) || pub.includes(entryPub)))
    score += 35
  return score
}

async function candidateExecutables(installLocation: string): Promise<string[]> {
  if (!installLocation || !existsSync(installLocation)) return []
  try {
    const entries = await readdir(installLocation, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && /\.exe$/i.test(e.name))
      .slice(0, 8)
      .map((e) => join(installLocation, e.name))
  } catch {
    return []
  }
}

export async function resolveProgramIcon(options: {
  displayName: string
  publisher?: string
  displayIcon?: string
  installLocation?: string
}): Promise<string | null> {
  const key = normalize(
    `${options.displayName}|${options.publisher || ''}|${options.displayIcon || ''}`
  )
  if (cache.has(key)) return cache.get(key) ?? null

  const candidates: string[] = []
  const direct = cleanIconPath(options.displayIcon || '')
  if (direct) candidates.push(direct)

  const entries = await loadRegistryIcons()
  const best = entries
    .map((entry) => ({ entry, score: rank(entry, options.displayName, options.publisher || '') }))
    .filter((x) => x.score >= 60)
    .sort((a, b) => b.score - a.score)[0]?.entry
  if (best) {
    const icon = cleanIconPath(best.icon)
    if (icon) candidates.push(icon)
    if (best.installLocation && existsSync(best.installLocation))
      candidates.push(...(await candidateExecutables(best.installLocation)))
  }
  if (options.installLocation)
    candidates.push(...(await candidateExecutables(options.installLocation)))

  for (const candidate of [...new Set(candidates)]) {
    try {
      const image = await app.getFileIcon(candidate, { size: 'normal' })
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        cache.set(key, dataUrl)
        return dataUrl
      }
    } catch {
      // Try the next candidate when Windows cannot resolve this icon.
    }
  }
  cache.set(key, null)
  return null
}

export function clearProgramIconCache(): void {
  cache.clear()
  registryCache = null
}

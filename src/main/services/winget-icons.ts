import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { logWinget } from './winget-logger'

const execFileAsync = promisify(execFile)

// ─── Local icon resolution (Feature 11) ───────────────────────────
// `winget list` does not report an install path or icon, so there is no
// direct handle to hand `app.getFileIcon`. We cross-reference the same
// Uninstall registry hives Windows' own "Apps & Features" reads (the
// standard source for DisplayIcon/InstallLocation) and match by normalized
// display name. This is best-effort: unmatched or store-only apps fall back
// to the generic icon in the renderer, the same as the search tab's offline
// fallback.

interface RegistryUninstallEntry {
  displayName: string
  displayIcon: string
  installLocation: string
}

let registryCache: RegistryUninstallEntry[] | null = null
let registryCacheAt = 0
const REGISTRY_CACHE_TTL_MS = 60_000
const iconDataUrlCache = new Map<string, string | null>()

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .replace(/\s+\d+(?:[.\-]\d+)*\s*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function loadRegistryUninstallEntries(): Promise<RegistryUninstallEntry[]> {
  const now = Date.now()
  if (registryCache && now - registryCacheAt < REGISTRY_CACHE_TTL_MS) return registryCache

  const hives = [
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  ]
  // One PowerShell call for all three hives, tab-separated so a comma or
  // pipe inside a display name can't break parsing.
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    ${hives.map((h) => `Get-ItemProperty '${h}'`).join('; ')} |
      Where-Object { $_.DisplayName } |
      ForEach-Object { "$($_.DisplayName)\`t$($_.DisplayIcon)\`t$($_.InstallLocation)" }
  `.trim()

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }
    )
    const entries: RegistryUninstallEntry[] = stdout
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        const [displayName = '', displayIcon = '', installLocation = ''] = l.split('\t')
        return {
          displayName: displayName.trim(),
          displayIcon: displayIcon.trim(),
          installLocation: installLocation.trim()
        }
      })
      .filter((e) => e.displayName.length > 0)
    registryCache = entries
    registryCacheAt = now
    return entries
  } catch (err) {
    // Swallowing this silently is why "icons never show" was hard to tell
    // apart from "nothing matched" — log the actual failure (PowerShell
    // missing/blocked, execution-policy error, timeout, etc.) so it shows
    // up in Atlas's own winget log/console instead of just disappearing.
    logWinget(
      'icons',
      `registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      'error'
    )
    registryCache = []
    registryCacheAt = now
    return []
  }
}

function resolveIconPath(entry: RegistryUninstallEntry): string | null {
  // DisplayIcon is often "C:\...\app.exe,0" — strip a trailing ",<index>".
  const raw = entry.displayIcon.replace(/,-?\d+$/, '').replace(/^"|"$/g, '')
  if (raw && existsSync(raw)) return raw
  if (entry.installLocation && existsSync(entry.installLocation)) {
    // No usable DisplayIcon — best-effort: getFileIcon on the install folder
    // itself still returns Explorer's folder icon, which is at least better
    // than nothing for the rare app missing a DisplayIcon value.
    return entry.installLocation
  }
  return null
}

/**
 * Best-effort local icon for one installed (winget-reported) app name.
 * Returns null when no confident registry match was found — the renderer
 * shows the same generic package icon it uses for search results.
 */
export async function resolveLocalIcon(name: string): Promise<string | null> {
  const key = normalizeName(name)
  if (iconDataUrlCache.has(key)) return iconDataUrlCache.get(key) ?? null

  const entries = await loadRegistryUninstallEntries()
  const target = key
  const exact = entries.find((e) => normalizeName(e.displayName) === target)
  const match =
    exact ??
    entries
      .map((entry) => {
        const n = normalizeName(entry.displayName)
        const targetWords = target.split(' ').filter((w) => w.length >= 3)
        const nameWords = new Set(n.split(' ').filter((w) => w.length >= 3))
        const overlap = targetWords.filter((w) => nameWords.has(w)).length
        const contains = n.length > 3 && (n.includes(target) || target.includes(n))
        return { entry, overlap, contains, distance: Math.abs(n.length - target.length) }
      })
      .filter((x) => x.contains || x.overlap > 0)
      .sort(
        (a, b) =>
          Number(b.contains) - Number(a.contains) ||
          b.overlap - a.overlap ||
          a.distance - b.distance
      )[0]?.entry

  if (!match) {
    logWinget('icons', `no registry match for "${name}" (${entries.length} entries scanned)`)
    iconDataUrlCache.set(key, null)
    return null
  }

  let iconPath = resolveIconPath(match)
  if (iconPath && existsSync(iconPath)) {
    try {
      const info = await stat(iconPath)
      if (info.isDirectory()) {
        const executables = (await readdir(iconPath))
          .filter((name) => /\.exe$/i.test(name))
          .slice(0, 8)
        const preferred =
          executables.find((name) =>
            /(^|[-_. ])(app|launcher|gui|client|main)([-_. ]|$)/i.test(name)
          ) || executables[0]
        if (preferred) iconPath = join(iconPath, preferred)
      }
    } catch {
      // Ignore malformed or inaccessible icon paths and try other metadata.
    }
  }
  if (!iconPath) {
    logWinget(
      'icons',
      `matched "${match.displayName}" but no usable icon/install path (icon="${match.displayIcon}", installLocation="${match.installLocation}")`
    )
    iconDataUrlCache.set(key, null)
    return null
  }

  try {
    const image = await app.getFileIcon(iconPath, { size: 'normal' })
    const dataUrl = image && !image.isEmpty() ? image.toDataURL() : null
    if (!dataUrl) logWinget('icons', `getFileIcon returned empty image for "${iconPath}"`)
    iconDataUrlCache.set(key, dataUrl)
    return dataUrl
  } catch (err) {
    logWinget(
      'icons',
      `getFileIcon threw for "${iconPath}": ${err instanceof Error ? err.message : String(err)}`,
      'error'
    )
    iconDataUrlCache.set(key, null)
    return null
  }
}

export function clearWingetIconCache(): void {
  iconDataUrlCache.clear()
  registryCache = null
}

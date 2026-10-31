import { execFile, spawn } from 'child_process'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isAdmin } from './elevation'
import { psUtf8 } from './exec-utf8'

export interface RestorePointResult {
  success: boolean
  error?: string
}

/**
 * Marker the script writes when System Protection is switched off.
 *
 * The failure Checkpoint-Computer raises in that case is localised — on a
 * Russian install it reads "невозможно запустить службу, так как она
 * отключена" — so there is no stable text to match on. Checking
 * `RPSessionInterval` inside the same script and emitting our own marker keeps
 * the detection language-independent without a second PowerShell round trip.
 */
export const PROTECTION_SENTINEL = 'ATLAS_SYSTEM_PROTECTION_DISABLED'

export const PROTECTION_DISABLED_ERROR =
  'System Protection is turned off, so Windows cannot create a restore point. ' +
  'Turn it on under System Properties → System Protection, or run ' +
  'Enable-ComputerRestore -Drive "C:\\" from an elevated PowerShell.'

/** Builds the PowerShell that checks System Protection and then checkpoints. */
export function buildRestorePointScript(description: string): string {
  const safe = description.replace(/'/g, "''")
  return (
    // Escaped: a single "\S" in a double-quoted JS string is just "S", which
    // would silently collapse the path and turn the check into a no-op.
    "$rp = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'" +
    ' -ErrorAction SilentlyContinue).RPSessionInterval; ' +
    `if ($rp -ne $null -and $rp -eq 0) { Write-Error '${PROTECTION_SENTINEL}'; exit 1 }; ` +
    `Checkpoint-Computer -Description '${safe}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop`
  )
}

/** Turns a raw failure into the most actionable message available. */
export function classifyRestorePointError(raw: string): string {
  const msg = raw || 'Unknown error'
  if (msg.includes(PROTECTION_SENTINEL)) return PROTECTION_DISABLED_ERROR
  // Windows throttles restore point creation to one per 24 hours by default.
  if (msg.includes('frequency') || msg.includes('1440')) {
    return 'A restore point was already created within the last 24 hours. Windows limits creation frequency.'
  }
  return msg.slice(0, 500)
}

/**
 * Creates a Windows System Restore point using PowerShell.
 * Requires administrator privileges and System Protection to be enabled on the target drive.
 */
export async function createRestorePoint(description: string): Promise<RestorePointResult> {
  const script = buildRestorePointScript(description)

  if (isAdmin()) {
    return await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
        { timeout: 60_000 },
        (err, _stdout, stderr) => {
          if (err) {
            resolve({ success: false, error: classifyRestorePointError(stderr || err.message) })
            return
          }
          resolve({ success: true })
        }
      )
    })
  }

  // Atlas normally runs unelevated.  When the user explicitly asks for a
  // restore point, elevate only this operation through the normal Windows UAC
  // prompt instead of relaunching Atlas as administrator.
  const dir = await mkdtemp(join(tmpdir(), 'atlas-restore-'))
  const scriptPath = join(dir, 'create-restore-point.ps1')
  const resultPath = join(dir, 'result.txt')
  const childScript = [
    "$ErrorActionPreference = 'Stop'",
    `try { ${script}; Set-Content -LiteralPath '${resultPath.replace(/'/g, "''")}' -Value 'OK' -Encoding UTF8; exit 0 }`,
    `catch { Set-Content -LiteralPath '${resultPath.replace(/'/g, "''")}' -Value $_.Exception.Message -Encoding UTF8; exit 1 }`
  ].join('; ')

  try {
    await writeFile(scriptPath, childScript, 'utf8')
    const args = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`
    const launched = await new Promise<{ code: number | null; error?: Error; stdout: string }>(
      (resolve) => {
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Start-Process powershell.exe -Verb RunAs -ArgumentList '${args.replace(/'/g, "''")}' -Wait -PassThru | Select-Object -ExpandProperty ExitCode`
          ],
          { windowsHide: false }
        )
        let stdout = ''
        child.stdout?.on('data', (chunk) => {
          stdout += String(chunk)
        })
        child.on('error', (error) => resolve({ code: null, error, stdout }))
        child.on('close', (code) => resolve({ code, stdout }))
        setTimeout(
          () =>
            resolve({ code: null, error: new Error('Restore point creation timed out.'), stdout }),
          90_000
        )
      }
    )
    if (launched.error) return { success: false, error: launched.error.message }
    const exitCode = Number.parseInt(
      String(launched.stdout ?? '')
        .trim()
        .split(/\s+/)
        .pop() ?? '',
      10
    )
    let detail = ''
    try {
      detail = (await readFile(resultPath, 'utf8')).trim()
    } catch {
      // The helper may exit before writing its optional detail file.
    }
    if (exitCode === 0 && detail === 'OK') return { success: true }
    if (detail) return { success: false, error: classifyRestorePointError(detail) }
    return {
      success: false,
      error: 'A criação do ponto de restauração foi cancelada ou não pôde ser concluída.'
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

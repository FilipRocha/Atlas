/**
 * Leitura nativa do S.M.A.R.T. no Windows, sem depender de smartctl.
 *
 * - NVMe: IOCTL_STORAGE_QUERY_PROPERTY com a página de log 0x02 (SMART/Health).
 *   Fornece horas de uso, % usado, reserva disponível e temperatura.
 * - SATA: SMART_RCV_DRIVE_DATA (READ ATTRIBUTES). Fornece horas de uso (atributo 9),
 *   setores realocados (5) e vida restante (231/233/177).
 *
 * Normalmente exige que o Atlas rode como administrador. Quando o disco ou o driver não
 * respondem, o disco simplesmente não aparece no resultado (nunca se inventa valor).
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface NativeSmart {
  kind: 'nvme' | 'ata'
  powerOnHours: number | null
  temperature: number | null
  /** NVMe: percentage used (0-100). */
  percentUsed: number | null
  /** SATA: valor normalizado de vida restante (231/233/177), 0-100. */
  lifeLeft: number | null
  reallocatedSectors: number | null
}

export const NATIVE_SMART_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AtlasSmart {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] inBuf, int inSize, byte[] outBuf, int outSize, out int ret, IntPtr ov);

  static SafeFileHandle Open(int n, uint access) {
    return CreateFile(@"\\.\PhysicalDrive" + n, access, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
  }

  public static byte[] Nvme(int n) {
    foreach (uint access in new uint[] { 0xC0000000, 0 }) {
      using (var h = Open(n, access)) {
        if (h.IsInvalid) continue;
        var buf = new byte[8 + 40 + 512];
        BitConverter.GetBytes(50).CopyTo(buf, 0);   // StorageDeviceProtocolSpecificProperty
        BitConverter.GetBytes(0).CopyTo(buf, 4);    // PropertyStandardQuery
        BitConverter.GetBytes(3).CopyTo(buf, 8);    // ProtocolTypeNvme
        BitConverter.GetBytes(2).CopyTo(buf, 12);   // NVMeDataTypeLogPage
        BitConverter.GetBytes(2).CopyTo(buf, 16);   // log page 0x02 = SMART / Health
        BitConverter.GetBytes(0).CopyTo(buf, 20);
        BitConverter.GetBytes(40).CopyTo(buf, 24);  // ProtocolDataOffset
        BitConverter.GetBytes(512).CopyTo(buf, 28); // ProtocolDataLength
        int ret;
        if (!DeviceIoControl(h, 0x2D1400, buf, buf.Length, buf, buf.Length, out ret, IntPtr.Zero)) continue;
        if (ret < 8 + 40 + 512) continue;
        var data = new byte[512];
        Array.Copy(buf, 48, data, 0, 512);
        return data;
      }
    }
    return null;
  }

  public static byte[] Ata(int n) {
    using (var h = Open(n, 0xC0000000)) {
      if (h.IsInvalid) return null;
      var inp = new byte[32];
      BitConverter.GetBytes(512).CopyTo(inp, 0);
      inp[4] = 0xD0;                       // READ ATTRIBUTE VALUES
      inp[5] = 1;
      inp[6] = 1;
      inp[7] = 0x4F;
      inp[8] = 0xC2;
      inp[9] = (byte)(0xA0 | ((n & 1) << 4));
      inp[10] = 0xB0;                      // SMART
      inp[12] = (byte)n;
      var outp = new byte[16 + 512];
      int ret;
      if (!DeviceIoControl(h, 0x7C088, inp, inp.Length, outp, outp.Length, out ret, IntPtr.Zero)) return null;
      if (ret < 16 + 512) return null;
      var data = new byte[512];
      Array.Copy(outp, 16, data, 0, 512);
      return data;
    }
  }
}
'@

$result = @()
for ($n = 0; $n -lt 16; $n++) {
  $b = [AtlasSmart]::Nvme($n)
  if ($b -ne $null) {
    $kelvin = [BitConverter]::ToUInt16($b, 1)
    $hours = [BitConverter]::ToUInt64($b, 128)
    $result += [PSCustomObject]@{
      index = $n; kind = 'nvme'
      powerOnHours = $hours
      temperature = $(if ($kelvin -gt 273) { $kelvin - 273 } else { $null })
      percentUsed = [int]$b[5]
      lifeLeft = $null
      reallocatedSectors = $null
    }
    continue
  }
  $a = [AtlasSmart]::Ata($n)
  if ($a -ne $null) {
    $hours = $null; $life = $null; $realloc = $null; $temp = $null
    for ($i = 0; $i -lt 30; $i++) {
      $o = 2 + 12 * $i
      $id = [int]$a[$o]
      if ($id -eq 0) { continue }
      $val = [int]$a[$o + 3]
      $raw = [BitConverter]::ToUInt32($a, $o + 5)
      switch ($id) {
        9   { $hours = $raw }
        5   { $realloc = $raw }
        231 { if ($val -gt 0 -and $val -le 100) { $life = $val } }
        233 { if ($life -eq $null -and $val -gt 0 -and $val -le 100) { $life = $val } }
        177 { if ($life -eq $null -and $val -gt 0 -and $val -le 100) { $life = $val } }
        194 { $temp = [int]($raw -band 0xFF) }
        190 { if ($temp -eq $null) { $temp = [int]($raw -band 0xFF) } }
      }
    }
    $result += [PSCustomObject]@{
      index = $n; kind = 'ata'
      powerOnHours = $hours; temperature = $temp; percentUsed = $null
      lifeLeft = $life; reallocatedSectors = $realloc
    }
  }
}
ConvertTo-Json -InputObject @($result) -Compress
`

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null
}

/** Converte a saída JSON do script em um mapa índice-do-disco -> dados validados. */
export function parseNativeSmart(stdout: string): Map<string, NativeSmart> {
  const map = new Map<string, NativeSmart>()
  const text = stdout.trim()
  if (!text) return map
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return map
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    if (typeof e.index !== 'number' || (e.kind !== 'nvme' && e.kind !== 'ata')) continue
    map.set(String(e.index), {
      kind: e.kind,
      // 0 horas é improvável em disco já usado: tratado como "sem dado".
      powerOnHours: num(e.powerOnHours, 1, 1_000_000),
      temperature: num(e.temperature, 1, 119),
      percentUsed: num(e.percentUsed, 0, 255),
      lifeLeft: num(e.lifeLeft, 1, 100),
      reallocatedSectors: num(e.reallocatedSectors, 0, 4_294_967_295)
    })
  }
  return map
}

/** Resultado em cache: o SMART muda devagar e o Add-Type custa ~1-2 s. */
let cache: { at: number; data: Map<string, NativeSmart> } | null = null
const CACHE_MS = 2 * 60 * 1000

export async function readNativeSmart(): Promise<Map<string, NativeSmart>> {
  if (process.platform !== 'win32') return new Map()
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  try {
    const encoded = Buffer.from(NATIVE_SMART_SCRIPT, 'utf16le').toString('base64')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 }
    )
    const data = parseNativeSmart(stdout)
    cache = { at: Date.now(), data }
    return data
  } catch {
    // Não guarda falha em cache por muito tempo: tenta de novo na próxima atualização.
    cache = { at: Date.now() - CACHE_MS + 15000, data: new Map() }
    return cache.data
  }
}

// Runs automatically before `npm run dev` (predev). On Windows it makes sure the
// LibreHardwareMonitor collector exists, because CPU/GPU temperatures depend on
// it. Never fails the dev server: it only warns when the collector can't be built.
const { existsSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') process.exit(0)

const root = join(__dirname, '..')
const exe = join(root, 'resources', 'hardware-bridge', 'LibreHardwareMonitorBridge.exe')

if (existsSync(exe)) {
  console.log('[atlas] coletor de sensores encontrado.')
  process.exit(0)
}

console.log('[atlas] coletor de sensores ausente - compilando (necessario para temperaturas)...')
const dotnet = spawnSync('dotnet', ['--version'], { shell: true, encoding: 'utf8' })
if (dotnet.status !== 0) {
  console.warn(
    '[atlas] AVISO: .NET 8 SDK nao encontrado. Instale-o (winget install Microsoft.DotNet.SDK.8) e rode: npm run build:hardware-bridge'
  )
  process.exit(0)
}

const build = spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'scripts', 'build-hardware-bridge.ps1')
  ],
  { stdio: 'inherit' }
)
if (build.status !== 0 || !existsSync(exe)) {
  console.warn(
    '[atlas] AVISO: nao foi possivel compilar o coletor de sensores. Temperaturas ficarao indisponiveis.'
  )
}
process.exit(0)

const { spawnSync } = require('child_process')
const { copyFileSync, cpSync, existsSync, mkdirSync, statSync } = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')
const nativeDir = path.join(root, 'native', 'process-monitor')
const addonPath = path.join(nativeDir, 'build', 'Release', 'atlas_process_monitor.node')
const inputs = [path.join(nativeDir, 'binding.gyp'), path.join(nativeDir, 'process_monitor.cc')]
const required = process.argv.includes('--required')
const force = process.argv.includes('--force')

if (process.platform !== 'win32') {
  console.log('[process-monitor] Coletor nativo ignorado fora do Windows.')
  process.exit(0)
}

if (!force && existsSync(addonPath)) {
  const addonTime = statSync(addonPath).mtimeMs
  const inputsAreCurrent = inputs.every(
    (file) => existsSync(file) && statSync(file).mtimeMs <= addonTime
  )
  if (inputsAreCurrent) {
    console.log('[process-monitor] Addon nativo já está atualizado.')
    process.exit(0)
  }
}

let nodeGypCli
try {
  nodeGypCli = require.resolve('node-gyp/bin/node-gyp.js', { paths: [root] })
} catch (error) {
  const message = `node-gyp não está disponível: ${error instanceof Error ? error.message : String(error)}`
  if (required) {
    console.error(`[process-monitor] ${message}`)
    process.exit(1)
  }
  console.warn(`[process-monitor] ${message}. A lista usará o coletor alternativo.`)
  process.exit(0)
}

console.log('[process-monitor] Compilando o addon nativo do Windows...')
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version
const electronHeaders = path.join(os.homedir(), '.electron-gyp', electronVersion)
const localElectronHeaders = path.join(
  root,
  'node_modules',
  '.cache',
  'atlas-electron-headers',
  electronVersion
)
const args = [nodeGypCli, 'rebuild', '--directory', nativeDir]
if (existsSync(path.join(electronHeaders, 'include', 'node', 'node_api.h'))) {
  const electronLib = path.join(electronHeaders, 'x64', 'node.lib')
  if (existsSync(electronLib)) {
    mkdirSync(localElectronHeaders, { recursive: true })
    const localInclude = path.join(localElectronHeaders, 'include')
    if (!existsSync(localInclude))
      cpSync(path.join(electronHeaders, 'include'), localInclude, { recursive: true })
    const releaseDir = path.join(localElectronHeaders, 'Release')
    mkdirSync(releaseDir, { recursive: true })
    const localLib = path.join(releaseDir, 'node.lib')
    if (!existsSync(localLib) || statSync(electronLib).mtimeMs > statSync(localLib).mtimeMs) {
      copyFileSync(electronLib, localLib)
    }
    args.push('--nodedir', localElectronHeaders)
    console.log(`[process-monitor] Usando cabeçalhos locais do Electron ${electronVersion}.`)
  }
}
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
})

if (result.status === 0 && existsSync(addonPath)) {
  console.log('[process-monitor] Addon nativo compilado.')
  process.exit(0)
}

const reason =
  result.error?.message || `node-gyp terminou com o código ${result.status ?? 'desconhecido'}`
if (required) {
  console.error(`[process-monitor] Falha ao compilar o addon nativo: ${reason}`)
  process.exit(result.status && result.status > 0 ? result.status : 1)
}
console.warn(`[process-monitor] ${reason}. O desenvolvimento continuará com systeminformation.`)

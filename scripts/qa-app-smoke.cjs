#!/usr/bin/env node
'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const net = require('node:net')
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const BUILD_TIMEOUT_MS = 5 * 60_000
const STARTUP_TIMEOUT_MS = 120_000
const DRIVER_MANAGER_SCAN_TIMEOUT_MS = 150_000
const DEFAULT_OBSERVE_MS = 5_000
const LOG_POLL_MS = 200
const PLATFORM_FEATURE_KEYS = [
  'registry',
  'debloater',
  'drivers',
  'restorePoint',
  'bootTrace',
  'gameMode',
  'firewallAudit',
  'contextMenu'
]
const APP_ROUTES = [
  '/',
  '/cleaner',
  '/registry',
  '/context-menu',
  '/startup',
  '/storage-history',
  '/disk',
  '/duplicates',
  '/large-files',
  '/empty-folders',
  '/file-shredder',
  '/disk-repair',
  '/disk-maintenance',
  '/network',
  '/malware',
  '/game-mode',
  '/performance',
  '/uninstaller',
  '/history',
  '/recovery',
  '/settings',
  '/privacy',
  '/tweaks',
  '/winget-search',
  '/services',
  '/firewall',
  '/debloater',
  '/updates',
  '/schedules',
  '/drivers'
]
const NAV_PARENT_BY_ROUTE = {
  '/cleaner': '/cleaner',
  '/registry': '/cleaner',
  '/startup': '/cleaner',
  '/storage-history': '/disk',
  '/disk': '/disk',
  '/duplicates': '/disk',
  '/large-files': '/disk',
  '/empty-folders': '/disk',
  '/file-shredder': '/disk',
  '/disk-repair': '/disk',
  '/disk-maintenance': '/disk',
  '/network': '/cleaner',
  '/context-menu': '/software',
  '/malware': '/malware',
  '/game-mode': '/performance',
  '/performance': '/performance',
  '/uninstaller': '/software',
  '/history': '/history',
  '/recovery': '/history',
  '/settings': '/settings',
  '/privacy': '/malware',
  '/tweaks': '/performance',
  '/winget-search': '/software',
  '/services': '/performance',
  '/firewall': '/malware',
  '/debloater': '/software',
  '/updates': '/software',
  '/schedules': '/cleaner',
  '/drivers': '/software'
}
const READ_ONLY_IPC_CHECKS = [
  { id: 'settingsGet', expression: 'window.atlas.settingsGet()', shape: 'object', timeoutMs: 5000 },
  {
    id: 'startupList',
    expression: 'window.atlas.startupList()',
    shape: 'array',
    timeoutMs: 20_000
  },
  {
    id: 'diskTrimList',
    expression: 'window.atlas.diskTrimList()',
    shape: 'array',
    timeoutMs: 30_000
  },
  {
    id: 'recoveryList',
    expression: 'window.atlas.recoveryList(0)',
    shape: 'recovery',
    timeoutMs: 10_000
  },
  {
    id: 'cleanupReceipts',
    expression: 'window.atlas.cleanupReceipts()',
    shape: 'array',
    timeoutMs: 10_000
  },
  {
    id: 'storageHistoryList',
    expression: 'window.atlas.storageHistoryList(undefined, 0)',
    shape: 'storageHistory',
    timeoutMs: 15_000
  }
]

function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    reportDir: path.join(process.cwd(), 'qa-reports'),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    observeMs: DEFAULT_OBSERVE_MS
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--help') {
      options.help = true
      continue
    }
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--project-dir') options.projectDir = path.resolve(value)
    else if (flag === '--report-dir') options.reportDir = path.resolve(value)
    else if (flag === '--startup-timeout-ms') options.startupTimeoutMs = Number(value)
    else if (flag === '--observe-ms') options.observeMs = Number(value)
    else throw new Error(`Unknown option: ${flag}`)
    i++
  }
  for (const key of ['startupTimeoutMs', 'observeMs']) {
    if (!Number.isInteger(options[key]) || options[key] < 1000 || options[key] > 10 * 60_000) {
      throw new Error(`${key} must be between 1000 and 600000 milliseconds`)
    }
  }
  return options
}

function tail(current, chunk) {
  return (current + chunk.toString()).slice(-32_000)
}

function terminateTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    if (result.error) child.kill('SIGTERM')
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function runBuild(projectDir) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString()
    const cli = path.join(projectDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
    const child = spawn(process.execPath, [cli, 'build'], {
      cwd: projectDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => (stdout = tail(stdout, chunk)))
    child.stderr.on('data', (chunk) => (stderr = tail(stderr, chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      terminateTree(child)
    }, BUILD_TIMEOUT_MS)
    const finish = (status, details) => {
      clearTimeout(timer)
      resolve({
        status,
        details,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr
      })
    }
    child.once('error', (error) => finish('CRASH', error.message))
    child.once('close', (code, signal) => {
      if (timedOut) finish('HANG', `Build exceeded ${BUILD_TIMEOUT_MS} ms.`)
      else if (code === 0) finish('PASS', 'Build completed successfully.')
      else finish('FAIL', `Build exited with code ${code}${signal ? ` (${signal})` : ''}.`)
    })
  })
}

async function readTail(file) {
  try {
    return (await readFile(file, 'utf8')).slice(-64_000)
  } catch {
    return ''
  }
}

function validatePlatformInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    throw new Error('platformInfo did not return an object.')
  }
  if (typeof info.isPortable !== 'boolean') {
    throw new Error('platformInfo.isPortable must be a boolean.')
  }
  if (!['win32', 'darwin', 'linux'].includes(info.platform)) {
    throw new Error('platformInfo.platform returned an unsupported value.')
  }
  if (!info.features || typeof info.features !== 'object' || Array.isArray(info.features)) {
    throw new Error('platformInfo.features must be an object.')
  }
  if (
    !PLATFORM_FEATURE_KEYS.every((key) => typeof info.features[key] === 'boolean') ||
    Object.keys(info.features).length !== PLATFORM_FEATURE_KEYS.length
  ) {
    throw new Error('platformInfo.features must contain the expected boolean capability flags.')
  }
  return { platform: info.platform, featureCount: Object.keys(info.features).length }
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

async function findPageTarget(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000)
      })
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // The local debugging endpoint can appear shortly after Electron starts.
    }
    await wait(LOG_POLL_MS)
  }
  throw new Error('Could not find the Atlas renderer debugging target.')
}

async function evaluateInPage(webSocketUrl, expression, timeoutMs = 10_000) {
  const socket = new WebSocket(webSocketUrl)
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Renderer IPC call timed out.')), timeoutMs)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        )
      })
      socket.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.id !== 1) return
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message || 'DevTools request failed.'))
        else if (message.result?.exceptionDetails) {
          const details = message.result.exceptionDetails
          const description =
            details.exception?.description || details.text || 'Unknown renderer exception.'
          reject(new Error(`Renderer evaluation failed: ${description}`))
        } else resolve(message.result?.result?.value)
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Could not connect to the local renderer debugging endpoint.'))
      })
    })
    return result
  } finally {
    socket.close()
  }
}

async function checkPlatformInfo(port) {
  const page = await findPageTarget(port)
  const result = await evaluateInPage(page.webSocketDebuggerUrl, 'window.atlas.platformInfo()')
  return validatePlatformInfo(result)
}

async function runOnboardingFlow(port, timeoutMs, checkHealth) {
  const stepSelectors = ['language', 'welcome', 'settings', 'finish']
  const actions = ['language-next', 'welcome-next', 'settings-next']
  const waitForSelector = async (selector, label) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await checkHealth()
      const page = await findPageTarget(port, Math.min(timeoutMs, 2000))
      const found = await evaluateInPage(
        page.webSocketDebuggerUrl,
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        3000
      )
      if (found) return page
      await wait(150)
    }
    throw new Error(`Onboarding did not reach ${label} within ${timeoutMs} ms.`)
  }

  for (let index = 0; index < stepSelectors.length; index++) {
    const step = stepSelectors[index]
    const page = await waitForSelector(`[data-qa-step="${step}"]`, step)
    if (index < actions.length) {
      if (step === 'settings') {
        // Keep the smoke run isolated from machine startup, tray, and schedule changes.
        await evaluateInPage(
          page.webSocketDebuggerUrl,
          `Array.from(document.querySelectorAll('[data-qa-setting]')).forEach(row => { const toggle = row.querySelector('[data-qa="onboarding-setting-toggle"]'); if (toggle && toggle.style.background !== 'var(--bg-active)') toggle.click() })`
        )
      }
      const action = actions[index]
      const clicked = await evaluateInPage(
        page.webSocketDebuggerUrl,
        `(() => { const button = document.querySelector('[data-qa-action="${action}"]'); if (!button) return false; button.click(); return true })()`
      )
      if (!clicked) throw new Error(`Could not click the onboarding action "${action}".`)
    }
  }

  const finishPage = await findPageTarget(port)
  const clickedFinish = await evaluateInPage(
    finishPage.webSocketDebuggerUrl,
    `(() => { const button = document.querySelector('[data-qa-action="finish-start"]'); if (!button) return false; button.click(); return true })()`
  )
  if (!clickedFinish) throw new Error('Could not click the onboarding finish action.')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await checkHealth()
    const page = await findPageTarget(port, Math.min(timeoutMs, 2000))
    const completed = await evaluateInPage(
      page.webSocketDebuggerUrl,
      `(!document.querySelector('[data-qa="onboarding"]') && Boolean(document.querySelector('[data-qa="app-shell"]')) ? window.atlas.onboardingGet().then(done => done === true) : false)`
    )
    if (completed) return
    await wait(200)
  }
  throw new Error(
    'Finish action did not close onboarding, persist completion, and show the app dashboard in time.'
  )
}

async function runPageRouteChecks(port, timeoutMs, checkHealth) {
  const routeTimeoutMs = Math.min(timeoutMs, 10_000)
  const checks = []
  for (const route of APP_ROUTES) {
    await checkHealth()
    const page = await findPageTarget(port, Math.min(routeTimeoutMs, 2000))
    const parentPath = route === '/' ? '/' : NAV_PARENT_BY_ROUTE[route]
    if (!parentPath) {
      checks.push({
        id: `route:${route}`,
        status: 'FAIL',
        details: 'No sidebar navigation mapping exists for this route.'
      })
      continue
    }
    const parentSelector = `[data-qa-nav-path="${parentPath}"]`
    const childSelector = `[data-qa-nav-child="${route}"]`
    const parentOpened = await evaluateInPage(
      page.webSocketDebuggerUrl,
      `(() => { const button = document.querySelector(${JSON.stringify(parentSelector)}); if (!button) return false; const expanded = button.getAttribute('aria-expanded'); if (expanded === 'false') button.click(); return true })()`
    )
    if (!parentOpened) {
      checks.push({
        id: `route:${route}`,
        status: 'FAIL',
        details: `Sidebar item ${parentPath} was not found.`
      })
      continue
    }
    if (route !== '/') {
      const menuDeadline = Date.now() + routeTimeoutMs
      let childClicked = false
      while (Date.now() < menuDeadline) {
        await checkHealth()
        const currentPage = await findPageTarget(port, Math.min(routeTimeoutMs, 2000))
        childClicked = await evaluateInPage(
          currentPage.webSocketDebuggerUrl,
          `(() => { const button = document.querySelector(${JSON.stringify(childSelector)}); if (!button) return false; button.click(); return true })()`,
          3000
        )
        if (childClicked) break
        await wait(100)
      }
      if (!childClicked) {
        checks.push({
          id: `route:${route}`,
          status: 'FAIL',
          details: `Sidebar submenu item ${route} did not appear.`
        })
        continue
      }
    }
    const deadline = Date.now() + routeTimeoutMs
    let passed = false
    let redirected = false
    while (Date.now() < deadline) {
      await checkHealth()
      const currentPage = await findPageTarget(port, Math.min(routeTimeoutMs, 2000))
      const state = await evaluateInPage(
        currentPage.webSocketDebuggerUrl,
        `(() => { const main = document.querySelector('#main-content'); return { hash: window.location.hash, route: main?.getAttribute('data-route') ?? null, rendered: Boolean(main?.childElementCount && main.innerText.trim()) } })()`,
        3000
      )
      if (state?.hash === `#${route}` && state?.route === route && state?.rendered) {
        passed = true
        break
      }
      if (state?.hash === '#/' && route !== '/') {
        redirected = true
        break
      }
      await wait(120)
    }
    checks.push({
      id: `route:${route}`,
      status: passed ? 'PASS' : redirected ? 'FAIL' : 'HANG',
      details: passed
        ? `Route ${route} opened by clicking its sidebar tab.`
        : redirected
          ? `Route ${route} redirected to the dashboard.`
          : `Route ${route} did not finish loading within ${routeTimeoutMs} ms.`
    })
  }
  return checks
}

function validateReadOnlyResult(shape, result) {
  if (shape === 'array') return Array.isArray(result)
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  if (shape === 'driverScan') {
    return (
      Array.isArray(result.packages) &&
      Number.isFinite(result.totalStaleSize) &&
      Number.isFinite(result.totalStaleCount) &&
      Number.isFinite(result.totalCurrentCount)
    )
  }
  if (shape === 'driverUpdateScan') {
    return (
      Array.isArray(result.updates) &&
      Array.isArray(result.ignoredUpdates) &&
      Number.isFinite(result.totalAvailable) &&
      Number.isFinite(result.scanDuration) &&
      typeof result.updatesDisabled === 'boolean'
    )
  }
  if (shape === 'recovery') {
    return (
      Array.isArray(result.entries) &&
      Array.isArray(result.unreadable) &&
      Array.isArray(result.backups) &&
      Number.isFinite(result.total)
    )
  }
  if (shape === 'storageHistory') {
    return (
      Array.isArray(result.scopes) &&
      Array.isArray(result.snapshots) &&
      Number.isFinite(result.total) &&
      (result.projection === null ||
        (typeof result.projection === 'object' && !Array.isArray(result.projection)))
    )
  }
  return shape === 'object'
}

async function runReadOnlyIpcChecks(port, checkHealth) {
  const checks = []
  for (const [index, check] of READ_ONLY_IPC_CHECKS.entries()) {
    try {
      await checkHealth()
      const page = await findPageTarget(port, 2000)
      const result =
        check.timeoutMs > 30_000
          ? await evaluateAsyncInPage(
              page.webSocketDebuggerUrl,
              check.expression,
              check.timeoutMs,
              checkHealth
            )
          : await evaluateInPage(page.webSocketDebuggerUrl, check.expression, check.timeoutMs)
      const valid = validateReadOnlyResult(check.shape, result)
      checks.push({
        id: `ipc:${check.id}`,
        status: valid ? 'PASS' : 'FAIL',
        details: valid
          ? `${check.id} returned the expected ${check.shape} response.`
          : `${check.id} returned an unexpected response shape.`
      })
    } catch (error) {
      const isTimeout =
        /timed out|could not find the atlas renderer|unresponsive|within .* ms|did not finish/i.test(
          error.message
        )
      const isCrash = /process exited/i.test(error.message)
      const status = isCrash ? 'CRASH' : isTimeout ? 'HANG' : 'FAIL'
      checks.push({
        id: `ipc:${check.id}`,
        status,
        details: error.message
      })
      if (status === 'HANG' || status === 'CRASH') {
        for (const skipped of READ_ONLY_IPC_CHECKS.slice(index + 1)) {
          checks.push({
            id: `ipc:${skipped.id}`,
            status: 'SKIP',
            details: 'Not run because an earlier read-only check hung or crashed.'
          })
        }
        break
      }
    }
  }
  return checks
}

async function runDriverManagerUiScan(port, checkHealth) {
  const timeout = DRIVER_MANAGER_SCAN_TIMEOUT_MS
  const waitUntilEnabledDeadline = Date.now() + timeout
  let buttonState = null
  while (Date.now() < waitUntilEnabledDeadline) {
    await checkHealth()
    const page = await findPageTarget(port, 2000)
    buttonState = await evaluateInPage(
      page.webSocketDebuggerUrl,
      `(() => { const button = document.querySelector('[data-qa-action="driver-manager-scan"]'); const page = document.querySelector('[data-qa-driver-scan-state]'); return { buttonFound: Boolean(button), disabled: button?.disabled ?? null, scanState: page?.getAttribute('data-qa-driver-scan-state') ?? null } })()`,
      5000
    )
    if (!buttonState?.buttonFound || buttonState.scanState === null) {
      throw new Error(
        `Driver Manager UI is missing its scan controls (buttonFound=${buttonState?.buttonFound}, scanState=${buttonState?.scanState}).`
      )
    }
    if (!buttonState.disabled) break
    await wait(300)
  }
  if (buttonState?.disabled) {
    throw new Error(
      `Driver Manager scan button did not become enabled within ${timeout} ms (scanState=${buttonState.scanState}); a background operation may still be active.`
    )
  }

  const page = await findPageTarget(port, 2000)
  const clicked = await evaluateInPage(
    page.webSocketDebuggerUrl,
    `(() => { const button = document.querySelector('[data-qa-action="driver-manager-scan"]'); if (!button || button.disabled) return false; button.click(); return true })()`
  )
  if (!clicked)
    throw new Error('Driver Manager scan button became unavailable before it could be clicked.')

  const deadline = Date.now() + timeout
  let observedScanning = false
  while (Date.now() < deadline) {
    await checkHealth()
    const currentPage = await findPageTarget(port, 2000)
    const state = await evaluateInPage(
      currentPage.webSocketDebuggerUrl,
      `document.querySelector('[data-qa-driver-scan-state]')?.getAttribute('data-qa-driver-scan-state') ?? null`,
      5000
    )
    if (state === 'scanning') observedScanning = true
    if (state === 'complete' && observedScanning) {
      return {
        id: 'driver-manager-ui-scan',
        status: 'PASS',
        details:
          'Scan button started both driver checks, showed scanning state, and returned to completed state.'
      }
    }
    if (state === null) throw new Error('Driver Manager scan state marker disappeared.')
    await wait(250)
  }
  throw new Error(`Driver Manager scan did not complete within ${timeout} ms.`)
}

async function evaluateAsyncInPage(webSocketUrl, expression, timeoutMs, checkHealth) {
  const callId = randomUUID()
  const key = JSON.stringify(callId)
  const started = await evaluateInPage(
    webSocketUrl,
    `(() => { const calls = window.__atlasQaCalls || (window.__atlasQaCalls = Object.create(null)); const record = { result: null }; calls[${key}] = record; Promise.resolve().then(() => (${expression})).then(value => { record.result = { ok: true, value } }, error => { record.result = { ok: false, error: String(error?.stack || error) } }); return true })()`
  )
  if (!started) throw new Error('Could not start the asynchronous read-only IPC call.')
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      await checkHealth()
      const response = await evaluateInPage(
        webSocketUrl,
        `window.__atlasQaCalls?.[${key}]?.result ?? null`,
        5000
      )
      if (response) {
        if (!response.ok) throw new Error(response.error)
        return response.value
      }
      await wait(400)
    }
    throw new Error(`Read-only IPC call did not finish within ${timeoutMs} ms.`)
  } finally {
    try {
      await evaluateInPage(webSocketUrl, `delete window.__atlasQaCalls?.[${key}]`, 1000)
    } catch {
      // The page may already be unresponsive or closed; preserve the original result.
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runApp(projectDir, reportDir, options) {
  const runDir = await mkdtemp(path.join(reportDir, 'atlas-app-smoke-'))
  const userDataDir = path.join(runDir, 'user-data')
  const readyFile = path.join(runDir, 'renderer-ready.json')
  const logFile = path.join(userDataDir, 'logs', 'atlas.log')
  await mkdir(userDataDir, { recursive: true })
  let devToolsPort
  try {
    devToolsPort = await findAvailablePort()
  } catch (error) {
    return {
      status: 'CRASH',
      details: `Could not reserve a local IPC test port: ${error.message}`,
      runDir
    }
  }

  let electronPath
  try {
    electronPath = createRequire(path.join(projectDir, 'package.json'))('electron')
  } catch (error) {
    return { status: 'CRASH', details: `Could not find Electron: ${error.message}`, runDir }
  }

  const startedAt = new Date().toISOString()
  const child = spawn(
    electronPath,
    ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${devToolsPort}`, projectDir],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        ATLAS_QA_MODE: '1',
        ATLAS_QA_USER_DATA_DIR: userDataDir,
        ATLAS_QA_READY_FILE: readyFile,
        ELECTRON_RENDERER_URL: ''
      },
      windowsHide: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let stdout = ''
  let stderr = ''
  let exitInfo = null
  child.stdout.on('data', (chunk) => (stdout = tail(stdout, chunk)))
  child.stderr.on('data', (chunk) => (stderr = tail(stderr, chunk)))
  child.once('error', (error) => {
    exitInfo = { error: error.message, code: null, signal: null }
  })
  child.once('close', (code, signal) => {
    exitInfo = { code, signal }
  })

  const deadline = Date.now() + options.startupTimeoutMs
  let readyAt = null
  let ipcCheck = null
  let onboardingCheck = null
  let routeChecks = null
  let functionalChecks = null
  let outcome = null
  while (!outcome) {
    const appLog = await readTail(logFile)
    if (/Renderer became unresponsive/i.test(appLog)) {
      outcome = { status: 'HANG', details: 'Electron reported an unresponsive renderer.' }
      break
    }
    if (/Renderer process gone:/i.test(appLog)) {
      outcome = { status: 'CRASH', details: 'Electron reported that the renderer process exited.' }
      break
    }
    if (exitInfo) {
      outcome = {
        status: exitInfo.error || exitInfo.code !== 0 ? 'CRASH' : 'FAIL',
        details:
          exitInfo.error ||
          `Atlas exited before the observation period ended (code ${exitInfo.code}).`
      }
      break
    }
    if (!readyAt) {
      try {
        JSON.parse(await readFile(readyFile, 'utf8'))
        readyAt = Date.now()
      } catch {
        if (Date.now() >= deadline) {
          outcome = {
            status: 'HANG',
            details: `Renderer did not finish loading within ${options.startupTimeoutMs} ms.`
          }
          break
        }
      }
    } else if (!ipcCheck) {
      try {
        const safeInfo = await checkPlatformInfo(devToolsPort)
        ipcCheck = {
          id: 'platform-info',
          status: 'PASS',
          details: `Read-only IPC returned valid platform capabilities (${safeInfo.platform}, ${safeInfo.featureCount} flags).`
        }
        readyAt = Date.now()
      } catch (error) {
        const isTimeout = /timed out|could not find the atlas renderer/i.test(error.message)
        ipcCheck = {
          id: 'platform-info',
          status: isTimeout ? 'HANG' : 'FAIL',
          details: error.message
        }
        outcome = {
          status: ipcCheck.status,
          details: `Read-only IPC check failed: ${error.message}`
        }
      }
    } else if (!onboardingCheck) {
      try {
        await runOnboardingFlow(devToolsPort, options.startupTimeoutMs, async () => {
          const currentLog = await readTail(logFile)
          if (/Renderer became unresponsive/i.test(currentLog)) {
            throw new Error('QA watchdog detected an unresponsive renderer during onboarding.')
          }
          if (/Renderer process gone:/i.test(currentLog) || exitInfo) {
            throw new Error('QA watchdog detected that the Atlas process exited during onboarding.')
          }
        })
        onboardingCheck = {
          id: 'onboarding-flow',
          status: 'PASS',
          details:
            'Language, welcome, settings, and finish screens completed; dashboard opened and completion persisted.'
        }
      } catch (error) {
        const isTimeout = /within .* ms|in time|timed out|unresponsive/i.test(error.message)
        const isCrash = /process exited/i.test(error.message)
        onboardingCheck = {
          id: 'onboarding-flow',
          status: isCrash ? 'CRASH' : isTimeout ? 'HANG' : 'FAIL',
          details: error.message
        }
        outcome = {
          status: onboardingCheck.status,
          details: `Onboarding flow failed: ${error.message}`
        }
      }
    } else if (!routeChecks) {
      try {
        routeChecks = await runPageRouteChecks(devToolsPort, options.startupTimeoutMs, async () => {
          const currentLog = await readTail(logFile)
          if (/Renderer became unresponsive/i.test(currentLog)) {
            throw new Error('QA watchdog detected an unresponsive renderer during page navigation.')
          }
          if (/Renderer process gone:/i.test(currentLog) || exitInfo) {
            throw new Error(
              'QA watchdog detected that the Atlas process exited during page navigation.'
            )
          }
        })
        const failedRoutes = routeChecks.filter((check) => check.status !== 'PASS')
        if (failedRoutes.length) {
          outcome = {
            status: failedRoutes.some((check) => check.status === 'HANG') ? 'HANG' : 'FAIL',
            details: `${failedRoutes.length} of ${APP_ROUTES.length} app routes failed: ${failedRoutes.map((check) => check.id.slice('route:'.length)).join(', ')}.`
          }
        } else {
          readyAt = Date.now()
        }
      } catch (error) {
        const isHang = /unresponsive|timed out|within .* ms/i.test(error.message)
        const isCrash = /process exited/i.test(error.message)
        outcome = {
          status: isCrash ? 'CRASH' : isHang ? 'HANG' : 'FAIL',
          details: `Page navigation checks stopped: ${error.message}`
        }
        routeChecks = []
      }
    } else if (!functionalChecks) {
      try {
        const checkHealth = async () => {
          const currentLog = await readTail(logFile)
          if (/Renderer became unresponsive/i.test(currentLog)) {
            throw new Error(
              'QA watchdog detected an unresponsive renderer during Driver Manager and read-only checks.'
            )
          }
          if (/Renderer process gone:/i.test(currentLog) || exitInfo) {
            throw new Error(
              'QA watchdog detected that the Atlas process exited during Driver Manager and read-only checks.'
            )
          }
        }
        functionalChecks = [
          await runDriverManagerUiScan(devToolsPort, checkHealth),
          ...(await runReadOnlyIpcChecks(devToolsPort, checkHealth))
        ]
        const failedChecks = functionalChecks.filter((check) =>
          ['FAIL', 'HANG', 'CRASH'].includes(check.status)
        )
        if (failedChecks.length) {
          outcome = {
            status: failedChecks.some((check) => check.status === 'CRASH')
              ? 'CRASH'
              : failedChecks.some((check) => check.status === 'HANG')
                ? 'HANG'
                : 'FAIL',
            details: `${failedChecks.length} of ${READ_ONLY_IPC_CHECKS.length} read-only function checks failed: ${failedChecks.map((check) => check.id.slice('ipc:'.length)).join(', ')}.`
          }
        } else {
          readyAt = Date.now()
        }
      } catch (error) {
        const isHang = /unresponsive|timed out|within .* ms|did not finish/i.test(error.message)
        const isCrash = /process exited/i.test(error.message)
        functionalChecks = functionalChecks || [
          {
            id: 'driver-manager-ui-scan',
            status: isCrash ? 'CRASH' : isHang ? 'HANG' : 'FAIL',
            details: error.message
          }
        ]
        outcome = {
          status: isCrash ? 'CRASH' : isHang ? 'HANG' : 'FAIL',
          details: `Driver Manager or read-only checks stopped: ${error.message}`
        }
      }
    } else if (Date.now() - readyAt >= options.observeMs) {
      outcome = {
        status: 'PASS',
        details: `Renderer loaded, read-only IPC passed, and stayed responsive for ${options.observeMs} ms.`
      }
      break
    }
    await wait(LOG_POLL_MS)
  }

  if (!exitInfo) {
    terminateTree(child)
    await Promise.race([new Promise((resolve) => child.once('close', resolve)), wait(5000)])
  }

  return {
    ...outcome,
    startedAt,
    finishedAt: new Date().toISOString(),
    rendererReady: Boolean(readyAt),
    checks: [ipcCheck, onboardingCheck, ...(routeChecks || []), ...(functionalChecks || [])].filter(
      Boolean
    ),
    logFile,
    runDir,
    stdout,
    stderr,
    appLog: await readTail(logFile)
  }
}

function markdownReport(report) {
  return [
    '# Atlas app smoke report',
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Build: ${report.build.status} — ${report.build.details}`,
    `Application: ${report.application.status} — ${report.application.details}`,
    `Renderer ready: ${report.application.rendererReady ? 'yes' : 'no'}`,
    ...(report.application.checks || []).map(
      (check) =>
        `${check.id === 'platform-info' ? 'Read-only IPC ' : ''}${check.id}: ${check.status} — ${check.details}`
    ),
    `Diagnostic log: ${report.application.logFile || 'not created'}`,
    ''
  ].join('\n')
}

async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\nRun with --help for usage.\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(
      'Usage: npm run qa:app-smoke -- [--startup-timeout-ms 120000] [--observe-ms 5000] [--report-dir PATH]\n' +
        `The check completes onboarding, clicks through 30 sidebar routes, clicks the Driver Manager scan button (up to ${DRIVER_MANAGER_SCAN_TIMEOUT_MS} ms), and checks six read-only IPC methods.\n`
    )
    return 0
  }

  await mkdir(options.reportDir, { recursive: true })
  const startedAt = new Date().toISOString()
  process.stdout.write('Building Atlas for the isolated startup check...\n')
  const build = await runBuild(options.projectDir)
  let application = {
    status: 'SKIP',
    details: 'Application launch skipped because the build did not pass.'
  }
  if (build.status === 'PASS') {
    process.stdout.write('Opening an isolated Atlas instance under the watchdog...\n')
    application = await runApp(options.projectDir, options.reportDir, options)
  }
  const report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    build,
    application
  }
  await Promise.all([
    writeFile(
      path.join(options.reportDir, 'qa-app-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(path.join(options.reportDir, 'qa-app-report.md'), markdownReport(report), 'utf8')
  ])
  process.stdout.write(`Build: ${build.status}; application: ${application.status}\n`)
  return build.status === 'PASS' && application.status === 'PASS' ? 0 : 1
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`Atlas app smoke failed: ${error.stack || error.message}\n`)
      process.exitCode = 2
    })
}

module.exports = {
  APP_ROUTES,
  DRIVER_MANAGER_SCAN_TIMEOUT_MS,
  READ_ONLY_IPC_CHECKS,
  findAvailablePort,
  markdownReport,
  parseArgs,
  validatePlatformInfo,
  validateReadOnlyResult
}

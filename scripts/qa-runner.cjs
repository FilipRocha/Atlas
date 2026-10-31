#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')

const CASES = [
  {
    id: 'typecheck',
    label: 'TypeScript typecheck',
    args: ['tsc', '--noEmit', '-p', 'tsconfig.node.json', '&&', 'tsc'],
    timeoutMs: 120_000
  },
  { id: 'unit-tests', label: 'Vitest unit tests', args: ['vitest', 'run'], timeoutMs: 20 * 60_000 }
]

function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    reportDir: path.join(process.cwd(), 'qa-reports'),
    only: null
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-dir' && argv[i + 1]) options.projectDir = path.resolve(argv[++i])
    else if (argv[i] === '--report-dir' && argv[i + 1]) options.reportDir = path.resolve(argv[++i])
    else if (argv[i] === '--only' && argv[i + 1])
      options.only = argv[++i].split(',').map((value) => value.trim())
    else if (argv[i] === '--help') options.help = true
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`)
  }
  return options
}

function markdownReport(report) {
  const counts = Object.fromEntries(
    ['PASS', 'FAIL', 'HANG', 'CRASH'].map((status) => [
      status,
      report.results.filter((item) => item.status === status).length
    ])
  )
  const lines = [
    '# Atlas QA smoke report',
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Total: ${report.results.length} | PASS: ${counts.PASS} | FAIL: ${counts.FAIL} | HANG: ${counts.HANG} | CRASH: ${counts.CRASH}`,
    '',
    '| Check | Result | Time | Details |',
    '|---|---|---:|---|',
    ...report.results.map(
      (item) =>
        `| ${item.label} | ${item.status} | ${(item.durationMs / 1000).toFixed(1)} s | ${(item.details || '').replaceAll('|', '\\|').replaceAll('\n', ' ')} |`
    ),
    ''
  ]
  return lines.join('\n')
}

function runChild(id, label, command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const keepTail = (current, chunk) => (current + chunk.toString()).slice(-32_000)
    child.stdout.on('data', (chunk) => {
      stdout = keepTail(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = keepTail(stderr, chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    const finish = (status, details) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ id, label, status, durationMs: Date.now() - started, details, stdout, stderr })
    }
    child.once('error', (error) => finish('CRASH', error.message))
    child.once('close', (code, signal) => {
      if (timedOut) finish('HANG', `Exceeded ${timeoutMs} ms and was stopped.`)
      else if (code === 0) finish('PASS', 'Completed successfully.')
      else finish('FAIL', `Exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`)
    })
  })
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
      'Usage: npm run qa:smoke -- [--only typecheck,unit-tests] [--report-dir PATH]\n'
    )
    return 0
  }
  const selected = options.only ? CASES.filter((item) => options.only.includes(item.id)) : CASES
  const unknown = options.only?.filter((id) => !CASES.some((item) => item.id === id)) || []
  if (!selected.length || unknown.length) {
    process.stderr.write(
      `Unknown or empty check selection: ${unknown.join(', ') || options.only.join(', ')}\n`
    )
    return 2
  }
  const runCase = async (item) => {
    if (item.id === 'typecheck') {
      const tsc = require.resolve('typescript/bin/tsc', { paths: [options.projectDir] })
      const node = process.execPath
      const first = await runChild(
        item.id,
        item.label,
        node,
        [tsc, '--noEmit', '-p', 'tsconfig.node.json'],
        options.projectDir,
        item.timeoutMs
      )
      if (first.status !== 'PASS') return first
      const second = await runChild(
        item.id,
        item.label,
        node,
        [tsc, '--noEmit', '-p', 'tsconfig.web.json'],
        options.projectDir,
        item.timeoutMs
      )
      return {
        ...second,
        durationMs: first.durationMs + second.durationMs,
        stdout: first.stdout + second.stdout,
        stderr: first.stderr + second.stderr
      }
    }
    const vitest = path.join(options.projectDir, 'node_modules', 'vitest', 'vitest.mjs')
    return runChild(
      item.id,
      item.label,
      process.execPath,
      [vitest, 'run'],
      options.projectDir,
      item.timeoutMs
    )
  }

  const startedAt = new Date().toISOString()
  const results = []
  for (const item of selected) {
    process.stdout.write(`Running ${item.label}...\n`)
    try {
      const result = await runCase(item)
      results.push(result)
      process.stdout.write(
        `${result.status}: ${item.label} (${(result.durationMs / 1000).toFixed(1)} s)\n`
      )
    } catch (error) {
      results.push({
        id: item.id,
        label: item.label,
        status: 'CRASH',
        durationMs: 0,
        details: error.message,
        stdout: '',
        stderr: ''
      })
      process.stdout.write(`CRASH: ${item.label} (${error.message})\n`)
    }
  }
  const report = { schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), results }
  await mkdir(options.reportDir, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(options.reportDir, 'qa-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(path.join(options.reportDir, 'qa-report.md'), markdownReport(report), 'utf8')
  ])
  return results.every((item) => item.status === 'PASS') ? 0 : 1
}

if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`QA runner failed: ${error.stack || error.message}\n`)
      process.exitCode = 2
    })

module.exports = { CASES, markdownReport, parseArgs, runChild }

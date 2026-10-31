// Fetch the official WinGet App Installer bundle only for Windows packaging.
// The file is large (>200 MB), so it must not be stored in the source repo.
const { createWriteStream } = require('node:fs')
const { mkdir, rm, stat } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'resources', 'winget')
const FILE_NAME = 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle'
const OUT_FILE = join(OUT_DIR, FILE_NAME)
const RELEASE_API = 'https://api.github.com/repos/microsoft/winget-cli/releases/latest'
const MAX_SIZE = 500 * 1024 * 1024

async function main() {
  const releaseResponse = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Atlas-build' }
  })
  if (!releaseResponse.ok)
    throw new Error(`GitHub release lookup failed (${releaseResponse.status})`)

  const release = await releaseResponse.json()
  if (
    release.draft ||
    release.prerelease ||
    release.html_url?.startsWith('https://github.com/microsoft/winget-cli/') !== true
  ) {
    throw new Error('GitHub returned an unexpected WinGet release')
  }

  const asset = release.assets?.find((entry) => entry.name === FILE_NAME)
  const expectedDigest = asset?.digest?.match(/^sha256:([a-f\d]{64})$/i)?.[1]
  if (
    !asset ||
    !expectedDigest ||
    !asset.browser_download_url?.startsWith('https://github.com/microsoft/winget-cli/')
  ) {
    throw new Error('The official WinGet release is missing the bundle or its SHA-256 digest')
  }
  if (asset.size > MAX_SIZE) throw new Error('The WinGet bundle exceeds the allowed download size')

  await mkdir(OUT_DIR, { recursive: true })
  await rm(OUT_FILE, { force: true })

  try {
    const response = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'Atlas-build' },
      redirect: 'follow'
    })
    if (!response.ok || !response.body)
      throw new Error(`WinGet bundle download failed (${response.status})`)
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_SIZE) {
      throw new Error('The WinGet bundle exceeds the allowed download size')
    }

    await pipeline(Readable.fromWeb(response.body), createWriteStream(OUT_FILE, { flags: 'wx' }))
    const downloaded = await stat(OUT_FILE)
    if (downloaded.size !== asset.size)
      throw new Error('Downloaded WinGet bundle size does not match the release metadata')

    const hash = createHash('sha256')
    const { createReadStream } = require('node:fs')
    for await (const chunk of createReadStream(OUT_FILE)) hash.update(chunk)
    if (hash.digest('hex').toLowerCase() !== expectedDigest.toLowerCase()) {
      throw new Error('Downloaded WinGet bundle failed SHA-256 verification')
    }

    console.log(`Verified WinGet App Installer ${release.tag_name} for packaging.`)
  } catch (error) {
    await rm(OUT_FILE, { force: true })
    throw error
  }
}

main().catch((error) => {
  console.error(`[atlas] ${error.message}`)
  process.exitCode = 1
})

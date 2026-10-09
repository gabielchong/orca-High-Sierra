// Self-update for an ad-hoc signed app. Squirrel.Mac (Electron's autoUpdater) refuses to install
// bundles whose signature does not match the running app, which rules it out for OrcaHS. This
// module does the equivalent by hand: download the release zip from GitHub, verify its SHA-256
// against the release's SHA256SUMS.txt, unpack it, swap the .app bundle in place, relaunch.
//
// Files written by Node carry no quarantine attribute, so Gatekeeper does not prompt afterwards.
// Everything temporary lives under <baseDir>/updates. The replaced bundle is kept next to the app
// as OrcaHS.app.old-<timestamp> until the next successful start removes it.
const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { ASSET_PREFIX, expectedSha256 } = require('./update-check')

const MAX_REDIRECTS = 5
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000

function httpsGet(url, { headers = {}, onResponse }, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': headers['User-Agent'] || 'OrcaHS', ...headers }, timeout: 30000 }, (res) => {
      const status = res.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume()
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'))
        const next = new URL(res.headers.location, url).href
        // GitHub hands assets to objects.githubusercontent.com; anything else is suspicious.
        if (!/^https:\/\/([a-z0-9-]+\.)*(github\.com|githubusercontent\.com)\//i.test(next)) return reject(new Error(`redirect to unexpected host ${new URL(next).host}`))
        return resolve(httpsGet(next, { headers, onResponse }, redirects + 1))
      }
      if (status !== 200) { res.resume(); return reject(new Error(`HTTP ${status}`)) }
      resolve(onResponse(res))
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
  })
}

function downloadToFile(url, dest, { userAgent, onProgress, expectedSize }) {
  return httpsGet(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' },
    onResponse: (res) => new Promise((resolve, reject) => {
      const total = Number(res.headers['content-length']) || expectedSize || 0
      let received = 0
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(dest, { mode: 0o600 })
      const timer = setTimeout(() => { res.destroy(new Error('download timed out')) }, DOWNLOAD_TIMEOUT_MS)
      res.on('data', (chunk) => {
        received += chunk.length
        hash.update(chunk)
        if (onProgress) onProgress({ received, total })
      })
      res.on('error', (err) => { clearTimeout(timer); out.destroy(); reject(err) })
      out.on('error', (err) => { clearTimeout(timer); reject(err) })
      res.pipe(out)
      out.on('finish', () => { clearTimeout(timer); resolve({ received, sha256: hash.digest('hex') }) })
    })
  })
}

function downloadText(url, { userAgent, maxBytes = 64 * 1024 }) {
  return httpsGet(url, {
    headers: { 'User-Agent': userAgent },
    onResponse: (res) => new Promise((resolve, reject) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c; if (body.length > maxBytes) res.destroy(new Error('response too large')) })
      res.on('error', reject)
      res.on('end', () => resolve(body))
    })
  })
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(`${path.basename(cmd)} failed: ${(stderr || err.message).trim()}`)) : resolve(stdout))
  })
}

function readBundleVersion(appPath) {
  try {
    const pkgPath = path.join(appPath, 'Contents', 'Resources', 'app', 'package.json')
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null
  } catch { return null }
}

// Locates the running .app bundle from the executable path.
function runningBundlePath(execPath) {
  const p = path.resolve(execPath, '..', '..', '..')
  return p.endsWith('.app') ? p : null
}

/**
 * Full update. Reports progress through onStage({ stage, received, total, message }).
 * Stages: download, verify, unpack, install, relaunch. Throws on any failure; the caller then
 * offers the release page instead.
 */
async function installUpdate({ release, baseDir, execPath, userAgent, productName, onStage, relaunch }) {
  if (!release || !release.zip || !release.sums) throw new Error('this release has no installable zip and checksum file')
  if (!release.zip.url.startsWith(ASSET_PREFIX) || !release.sums.url.startsWith(ASSET_PREFIX)) throw new Error('asset URL is not under this project\'s releases')
  const appPath = runningBundlePath(execPath)
  if (!appPath) throw new Error('cannot locate the running .app bundle')
  const parent = path.dirname(appPath)
  try { fs.accessSync(parent, fs.constants.W_OK) } catch { throw new Error(`no permission to replace the app in ${parent}; move OrcaHS to a folder you own or update by hand`) }

  const workDir = path.join(baseDir, 'updates')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 })
  const zipPath = path.join(workDir, release.zip.name)
  const extractDir = path.join(workDir, 'unpacked')

  onStage({ stage: 'download', received: 0, total: release.zip.size })
  const [{ sha256 }, sumsText] = await Promise.all([
    downloadToFile(release.zip.url, zipPath, { userAgent, expectedSize: release.zip.size, onProgress: (p) => onStage({ stage: 'download', ...p }) }),
    downloadText(release.sums.url, { userAgent })
  ])

  onStage({ stage: 'verify' })
  const expected = expectedSha256(sumsText, release.zip.name)
  if (!expected) throw new Error(`SHA256SUMS.txt has no entry for ${release.zip.name}`)
  if (expected !== sha256) throw new Error('downloaded file does not match its published checksum')

  onStage({ stage: 'unpack' })
  fs.mkdirSync(extractDir, { recursive: true, mode: 0o700 })
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])
  const newApp = fs.readdirSync(extractDir).map((n) => path.join(extractDir, n)).find((p) => p.endsWith('.app'))
  if (!newApp) throw new Error('zip did not contain an application bundle')
  const newVersion = readBundleVersion(newApp)
  if (newVersion !== release.version) throw new Error(`unpacked app reports version ${newVersion}, expected ${release.version}`)
  if (!fs.existsSync(path.join(newApp, 'Contents', 'MacOS', productName))) throw new Error('unpacked app is missing its executable')

  onStage({ stage: 'install' })
  const backup = `${appPath}.old-${Date.now()}`
  fs.renameSync(appPath, backup)
  try {
    try {
      fs.renameSync(newApp, appPath)
    } catch (err) {
      if (err.code !== 'EXDEV') throw err
      await run('/usr/bin/ditto', [newApp, appPath]) // different volume: copy, then drop the source
      fs.rmSync(newApp, { recursive: true, force: true })
    }
  } catch (err) {
    // Put the old app back so the owner is never left without a working copy.
    try { if (!fs.existsSync(appPath)) fs.renameSync(backup, appPath) } catch {}
    throw err
  }
  fs.rmSync(zipPath, { force: true })
  fs.rmSync(extractDir, { recursive: true, force: true })

  onStage({ stage: 'relaunch' })
  relaunch(path.join(appPath, 'Contents', 'MacOS', productName), backup)
}

// Called on every start: remove leftovers of a previous update next to the running bundle.
function cleanupOldBundles(execPath, log) {
  const appPath = runningBundlePath(execPath)
  if (!appPath) return
  const dir = path.dirname(appPath)
  const base = path.basename(appPath)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n.startsWith(`${base}.old-`)) {
      try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); log(`[update] removed ${n}`) } catch (err) { log(`[update] could not remove ${n}: ${err && err.message}`) }
    }
  }
}

module.exports = { installUpdate, cleanupOldBundles, runningBundlePath, readBundleVersion }

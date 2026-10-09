// Update reminder: compares the running version with the latest GitHub release and tells the
// owner. It never downloads or installs anything (ad-hoc signed apps cannot self-update on macOS).
// Pure helpers live here; main.js does the network call and UI.
const RELEASES_API = 'https://api.github.com/repos/gabielchong/orca-High-Sierra/releases/latest'
const RELEASES_PAGE_PREFIX = 'https://github.com/gabielchong/orca-High-Sierra/releases/'
const ASSET_PREFIX = 'https://github.com/gabielchong/orca-High-Sierra/releases/download/'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null }
}

// > 0 if a is newer than b, < 0 if older, 0 if equal. A pre-release is older than its release.
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (const k of ['major', 'minor', 'patch']) if (pa[k] !== pb[k]) return pa[k] - pb[k]
  if (pa.pre && !pb.pre) return -1
  if (!pa.pre && pb.pre) return 1
  return 0
}

// Accepts the JSON of GET /releases/latest. Only trusts the fields we need and only a release
// page URL under this repository.
function parseLatestRelease(json) {
  let data = json
  if (typeof json === 'string') { try { data = JSON.parse(json) } catch { return null } }
  if (!data || typeof data !== 'object' || data.draft || data.prerelease) return null
  const version = parseVersion(data.tag_name) ? String(data.tag_name).replace(/^v/i, '') : null
  const url = typeof data.html_url === 'string' && data.html_url.startsWith(RELEASES_PAGE_PREFIX) ? data.html_url : null
  if (!version || !url) return null
  // Installable assets: the zip for this version and the checksum list, both hosted by GitHub
  // under this repository's release downloads.
  const assets = Array.isArray(data.assets) ? data.assets : []
  const pick = (name) => {
    const a = assets.find((x) => x && x.name === name && typeof x.browser_download_url === 'string' && x.browser_download_url.startsWith(ASSET_PREFIX))
    return a ? { name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 } : null
  }
  const zip = pick(`OrcaHS-${version}.zip`)
  const sums = pick('SHA256SUMS.txt')
  return { version, url, name: typeof data.name === 'string' ? data.name : `v${version}`, zip, sums }
}

function shouldCheck(state, now = Date.now(), interval = CHECK_INTERVAL_MS) {
  if (!state || state.disabled) return false
  const last = Number(state.lastCheckedAt) || 0
  return now - last >= interval
}

function isNewer(latestVersion, currentVersion) {
  return compareVersions(latestVersion, currentVersion) > 0
}

// Finds the expected SHA-256 for `filename` in a SHA256SUMS.txt body.
function expectedSha256(sumsText, filename) {
  for (const line of String(sumsText || '').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (m && m[2].trim() === filename) return m[1].toLowerCase()
  }
  return null
}

module.exports = { RELEASES_API, RELEASES_PAGE_PREFIX, ASSET_PREFIX, CHECK_INTERVAL_MS, parseVersion, compareVersions, parseLatestRelease, shouldCheck, isNewer, expectedSha256 }

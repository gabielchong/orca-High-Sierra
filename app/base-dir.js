// Where the app keeps its data. Resolution order:
//   1. --base-dir=<dir>
//   2. portable mode: a folder named "<ProductName>-data" next to the .app bundle
//      (lets a copy on a USB stick or in a user folder keep everything together, and makes
//      Dock / Finder launches use the same data as command-line launches)
//   3. the per-user application data folder
const path = require('path')

function resolveBaseDir({ argBaseDir, execPath, appData, productName, exists }) {
  if (argBaseDir) return { dir: path.resolve(argBaseDir), mode: 'flag' }
  const bundle = path.resolve(execPath, '..', '..', '..')
  if (bundle.endsWith('.app')) {
    const portable = path.join(path.dirname(bundle), `${productName}-data`)
    if (exists(portable)) return { dir: portable, mode: 'portable' }
  }
  return { dir: path.join(appData, productName), mode: 'default' }
}

module.exports = { resolveBaseDir }

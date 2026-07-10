const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const indexPath = join(root, 'dist', 'index.html')
const electronOutput = join(root, 'dist-electron')
const failures = []

if (!existsSync(indexPath)) {
  failures.push('dist/index.html is missing; run npm run build first')
} else {
  const html = readFileSync(indexPath, 'utf8')
  const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)
  const preloadHrefs = [...html.matchAll(/rel="modulepreload"[^>]+href="([^"]+)"/g)].map(match => match[1])
  if (!entryMatch) {
    failures.push('renderer entry script was not found in dist/index.html')
  } else {
    const initialScripts = [entryMatch[1], ...preloadHrefs]
      .map(href => join(root, 'dist', href.replace(/^\.\//, '')))
    const entryBytes = statSync(initialScripts[0]).size
    const initialBytes = initialScripts.reduce((total, path) => total + statSync(path).size, 0)
    const initialSource = initialScripts.map(path => readFileSync(path, 'utf8')).join('\n')
    console.log(`renderer entry: ${(entryBytes / 1024).toFixed(2)} KiB`)
    console.log(`initial JavaScript: ${(initialBytes / 1024).toFixed(2)} KiB`)
    if (initialBytes >= 1024 * 1024) failures.push('initial JavaScript must remain below 1 MiB')
    if (/new Function\s*\(/.test(initialSource)) failures.push('initial JavaScript contains dynamic function compilation')
  }

  const eagerHeavyChunks = preloadHrefs.filter(href => /mermaid|cytoscape|katex/i.test(href))
  if (eagerHeavyChunks.length > 0) failures.push(`heavy chunks are eagerly preloaded: ${eagerHeavyChunks.join(', ')}`)
  if (html.includes("'unsafe-eval'")) failures.push("CSP must not allow 'unsafe-eval'")
}

function collectFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}

const electronFiles = collectFiles(electronOutput)
const electronBytes = electronFiles.reduce((total, path) => total + statSync(path).size, 0)
console.log(`electron output: ${electronFiles.length} files, ${(electronBytes / 1024 / 1024).toFixed(2)} MiB`)
if (electronFiles.length > 20) failures.push('dist-electron contains stale build artifacts')
if (electronBytes > 10 * 1024 * 1024) failures.push('dist-electron exceeds the 10 MiB budget')

if (failures.length > 0) {
  for (const failure of failures) console.error(`performance check failed: ${failure}`)
  process.exitCode = 1
} else {
  console.log('performance checks passed')
}

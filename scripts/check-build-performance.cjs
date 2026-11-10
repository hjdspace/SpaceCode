const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const indexPath = join(root, 'dist', 'index.html')
const assetsDir = join(root, 'dist', 'assets')
const electronOutput = join(root, 'dist-electron')
const budgetPath = join(__dirname, 'perf-budget.json')
const failures = []

if (!existsSync(budgetPath)) {
  console.error(`performance check failed: missing budget file ${budgetPath}`)
  process.exit(1)
}
// 预算是棘轮：只允许随产物减重一起下调。上调必须在 PR 里说明理由并同步提交本文件改动。
const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))

function collectFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}

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
    console.log(`initial JavaScript: ${(initialBytes / 1024).toFixed(2)} KiB (budget ${(budget.initialJsBytes / 1024).toFixed(2)} KiB)`)
    if (initialBytes > budget.initialJsBytes) failures.push('initial JavaScript exceeds the budget; reduce the bundle or lower the budget in scripts/perf-budget.json')
    if (/new Function\s*\(/.test(initialSource)) failures.push('initial JavaScript contains dynamic function compilation')
  }

  const eagerHeavyChunks = preloadHrefs.filter(href => /mermaid|cytoscape|katex/i.test(href))
  if (eagerHeavyChunks.length > 0) failures.push(`heavy chunks are eagerly preloaded: ${eagerHeavyChunks.join(', ')}`)
  if (html.includes("'unsafe-eval'")) failures.push("CSP must not allow 'unsafe-eval'")
}

// 设计令牌只允许从入口样式发射一次：任何被 additionalData / SFC @use 的注入都会让每个
// 样式块各带一份，直接把 CSS 总量推高（历史峰值 265 份，dist CSS 曾达 4 MB）。
// `--font-scale` 只由 src/styles/_tokens.scss 定义（design.scss / vue-flow 的自有 :root 都不含它），
// 因此按它的出现次数判定令牌负载的副本数，而不是按 :root 块数（后者会把正常的自有 :root 计入）。
const TOKEN_MARKER = '--font-scale:'
const MAX_TOKEN_COPIES = 1
const cssFiles = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter(name => name.endsWith('.css')).map(name => join(assetsDir, name))
  : []
if (cssFiles.length === 0) {
  failures.push('dist/assets contains no CSS; run npm run build first')
} else {
  const cssBytes = cssFiles.reduce((total, path) => total + statSync(path).size, 0)
  const tokenCopies = cssFiles.reduce((count, path) => {
    const source = readFileSync(path, 'utf8')
    return count + (source.split(TOKEN_MARKER).length - 1)
  }, 0)
  console.log(`CSS total: ${(cssBytes / 1024).toFixed(2)} KiB (budget ${(budget.cssTotalBytes / 1024).toFixed(2)} KiB)`)
  console.log(`design token copies: ${tokenCopies} (max ${MAX_TOKEN_COPIES})`)
  if (cssBytes > budget.cssTotalBytes) failures.push('CSS total exceeds the budget; reduce the bundle or lower the budget in scripts/perf-budget.json')
  if (tokenCopies > MAX_TOKEN_COPIES) failures.push('design tokens are emitted more than once; keep CSS-emitting token blocks in src/styles/_tokens.scss and only @use them from global.scss')
}

const electronFiles = collectFiles(electronOutput)
const electronBytes = electronFiles.reduce((total, path) => total + statSync(path).size, 0)
console.log(`electron output: ${electronFiles.length} files, ${(electronBytes / 1024 / 1024).toFixed(2)} MiB (budget ${budget.maxElectronFiles} files / ${(budget.electronBytes / 1024 / 1024).toFixed(2)} MiB)`)
if (electronFiles.length > budget.maxElectronFiles) failures.push('dist-electron contains stale build artifacts')
if (electronBytes > budget.electronBytes) failures.push('dist-electron exceeds the size budget')

if (failures.length > 0) {
  for (const failure of failures) console.error(`performance check failed: ${failure}`)
  process.exitCode = 1
} else {
  console.log('performance checks passed')
}

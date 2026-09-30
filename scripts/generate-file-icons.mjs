/**
 * Build the offline icon subset used by the file tree.
 *
 * @iconify-json/vscode-icons ships a 3.6MB full collection; only the names in
 * fileIcons.json are needed at runtime, so they are extracted here and committed
 * as src/assets/vscode-icons.json. Re-run after editing the mapping table.
 *
 *   node scripts/generate-file-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getIcons } from '@iconify/utils'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MAP_PATH = join(root, 'src/components/explorer/fileIcons.json')
const OUT_PATH = join(root, 'src/assets/vscode-icons.json')

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
const collection = require('@iconify-json/vscode-icons/icons.json')

const wanted = [
  ...Object.values(map.names),
  ...map.patterns.map(([, icon]) => icon),
  ...Object.values(map.extensions),
  map.default,
]
const names = [...new Set(wanted)]

const subset = getIcons(collection, names)
const available = new Set([...Object.keys(subset.icons), ...Object.keys(subset.aliases || {})])
const missing = names.filter(name => !available.has(name))

if (missing.length) {
  console.error(`[generate-file-icons] unknown vscode-icons names in fileIcons.json:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}

const json = JSON.stringify(subset)
writeFileSync(OUT_PATH, json)
console.log(
  `[generate-file-icons] ${names.length} icons -> src/assets/vscode-icons.json (${(json.length / 1024).toFixed(1)} KB)`
)

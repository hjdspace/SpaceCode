/**
 * Desktop-optimized build: produces a SINGLE bundled JS file (no code splitting).
 *
 * This dramatically reduces the number of files shipped in extraResources
 * (from 46,000+ files / 660MB down to ~3 files / ~140MB), which eliminates
 * the multi-minute startup delay in portable/NSIS builds caused by extracting
 * and scanning tens of thousands of files on Windows.
 *
 * Output: dist-desktop/cli.js  (single bundle, ~15-30MB)
 *         dist-desktop/vendor/  (native .node addons)
 *
 * Usage: bun run build-desktop.ts
 */
import { cp, mkdir } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines } from './scripts/defines.ts'

const outdir = 'dist-desktop'

// Step 1: Clean output directory
const { rmSync, existsSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

// Default features (same as build.ts)
const DEFAULT_BUILD_FEATURES = [
  'AGENT_TRIGGERS_REMOTE',
  'CHICAGO_MCP',
  'VOICE_MODE',
  'SHOT_STATS',
  'PROMPT_CACHE_BREAK_DETECTION',
  'TOKEN_BUDGET',
  'AGENT_TRIGGERS',
  'ULTRATHINK',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'LODESTONE',
  'EXTRACT_MEMORIES',
  'VERIFICATION_AGENT',
  'KAIROS_BRIEF',
  'AWAY_SUMMARY',
  'ULTRAPLAN',
  'DAEMON',
  'WORKFLOW_SCRIPTS',
  'HISTORY_SNIP',
  'CONTEXT_COLLAPSE',
  'MONITOR_TOOL',
  'FORK_SUBAGENT',
  'UDS_INBOX',
  'KAIROS',
  'COORDINATOR_MODE',
  'LAN_PIPES',
  'POOR',
]

const envFeatures = Object.keys(process.env)
  .filter(k => k.startsWith('FEATURE_'))
  .map(k => k.replace('FEATURE_', ''))
const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

// Step 2: Bundle WITHOUT splitting → single output file
console.log('[desktop-build] Bundling CLI into single file (no splitting)...')
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: false,
  define: getMacroDefines(),
  features,
})

if (!result.success) {
  console.error('[desktop-build] Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Step 3: Post-process — replace Bun-only import.meta.require with compatible version
const { readdir, readFile, writeFile } = await import('fs/promises')
const files = await readdir(outdir)
const IMPORT_META_REQUIRE = 'var __require = import.meta.require;'
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`

let patched = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (content.includes(IMPORT_META_REQUIRE)) {
    await writeFile(
      filePath,
      content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
    )
    patched++
  }
}

// Step 4: Copy native .node addon files (audio-capture)
const vendorSrc = 'vendor/audio-capture'
if (existsSync(vendorSrc)) {
  const vendorDest = join(outdir, 'vendor', 'audio-capture')
  await cp(vendorSrc, vendorDest, { recursive: true })
  console.log(`[desktop-build] Copied vendor/audio-capture/ → ${vendorDest}/`)
}

// Report results
const outputFiles = await readdir(outdir)
const jsFiles = outputFiles.filter(f => f.endsWith('.js'))
let totalSize = 0
for (const f of jsFiles) {
  const stat = Bun.file(join(outdir, f))
  totalSize += stat.size
}

console.log(`[desktop-build] Done! Output:`)
console.log(`  - ${jsFiles.length} JS file(s) in ${outdir}/ (${(totalSize / 1024 / 1024).toFixed(1)} MB)`)
console.log(`  - Patched ${patched} file(s) for Node.js compat`)
console.log(`  - Native vendor addons copied`)
console.log(``)
console.log(`[desktop-build] Compared to split build:`)
console.log(`  - Before: 531 chunks + 45,775 node_modules files (~660 MB)`)
console.log(`  - After:  ${jsFiles.length} file(s) + vendor .node files (~${((totalSize / 1024 / 1024) + 111).toFixed(0)} MB with bun.exe)`)

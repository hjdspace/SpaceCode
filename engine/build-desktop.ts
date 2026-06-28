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
/// <reference types="bun" />
import { cp, mkdir } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from './scripts/defines.ts'

const outdir = 'dist-desktop'

// Step 1: Clean output directory
const { rmSync, existsSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

// Feature flags are now centralized in scripts/defines.ts (same as build.ts).
// This avoids drift between build.ts and build-desktop.ts.

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
  define: {
    ...getMacroDefines(),
    // React production mode — eliminates _debugStack Error objects
    // (6,889 objects × ~1.7KB = 12MB in development builds) and removes
    // prop-type / key warnings not useful in a production CLI tool.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
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

// Step 3b: Patch unguarded globalThis.Bun destructuring from third-party deps
// (e.g. @anthropic-ai/sandbox-runtime) so Node.js doesn't crash at import time.
// The desktop bundle runs under Node.js (Electron), where globalThis.Bun is undefined.
let bunPatched = 0
// Non-global regex for detection (avoid lastIndex statefulness in loop).
// The global variant is only used for the actual replace() call.
const BUN_DESTRUCTURE_TEST = /var \{([^}]+)\} = globalThis\.Bun;?/
const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
const BUN_DESTRUCTURE_SAFE =
  'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (BUN_DESTRUCTURE_TEST.test(content)) {
    await writeFile(
      filePath,
      content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
    )
    bunPatched++
  }
}

// Step 4: Copy native .node addon files (audio-capture)
const vendorSrc = 'vendor/audio-capture'
if (existsSync(vendorSrc)) {
  const vendorDest = join(outdir, 'vendor', 'audio-capture')
  await cp(vendorSrc, vendorDest, { recursive: true })
  console.log(`[desktop-build] Copied vendor/audio-capture/ → ${vendorDest}/`)
}

// Step 4b: Copy ripgrep vendor binary.
// At runtime, engine/src/utils/ripgrep.ts resolves the rg binary via
// distRoot (from distRoot.ts). distRoot looks for a 'dist' path segment;
// since our output dir is 'dist-desktop' (not 'dist'), it falls back to
// __dirname == dist-desktop/, so it looks for
// dist-desktop/vendor/ripgrep/${arch}-${platform}/rg(.exe).
//
// postinstall.cjs (run by `bun install`) downloads the current platform's
// ripgrep to engine/src/utils/vendor/ripgrep/${arch}-${platform}/. We need
// to mirror that directory under dist-desktop/ so packaged Electron builds
// (extraResources copies engine/dist-desktop/ → resources/engine/dist-desktop/)
// can actually spawn rg. Without this, GrepTool / GlobTool fail with:
//   ENOENT: spawn .../resources/engine/dist-desktop/vendor/ripgrep/${arch}-${platform}/rg
const ripgrepSrc = join('src', 'utils', 'vendor', 'ripgrep')
// If ripgrep vendor dir is missing, auto-trigger postinstall to download it.
// This handles the case where `bun install` was skipped or its postinstall
// download was blocked — the build script self-heals instead of hard-failing.
if (!existsSync(ripgrepSrc)) {
  console.log('[desktop-build] ripgrep vendor not found, running postinstall.cjs to download...')
  const { spawnSync } = await import('child_process')
  const postinstallResult = spawnSync('node', ['scripts/postinstall.cjs'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  })
  if (postinstallResult.status !== 0) {
    console.warn('[desktop-build] postinstall.cjs exited with non-zero status')
  }
}
if (existsSync(ripgrepSrc)) {
  const ripgrepDest = join(outdir, 'vendor', 'ripgrep')
  await cp(ripgrepSrc, ripgrepDest, { recursive: true })
  console.log(`[desktop-build] Copied ${ripgrepSrc}/ → ${ripgrepDest}/`)
} else {
  // Fail loudly in CI — this WILL break Grep/Glob at runtime in the packaged app.
  // Most likely cause: network blocked the download. Re-run `bun install`
  // (optionally with HTTPS_PROXY or RIPGREP_DOWNLOAD_BASE set) before `build-desktop.ts`.
  console.error(
    `[desktop-build] ERROR: ${ripgrepSrc}/ not found after auto-download attempt. ` +
      `Run \`bun install\` in engine/ first so postinstall.cjs downloads the ripgrep binary. ` +
      `If GitHub is blocked, set RIPGREP_DOWNLOAD_BASE to a mirror ` +
      `(see scripts/postinstall.cjs header). ` +
      `Without this, the packaged desktop app's Grep/Glob tools will crash with ENOENT at runtime.`,
  )
  process.exit(1)
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
console.log(`  - Patched ${patched} file(s) for import.meta.require, ${bunPatched} for Bun destructure`)
console.log(`  - Native vendor addons copied`)
console.log(``)
console.log(`[desktop-build] Compared to split build:`)
console.log(`  - Before: 531 chunks + 45,775 node_modules files (~660 MB)`)
console.log(`  - After:  ${jsFiles.length} file(s) + vendor .node files (~${((totalSize / 1024 / 1024) + 111).toFixed(0)} MB with bun.exe)`)

/**
 * GenUI 卡片沙箱的构建产物：独立入口 + 独立资源目录（`<repoRoot>/dist/genui-sandbox`）。
 *
 * 产物形状是固定的三件套：`index.html` + `sandbox.js`（经典脚本）+ `sandbox.css`。
 * 文件名不带 hash —— 消费方按 `no-cache` 下发，而沙箱 CSP 的 `script-src 'self'`
 * 只认自身源，不需要跨版本共存。
 *
 * 现在是 esbuild：票 01 的沙箱只有 DOM 与 TS，IIFE 输出正好符合"经典脚本"这一硬约束
 * （opaque origin 文档里 module script 按 CORS 发起，自定义协议不放行跨源请求）。
 * 票 02 引入 OpenTiny 物料与 Vue 后需要 SFC 编译，换 Vite 时保持同样的产物形状即可，
 * `electron/genui/sandboxProtocol.ts` 与 `sandboxDevServer.ts` 都不用改。
 *
 * `repoRoot` 由调用方给出：Vite 会把配置文件打进临时文件再 import，届时
 * `import.meta.url` 不再指向仓库根，靠它反推会算错源目录。
 */
import { build, context } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SANDBOX_ENTRY_FILE = 'sandbox.js'
const STATIC_FILES = ['index.html', 'sandbox.css']

function sandboxPaths(repoRoot) {
  const sandboxDir = join(repoRoot, 'sandbox')
  return {
    sandboxDir,
    outDir: join(repoRoot, 'dist', 'genui-sandbox'),
    entry: join(sandboxDir, 'main.ts'),
    alias: { '@': join(repoRoot, 'src') },
  }
}

function esbuildOptions(repoRoot, outDir) {
  const paths = sandboxPaths(repoRoot)
  return {
    entryPoints: [paths.entry],
    outfile: join(outDir, SANDBOX_ENTRY_FILE),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: false,
    alias: paths.alias,
    logLevel: 'warning',
  }
}

async function copyStaticFiles(repoRoot, outDir) {
  const { sandboxDir } = sandboxPaths(repoRoot)
  await mkdir(outDir, { recursive: true })
  await Promise.all(STATIC_FILES.map((name) => copyFile(join(sandboxDir, name), join(outDir, name))))
}

/** 构建一次，返回产物目录。 */
export async function buildGenuiSandbox({ repoRoot = process.cwd(), outDir } = {}) {
  const target = outDir ?? sandboxPaths(repoRoot).outDir
  await copyStaticFiles(repoRoot, target)
  await build(esbuildOptions(repoRoot, target))
  return target
}

/**
 * 开发期持续构建。返回停止函数，宿主（`vite.config.mts` 的开发插件）在服务关闭时调用。
 */
export async function watchGenuiSandbox({ repoRoot = process.cwd(), outDir } = {}) {
  const target = outDir ?? sandboxPaths(repoRoot).outDir
  await copyStaticFiles(repoRoot, target)
  const ctx = await context(esbuildOptions(repoRoot, target))
  await ctx.watch()
  return async () => {
    await ctx.dispose()
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  if (process.argv.includes('--watch')) {
    const stop = await watchGenuiSandbox()
    process.once('SIGINT', () => {
      void stop().then(() => process.exit(0))
    })
    console.log('[genui-sandbox] watching -> dist/genui-sandbox')
  } else {
    const outDir = await buildGenuiSandbox()
    console.log(`[genui-sandbox] built -> ${outDir}`)
  }
}

/**
 * GenUI 卡片沙箱的构建产物：独立入口 + 独立资源目录（`<repoRoot>/dist/genui-sandbox`）。
 *
 * 产物形状是固定的四件：`index.html` + `sandbox.js`（经典脚本）+ `sandbox.css`（官方物料样式，
 * 由 esbuild 从 JS 里的 CSS import 收集）+ `sandbox.theme.css`（沙箱自己的卡片外壳样式）。
 * 文件名不带 hash —— 消费方按 `no-cache` 下发，而沙箱 CSP 的 `script-src 'self'`
 * 只认自身源，不需要跨版本共存。
 *
 * 一直是 esbuild：沙箱入口只用 `h()` 组装官方组件，不需要 SFC 编译，而 IIFE 输出正好符合
 * 「经典脚本」这一硬约束（opaque origin 文档里 module script 按 CORS 发起，自定义协议
 * 不放行跨源请求）。三个消费方（`electron/genui/sandboxProtocol.ts`、
 * `electron/genui/sandboxStaticServer.ts` 与 H5 的第二端口）因此都不用改。
 *
 * `repoRoot` 由调用方给出：Vite 会把配置文件打进临时文件再 import，届时
 * `import.meta.url` 不再指向仓库根，靠它反推会算错源目录。
 */
import { build, context } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SANDBOX_ENTRY_FILE = 'sandbox.js'
/** 沙箱自己的外壳样式；`sandbox.css` 这个名字留给 esbuild 产出的物料样式。 */
export const SANDBOX_THEME_FILE = 'sandbox.theme.css'
/**
 * 产物相对仓库根（打包态即相对 app path）的目录。消费方 `electron/genui/sandboxRoot.ts`
 * 按同一个相对路径去找；两边各写一遍就等于等着漂移。
 */
export const SANDBOX_OUT_DIR_REL = join('dist', 'genui-sandbox')
const STATIC_FILES = ['index.html', SANDBOX_THEME_FILE]

/**
 * 物料把图片以 `import x from './x.jpg'` 引进来。沙箱 CSP 放行 `img-src 'self' data:`，
 * 所以内联成 data URL 既不用多一组静态文件，也不会被 CSP 拦。
 */
const ASSET_LOADERS = {
  '.jpg': 'dataurl',
  '.jpeg': 'dataurl',
  '.png': 'dataurl',
  '.gif': 'dataurl',
  '.svg': 'dataurl',
  '.woff': 'dataurl',
  '.woff2': 'dataurl',
  '.ttf': 'dataurl',
}

/**
 * 沙箱入口的构建模式（`mode` 参数）：
 *
 * `production`（默认，也是 `npm run build` 走的那条）把 `__GENUI_DEBUG__` 定成 `false`，
 * esbuild 因此死代码消除掉 `FixtureCard` 调试卡与它那一整块承载自检 —— 生产产物里既不
 * `fetch` 探 `connect-src`，也不 `new Function` 探 `unsafe-eval`（票 09 第 2 条）。
 * `development` 只给 Vite 的 watch 用，自检件留在产物里供肉眼验收。
 */
function sandboxPaths(repoRoot) {
  const sandboxDir = join(repoRoot, 'sandbox')
  return {
    sandboxDir,
    outDir: join(repoRoot, SANDBOX_OUT_DIR_REL),
    entry: join(sandboxDir, 'main.ts'),
    alias: { '@': join(repoRoot, 'src') },
  }
}

function esbuildOptions(repoRoot, outDir, mode) {
  const paths = sandboxPaths(repoRoot)
  return {
    entryPoints: [paths.entry],
    outfile: join(outDir, SANDBOX_ENTRY_FILE),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: false,
    // 物料体积按官方 mini 名单过滤后仍有数 MB，不压缩首帧会明显拖住卡片
    minify: true,
    // Vue 与物料都按 NODE_ENV 选生产分支；沙箱里没有人需要 devtools 提示
    // __GENUI_DEBUG__ 决定调试卡与自检件是否留在产物里，见上面的构建模式说明
    define: {
      'process.env.NODE_ENV': '"production"',
      __GENUI_DEBUG__: mode === 'development' ? 'true' : 'false',
    },
    loader: ASSET_LOADERS,
    alias: paths.alias,
    logLevel: 'warning',
  }
}

async function copyStaticFiles(repoRoot, outDir) {
  const { sandboxDir } = sandboxPaths(repoRoot)
  await mkdir(outDir, { recursive: true })
  await Promise.all(STATIC_FILES.map((name) => copyFile(join(sandboxDir, name), join(outDir, name))))
}

/** 构建一次，返回产物目录。默认生产模式（不含调试件）。 */
export async function buildGenuiSandbox({ repoRoot = process.cwd(), outDir, mode = 'production' } = {}) {
  const target = outDir ?? sandboxPaths(repoRoot).outDir
  await copyStaticFiles(repoRoot, target)
  await build(esbuildOptions(repoRoot, target, mode))
  return target
}

/**
 * 开发期持续构建。返回停止函数，宿主（`vite.config.mts` 的开发插件）在服务关闭时调用。
 * 调试件只在开发产物里，所以这条固定用 development 模式。
 */
export async function watchGenuiSandbox({ repoRoot = process.cwd(), outDir } = {}) {
  const target = outDir ?? sandboxPaths(repoRoot).outDir
  await copyStaticFiles(repoRoot, target)
  const ctx = await context(esbuildOptions(repoRoot, target, 'development'))
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

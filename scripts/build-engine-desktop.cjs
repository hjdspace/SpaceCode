const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

/**
 * 引擎默认 feature 名单由 engine/build-desktop.ts 自己从 engine/scripts/defines.ts 读，
 * 这里只补「引擎默认不开、但客户端产品面依赖」的那几个。名单越界由
 * electron/session/__tests__/sessionProcess.resolveCli.test.ts 拿引擎文件对账拦下。
 */
const CLIENT_ONLY_FEATURES = [
  // src/lib/tool-registry.ts advertises the WebBrowser tool on this flag.
  'WEB_BROWSER_TOOL',
  // BUILDING_CLAUDE_APPS 刻意缺席，不是漏掉：它门控的 claude-api skill 由
  // engine/src/skills/bundled/claudeApiContent.ts 静态 import 26 个 .md，而
  // engine/src/skills/bundled/claude-api/ 整个目录不在仓库里（未被 gitignore，也没有
  // 任何脚本负责拉取）。传上这个开关会让构建以
  // `Could not resolve: "./claude-api/typescript/claude-api/README.md"` 直接失败。
  // 要恢复它，得先把那批内容文件补进仓库。
]

/** build-desktop.ts 只认 FEATURE_<NAME> 环境变量，这里把客户端的 opt-in 名单映射过去。 */
function withClientFeatureEnv(baseEnv) {
  const env = { ...baseEnv }
  for (const feature of CLIENT_ONLY_FEATURES) env[`FEATURE_${feature}`] = '1'
  return env
}

function fail(message, detail) {
  console.error(`[engine-build] ${message}`)
  if (detail) console.error(detail)
  process.exit(1)
}

function versionOf(exe) {
  const r = spawnSync(exe, ['--version'], { encoding: 'utf-8' })
  return r.status === 0 ? String(r.stdout || '').trim() : null
}

function main() {
  const engineDir = resolve(__dirname, '..', 'engine')
  const bundlePath = join(engineDir, 'dist-desktop', 'cli.js')
  const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun'
  const bundledBun = join(engineDir, 'bin', bunName)

  // Step 1: bundle the engine with the client-only opt-ins injected.
  const env = withClientFeatureEnv(process.env)

  console.log(`[engine-build] Building dist-desktop/cli.js (client-only features: ${CLIENT_ONLY_FEATURES.join(', ')})`)
  const build = spawnSync('bun', ['run', 'build-desktop.ts'], { cwd: engineDir, env, encoding: 'utf-8' })
  if (build.status !== 0) fail('engine build failed', build.stderr || build.stdout)
  if (!existsSync(bundlePath)) fail(`expected artifact missing: ${bundlePath}`)

  // Step 2: smoke-test the artifact with the bun that actually ships beside it.
  //
  // 版本下限刻意写成「能不能跑起这个产物」而不是一个数字：build-desktop.ts 用 target:'bun'
  // 且不降级 `using` 等新语法，产物因此跟随构建机的 bun 版本。实测 1.3.10 会在 cli.js 的
  // `using _ = ...` 上抛 SyntaxError，而手写一个 `using` 探测片段在 1.3.10 上反而通过 ——
  // 特性探测预测不了，只有真跑一遍算数。
  const bunVersion = versionOf(bundledBun)
  if (!bunVersion) {
    fail(`bundled bun missing or unusable: ${bundledBun}. Run \`node scripts/copy-bun.cjs --force\` first.`)
  }

  // 从临时目录起，顺带证明产物不依赖 cwd 落在 engine/ 下。
  const smoke = spawnSync(bundledBun, ['run', bundlePath, '--version'], { cwd: tmpdir(), encoding: 'utf-8' })
  if (smoke.status !== 0 || !/\d+\.\d+/.test(String(smoke.stdout || ''))) {
    fail(
      `bundled bun ${bunVersion} cannot run the engine artifact — a stale engine/bin/${bunName} would ship a broken internal engine. Refresh it with \`node scripts/copy-bun.cjs --force\`.`,
      String(smoke.stderr || smoke.stdout || '').slice(0, 2000),
    )
  }

  console.log(`[engine-build] OK — bun ${bunVersion} ran the bundle: ${String(smoke.stdout).trim()}`)
}

if (require.main === module) main()

module.exports = { CLIENT_ONLY_FEATURES, withClientFeatureEnv }

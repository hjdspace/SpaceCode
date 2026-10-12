import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
    },
  },
  css: {
    // 与 vite.config.mts 保持一致：SFC 的 <style lang="scss"> 依赖全局注入的
    // variables/mixins（如 @include scrollbar-thin），缺少注入时挂载组件会编译失败。
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['legacy-js-api'],
        additionalData: '@use "@/styles/variables" as *; @use "@/styles/mixins" as *;',
      },
    },
  },
  test: {
    environment: 'jsdom',
    // `vmThreads` and `threads` both cause segfaults (SIGSEGV) on CI runners
    // (macOS + Linux) due to worker-thread interactions with native modules.
    // `forks` uses child processes instead of threads, which is stable.
    pool: 'forks',
    // 本地全量跑时每个文件独占一个 fork（jsdom 环境约 ~10s 启动开销），
    // 12 核机器默认 11 个并发 fork 会造成 CPU/IO 争用，把原本几秒的
    // 重导入/文件扫描测试拖过超时线（h5MirrorVisibility、orchestrationRun、
    // promptStack 曾因此整套跑必超时，单独跑均通过）。非 CI 环境砍半并发；
    // CI（4 核）保持默认避免拖慢流水线。
    maxWorkers: process.env.CI ? undefined : '50%',
    // A few tests do genuinely slow work (cold module graph imports, component
    // mounts, filesystem scans) and can exceed the default timeout under load.
    // One retry absorbs that without hiding a deterministic failure.
    retry: 1,
    // Keep these patterns broad. Enumerating individual subdirectories is how
    // the previous config silently stopped running 22 test files — a new
    // `tests/<dir>/` or `electron/<dir>/file.test.ts` must never fall through.
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'electron/**/*.test.ts',
    ],
    coverage: {
      // Vitest 3+ removed `coverage.all`: files matching `include` are always
      // counted, so files never imported still report as 0% — that is the
      // point: this is the list of untested code, not a list of code the tests
      // happened to reach.
      // Scope the denominator to shipped source only. Otherwise the default
      // include sweeps in assets and .d.ts as 0% files (the first report
      // listed 418 of 633 entries as dead, most of them .svg/.woff2) and hides
      // real gaps.
      include: ['src/**/*.{ts,vue}', 'electron/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/__tests__/**',
        // ~140 files of locale literals: data, not logic.
        'src/i18n/locales/**',
      ],
      reporter: ['html', 'json', 'text-summary'],
      // Ratchet, not aspiration. Floors are pinned to the committed baseline
      // (213 files: 30.0% statements / 24.3% branches) so they forbid
      // regression without demanding a rewrite; the global pair also catches a
      // brand-new module merged at 0%. Raise each in step with the coverage
      // plan; delete a floor only together with the tests that earned it.
      thresholds: {
        statements: 31,
        branches: 25,
        'src/lib/**': { statements: 80 }, // 83.9% (trace/sse + request 解析后)
        'src/utils/**': { statements: 65 }, // 67.2%
        'src/stores/**': { statements: 44 }, // 45.9%
        'src/services/**': { statements: 37 }, // 37.6% (teamTranscriptService 子代理转录归一化与轮询)
        'electron/cron/**': { statements: 70 }, // 72.7%
        'electron/engine/**': { statements: 20 }, // 21.5% (cliDetector 探测层)
        'electron/im/**': { statements: 52 }, // 52.2% (feishuAdapter 事件链路补齐后的下界)
        'electron/session/**': { statements: 42 }, // 42.2% (turnCheckpointService 检查点/rewind 全链路)
        'electron/tools/**': { statements: 24 }, // 24.4% (探测/定位/RTK 统计与 hook 判定)
        'electron/skillManagerV2/**': { statements: 72 }, // 74.8%
      },
    },
  },
})

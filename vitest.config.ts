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
  test: {
    environment: 'jsdom',
    // `vmThreads` and `threads` both cause segfaults (SIGSEGV) on CI runners
    // (macOS + Linux) due to worker-thread interactions with native modules.
    // `forks` uses child processes instead of threads, which is stable.
    pool: 'forks',
    // A few tests do genuinely slow work (cold module graph imports, component
    // mounts, filesystem scans) and can exceed the default timeout under load.
    // One retry absorbs that without hiding a deterministic failure.
    retry: 1,
    // Keep these patterns broad. Enumerating individual subdirectories is how
    // the previous config silently stopped running 22 test files — a new
    // `tests/<dir>/` or `electron/<dir>/__tests__/` must never fall through.
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'electron/**/__tests__/**/*.test.ts',
    ],
  },
})

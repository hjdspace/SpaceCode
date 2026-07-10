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
    include: [
      'electron/__tests__/**/*.test.ts',
      'electron/design/__tests__/**/*.test.ts',
      'electron/im/**/__tests__/**/*.test.ts',
      'tests/composables/**/*.test.ts',
      'tests/im/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Old tests using Node.js native test runner (not vitest compatible)
      'tests/composables/useChatCommands.rewind.test.ts',
    ],
  },
})

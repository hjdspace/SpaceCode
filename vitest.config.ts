import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: [
      'electron/__tests__/**/*.test.ts',
      'tests/composables/**/*.test.ts',
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

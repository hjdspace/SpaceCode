import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        __INTLIFY_JIT_COMPILATION__: 'true',
        __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
      },
    },
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    }),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          css: {
            preprocessorOptions: {
              scss: {
                api: 'modern-compiler',
                silenceDeprecations: ['legacy-js-api'],
              }
            }
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
                'node-pty',
                '@mariozechner/pi-coding-agent',
                '@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-client.js',
                '@mariozechner/pi-agent',
                '@mariozechner/pi-ai',
                '@mariozechner/pi-tui',
                /^@mariozechner\/.*/
              ]
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          css: {
            preprocessorOptions: {
              scss: {
                api: 'modern-compiler',
                silenceDeprecations: ['legacy-js-api'],
              }
            }
          },
          build: {
            outDir: 'dist-electron'
          }
        }
      },
      {
        entry: 'electron/petPreload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'pet-window': resolve(__dirname, 'pet-window.html'),
      },
      external: ['@mariozechner/pi-coding-agent'],
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (/\/src\/stores\/(chat|chatSession|turn)\.ts$/.test(normalizedId)) {
            return 'stores-chat'
          }
          // Large optional libraries stay out of the application chunk.
          if (id.includes('node_modules/katex')) {
            return 'vendor-katex'
          }
          if (id.includes('node_modules/lucide')) {
            return 'vendor-icons'
          }
          if (id.includes('node_modules/marked')) {
            return 'vendor-markdown'
          }
          // Vue 核心库
          if (id.includes('node_modules/vue') || id.includes('node_modules/pinia') || id.includes('node_modules/vue-i18n')) {
            return 'vendor-vue'
          }
          // Electron 相关
          if (id.includes('electron')) {
            return 'vendor-electron'
          }
        }
      }
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        silenceDeprecations: ['legacy-js-api'],
        additionalData: `@use "@/styles/variables" as *; @use "@/styles/mixins" as *;`
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})

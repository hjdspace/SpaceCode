import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __INTLIFY_DROP_MESSAGE_COMPILER__: false,
  },
  // Vite 8: esbuildOptions 已废弃，使用 rolldownOptions.transform.define
  optimizeDeps: {
    rolldownOptions: {
      transform: {
        define: {
          __INTLIFY_JIT_COMPILATION__: 'true',
          __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
        },
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
                silenceDeprecations: ['legacy-js-api'],
              }
            }
          },
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
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
    ])
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
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'pet-window': resolve(__dirname, 'pet-window.html'),
      },
      external: ['@mariozechner/pi-coding-agent'],
      output: {
        // Vite 8: manualChunks 已废弃，使用 codeSplitting.groups 替代
        // 通过 priority 确保高优先级组先匹配（数值越大优先级越高）
        codeSplitting: {
          groups: [
            // 业务代码：聊天相关 stores 单独打包
            {
              name: 'stores-chat',
              test: /src[\\/]stores[\\/](chat|chatSession|turn)\.ts$/,
              priority: 30,
            },
            // 第三方库：按大小和类型分组（priority 从高到低匹配）
            {
              name: 'vendor-katex',
              test: /node_modules[\\/]katex/,
              priority: 25,
            },
            {
              name: 'vendor-icons',
              test: /node_modules[\\/]lucide/,
              priority: 24,
            },
            {
              name: 'vendor-markdown',
              test: /node_modules[\\/]marked/,
              priority: 23,
            },
            {
              name: 'vendor-vue',
              test: /node_modules[\\/](vue|pinia|vue-i18n)/,
              priority: 22,
            },
          ],
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
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

import { defineConfig, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'
import { watchGenuiSandbox } from './scripts/genui-sandbox-build.mjs'

// Electron-based IDEs (CatPaw, VS Code, etc.) set ELECTRON_RUN_AS_NODE=1 in their
// integrated terminals. This causes vite-plugin-electron to spawn Electron as plain
// Node.js, where require("electron") returns a string path instead of the module
// object — crashing the main process on startup. Remove it so Electron runs normally.
delete process.env.ELECTRON_RUN_AS_NODE

/**
 * 开发期持续构建卡片沙箱产物（`dist/genui-sandbox`）。
 *
 * 主进程在 dev 下把这份产物服务在 `http://localhost:5174`（与主窗口换主机名才换 site），
 * 打包环境由 `spacecode-genui://` 协议服务同一份文件 —— 两侧加载的是同一个东西，
 * 开发时看到的 opaque origin、断网与禁导航，打包后必然一致。
 *
 * 沙箱文档不设 Vite dev 实例：opaque origin 里 module script 走 CORS，
 * 且 dev 客户端的 HMR WebSocket 会被沙箱 CSP 的 `connect-src 'none'` 挡掉。
 */
function genuiSandboxDevBuild() {
  return {
    name: 'genui-sandbox-dev-build',
    apply: 'serve',
    async configureServer(server: ViteDevServer) {
      const repoRoot = import.meta.dirname
      const stop = await watchGenuiSandbox({ repoRoot })
      console.log('[genui-sandbox] watching sandbox -> dist/genui-sandbox')
      const close = () => {
        void stop()
      }
      server.httpServer?.on('close', close)
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close)
    },
  }
}

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
    genuiSandboxDevBuild(),
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
                'better-sqlite3',
                '@earendil-works/pi-coding-agent',
                '@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-client.js',
                '@earendil-works/pi-agent',
                '@earendil-works/pi-ai',
                '@earendil-works/pi-tui',
                /^@earendil-works\/.*/
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
      },
      {
        // Proxy server as a separate entry — compiled to dist-electron/proxy/index.js
        // so that ProxyManager.resolveProxyScript() finds it in dev mode without
        // needing tsx loader (which can time out under ELECTRON_RUN_AS_NODE).
        entry: 'electron/proxy/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/proxy',
            rolldownOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        // Streaming ASR worker — compiled to dist-electron/voice/asrWorker.js so
        // SherpaWorkerEngine finds it next to the main bundle. The native addon
        // and its platform package ship in node_modules and must stay external.
        entry: 'electron/voice/asrWorker.ts',
        vite: {
          build: {
            outDir: 'dist-electron/voice',
            rolldownOptions: {
              external: ['sherpa-onnx-node', /^sherpa-onnx-/]
            }
          }
        }
      }
    ])
  ],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // lowlight 瘦身 shim：@git-diff-view 全量语言注册 → common 子集（见 src/lib/lowlight.ts）
      lowlight: resolve(import.meta.dirname, 'src/lib/lowlight.ts')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'pet-window': resolve(import.meta.dirname, 'src/pet-window/index.html'),
      },
      external: ['@earendil-works/pi-coding-agent'],
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
    strictPort: true,
    // resources/ 是打包进应用的静态资源（officecli 二进制、skills-lib 等），
    // 无需 HMR；且其中的 exe 可能被运行中的进程锁定，fs.watch 会抛 EBUSY 崩掉 dev server。
    // .spacecode/ 是 factory 的运行时目录，工作树是整份仓库副本 —— 监控它会把 engine/
    // 的数百个 tsconfig 拉进来触发全量 reload，并让工作树里的文件保持打开、删不干净。
    watch: {
      ignored: ['**/resources/**', '**/.spacecode/**']
    }
  }
})

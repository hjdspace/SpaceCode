import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
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
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // 与主配置一致：预览页加载真实 SFC 时需要同一个 lowlight 瘦身 shim
      lowlight: resolve(__dirname, 'src/lib/lowlight.ts')
    }
  },
  // 与主配置一致：真实 SFC 的 scoped SCSS 依赖全局注入的 variables/mixins
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
    port: 5174,
    strictPort: true
  }
})

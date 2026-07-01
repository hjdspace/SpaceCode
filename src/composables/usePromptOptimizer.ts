/**
 * usePromptOptimizer - 提示词优化逻辑，从 ChatInput.vue 中抽取
 *
 * 职责：
 * - 管理 isOptimizing 状态
 * - 调用 Electron 主进程的 LLM API 进行提示词优化
 * - 错误处理与日志
 *
 * 该 composable 通过 IPC 调用 `electron/promptOptimizerIPC.ts` 中的实现，
 * 后者直接读取 GUI 设置并调用配置的 LLM 提供商（Anthropic / OpenAI / Gemini），
 * 完全不依赖 engine 子项目，因此切换引擎不会影响此功能。
 */
import { ref } from 'vue'
import { api } from '@/services/electronAPI'

export interface OptimizePromptOptions {
  /** 当前工作目录，用于注入项目上下文到系统提示词 */
  workingDirectory?: string
}

export interface OptimizePromptResult {
  success: boolean
  result?: string
  error?: string
}

export function usePromptOptimizer() {
  const isOptimizing = ref(false)

  /**
   * 优化提示词
   *
   * @param prompt 用户输入的原始提示词
   * @param options 可选参数（workingDirectory 等）
   * @returns 优化结果
   */
  async function optimizePrompt(
    prompt: string,
    options?: OptimizePromptOptions,
  ): Promise<OptimizePromptResult> {
    const text = (prompt || '').trim()
    if (!text) return { success: false, error: 'Prompt cannot be empty' }
    if (isOptimizing.value) return { success: false, error: 'Optimization already in progress' }

    isOptimizing.value = true

    try {
      const result = await api.optimizePrompt(text, options)
      if (!result.success) {
        console.error('Prompt optimization failed:', result.error)
      }
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('Prompt optimization error:', error)
      return { success: false, error: msg }
    } finally {
      isOptimizing.value = false
    }
  }

  return {
    isOptimizing,
    optimizePrompt,
  }
}

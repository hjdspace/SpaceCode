export interface PromptOptimizerResult {
  success: boolean
  optimizedPrompt?: string
  error?: string
}

export interface OptimizePromptOptions {
  prompt: string
  model?: string
  maxTokens?: number
}

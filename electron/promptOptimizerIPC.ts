import { ipcMain } from 'electron'
import { info, error, debug } from './logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OptimizerResult = { success: true; optimizedPrompt?: string } | { success: false; error?: string }

export async function optimizePrompt(prompt: string): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    debug('PromptOptimizer', `Optimizing prompt | length=${prompt.length}`)
    // Use createRequire to avoid TypeScript module resolution
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optimizer = require('../engine/src/commands/prompt-optimizer/optimizer.js') as any
    const result: OptimizerResult = await optimizer.optimizePrompt({ prompt })
    
    if (result.success) {
      info('PromptOptimizer', `Optimization successful | original=${prompt.length} | optimized=${result.optimizedPrompt?.length || 0}`)
      return {
        success: true,
        result: result.optimizedPrompt,
      }
    } else {
      error('PromptOptimizer', `Optimization failed | ${result.error}`)
      return {
        success: false,
        error: result.error,
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    error('PromptOptimizer', `Exception during optimization`, { error: errorMessage })
    return {
      success: false,
      error: errorMessage,
    }
  }
}

export function registerPromptOptimizerIPC() {
  info('PromptOptimizer', 'Registering IPC handler')
  
  ipcMain.handle('prompt-optimizer:optimize', async (_event, prompt: string) => {
    return optimizePrompt(prompt)
  })
}

import { ipcMain } from 'electron'
import { info, error, debug } from './logger'

export async function optimizePrompt(prompt: string): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    debug('PromptOptimizer', `Optimizing prompt | length=${prompt.length}`)
    const { optimizePrompt: optimize } = await import('../engine/src/commands/prompt-optimizer/optimizer.js')
    const result = await optimize({ prompt })
    
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

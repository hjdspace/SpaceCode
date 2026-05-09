import type { Command } from '../../types/command.js'
import { optimizePrompt } from './optimizer.js'

const promptOptimizer: Command = {
  type: 'local',
  name: 'prompt-optimizer',
  description: 'Optimize user prompts for better AI responses',
  supportsNonInteractive: true,
  async load() {
    return {
      call: async (args: string) => {
        const result = await optimizePrompt({ prompt: args })

        if (!result.success) {
          return { type: 'text' as const, value: `Error: ${result.error}` }
        }

        return {
          type: 'text' as const,
          value: result.optimizedPrompt || args,
        }
      },
    }
  },
}

export default promptOptimizer

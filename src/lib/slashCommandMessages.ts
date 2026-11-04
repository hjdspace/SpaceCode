/**
 * 斜杠命令的回复文案生成器（T04 #74）—— 从 ChatPanel 原样抽出为纯函数。
 * 主聊天与 Super Agent Router 等宿主共用同一份，保证 /help、/cost、/keybindings
 * 的输出在所有宿主逐字一致（零副本）。
 */
import type { Message } from '@/types'
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'

export type Translate = (key: string) => string

export function generateHelpMessage(t: Translate): string {
  const immediate = BUILT_IN_COMMANDS.filter((c) => c.immediate || c.kind === 'immediate')
  const sdk = BUILT_IN_COMMANDS.filter((c) => c.kind === 'sdk_command')
  const codepilot = BUILT_IN_COMMANDS.filter((c) => c.kind === 'codepilot_command')

  return `## ${t('chatPanel.helpTitle')}

### ${t('chatPanel.helpInstant')}
${immediate.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpSdk')}
${sdk.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpCodepilot')}
${codepilot.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpCustomSkills')}
${t('chatPanel.helpCustomSkillsDesc')}

**${t('chatPanel.helpTips')}**:
- ${t('chatPanel.helpTipBrowse')}
- ${t('chatPanel.helpTipMention')}
- ${t('chatPanel.helpTipNewline')}
- ${t('chatPanel.helpTipProject')}`
}

export function generateCostMessage(messages: Message[], t: Translate): string {
  let totalInput = 0
  let totalOutput = 0
  let turnCount = 0

  for (const msg of messages) {
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const content = msg.content || ''
    const estimatedTokens = Math.ceil(content.length / 4)

    if (msg.role === 'user') {
      totalInput += estimatedTokens
    } else if (msg.role === 'assistant') {
      totalOutput += estimatedTokens
      turnCount++
    }
  }

  const totalTokens = totalInput + totalOutput

  if (turnCount === 0) {
    return `## ${t('chatPanel.costTitle')}\n\n${t('chatPanel.costNoMessages')}`
  }

  return `## ${t('chatPanel.costTitleEstimated')}

| ${t('chatPanel.costMetric')} | ${t('chatPanel.costCount')} |
|--------|-------|
| ${t('chatPanel.costInputTokens')} | ${totalInput.toLocaleString()} |
| ${t('chatPanel.costOutputTokens')} | ${totalOutput.toLocaleString()} |
| **${t('chatPanel.costTotalTokens')}** | **${totalTokens.toLocaleString()}** |
| ${t('chatPanel.costTurns')} | ${turnCount} |

*${t('chatPanel.costNote')}*`
}

export function generateKeybindingsMessage(t: Translate): string {
  return `## ${t('chatPanel.keybindingsTitle')}

| ${t('chatPanel.keybindingsShortcut')} | ${t('chatPanel.keybindingsAction')} |
|----------|--------|
| Enter | ${t('chatPanel.keybindingsSendMessage')} |
| Shift+Enter | ${t('chatPanel.keybindingsNewLine')} |
| / | ${t('chatPanel.keybindingsCommandPalette')} |
| @ | ${t('chatPanel.keybindingsMentionFile')} |
| Escape | ${t('chatPanel.keybindingsCloseMenu')} |
| ↑↓ | ${t('chatPanel.keybindingsNavigate')} |
| Tab | ${t('chatPanel.keybindingsAcceptSuggestion')} |
| Ctrl+Z | ${t('chatPanel.keybindingsUndo')} |`
}

/**
 * 选中内容 AI 处理服务 — 解释/润色/缩短/语气/语法/自定义改写。
 * 复用直接 LLM API 通道 (services/llm.ts), 与 AI 提交消息生成同一路径。
 */

import { initLLMService, isLLMConfigured, sendMessage } from '@/services/llm'
import { useSettingsStore } from '@/stores/settings'

export type SelectionActionType = 'explain' | 'improve' | 'shorten' | 'tone' | 'grammar' | 'custom'

export interface SelectionAIContext {
  type: SelectionActionType
  selectedText: string
  /** type === 'custom' 时的用户指令 */
  customInstruction?: string
  /** 代码文件中的选区(改写需保持代码正确性, 结果剥代码围栏) */
  isCode: boolean
  locale: string
  fileName?: string
}

async function ensureLLMConfigured(): Promise<void> {
  if (isLLMConfigured()) return
  const settingsStore = useSettingsStore()
  const cfg = settingsStore.config
  if (cfg.apiKey) {
    await initLLMService({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
    return
  }
  const authMethod = settingsStore.authMethod
  if (authMethod === 'claudeai' || authMethod === 'console') {
    throw new Error('AI 处理选中内容需要 API Key 认证。当前使用的是 OAuth 认证方式，不支持直接调用 API。请在设置中切换到 Anthropic 兼容协议并填写 API Key。')
  }
  throw new Error('LLM not configured. Please set API key in Settings.')
}

export function buildSelectionMessages(ctx: SelectionAIContext): Array<{ role: string; content: string }> {
  const isZh = ctx.locale === 'zh-CN'
  const fenced = ctx.isCode ? `\`\`\`\n${ctx.selectedText}\n\`\`\`` : ctx.selectedText
  const fileHint = ctx.fileName ? (isZh ? `\n\n（来自文件：${ctx.fileName}）` : `\n\n(From file: ${ctx.fileName})`) : ''

  if (ctx.type === 'explain') {
    const system = isZh
      ? '你是技术解释助手。用简体中文简洁解释用户提供的内容，可以使用 markdown 格式。直接给出解释，不要开场白。'
      : 'You are a technical explanation assistant. Explain the provided content concisely in English using markdown. Give the explanation directly, no preamble.'
    return [{ role: 'user', content: `请解释以下内容：\n\n${fenced}${fileHint}` }]
  }

  const actionText: Record<Exclude<SelectionActionType, 'explain'>, { zh: string; en: string }> = {
    improve: { zh: '改进这段文字的表达，使其更清晰、专业、流畅', en: 'Improve the writing to make it clearer, more professional and fluent' },
    shorten: { zh: '缩短这段文字，保留核心含义', en: 'Shorten the text while keeping its core meaning' },
    tone: { zh: '调整这段文字的语气，使其更正式专业', en: 'Adjust the tone to be more formal and professional' },
    grammar: { zh: '修正这段文字中的语法和拼写错误', en: 'Fix grammar and spelling mistakes in the text' },
    custom: { zh: `按以下要求处理这段文字：${ctx.customInstruction || ''}`, en: `Edit the text as follows: ${ctx.customInstruction || ''}` },
  }
  const task = isZh ? actionText[ctx.type].zh : actionText[ctx.type].en
  const codeRule = ctx.isCode
    ? (isZh
      ? '这是代码，改写时必须保持代码正确性（仅允许注释/字符串内的措辞调整），只输出替换后的代码。'
      : 'This is code. Preserve code correctness (only wording inside comments/strings may change) and output only the replacement code.')
    : (isZh
      ? '只输出改写后的文本，不要任何解释、引号或代码围栏。'
      : 'Output ONLY the rewritten text — no explanations, no surrounding quotes, no code fences.')

  const system = isZh
    ? `你是专业编辑助手。${codeRule}`
    : `You are a professional editor. ${codeRule}`
  return [{ role: 'user', content: `${task}：\n\n${fenced}${fileHint}` }]
}

/** LLM 对代码改写常自作主张包一层 ``` 围栏, 输出前剥掉 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  return match ? match[1] : trimmed
}

export async function runSelectionAction(ctx: SelectionAIContext): Promise<string> {
  await ensureLLMConfigured()
  const maxTokens = Math.min(4096, Math.max(1024, Math.round(ctx.selectedText.length * 1.5) + 512))
  const result = await sendMessage(buildSelectionMessages(ctx), { maxTokens })
  return ctx.isCode && ctx.type !== 'explain' ? stripCodeFence(result) : result.trim()
}

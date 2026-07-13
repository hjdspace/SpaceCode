// electron/petLLMProxy.ts
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { info, warn } from './logger'
import type { PetReactionRequest, PetReactionTrigger } from '../src/types/pet'

// gui-settings.json 中的 provider config 形状（仅取 pet 关心的字段）
interface ProviderConfig {
  baseUrl?: string
  apiKey?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

interface GuiSettings {
  authMethod?: string
  anthropicConfig?: ProviderConfig
  openaiConfig?: ProviderConfig
  geminiConfig?: ProviderConfig
}

const MAX_REACTION_LENGTH = 100
const MAX_RECENT_REACTIONS = 8
const SIMILARITY_THRESHOLD = 0.7
const REQUEST_TIMEOUT_MS = 10_000

export const TRIGGER_DESCRIPTION: Record<PetReactionTrigger, string> = {
  idle: '用户有一会儿没操作了',
  typing: '用户正在输入代码',
  error: '刚刚发生了错误（工具调用失败或编译错误）',
  success: '刚刚完成了一个任务',
  petted: '用户点击了你（撸宠物）'
}

export function buildSystemPrompt(req: PetReactionRequest): string {
  return `你是 ${req.petName}，一只陪伴程序员写代码的桌面宠物。

你的人设：${req.personality}

请用一句话（不超过 30 字）回应当前的编程场景。要求：
- 符合你的人设和性格
- 简短、自然、有趣
- 不要解释你在做什么，直接说话
- 可以用 emoji，但不要过度

当前场景触发：${TRIGGER_DESCRIPTION[req.trigger]}

最近对话上下文：
${req.recentMessages.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n') || '（无）'}

请直接输出 ${req.petName} 会说的一句话，不要加引号、不要加角色名前缀。`
}

export function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

export function getBigrams(text: string): string[] {
  const bigrams: string[] = []
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text.slice(i, i + 2))
  }
  return bigrams
}

export function isSimilar(a: string, b: string, threshold: number): boolean {
  if (a === b) return true
  const bigramsA = new Set(getBigrams(a))
  const bigramsB = new Set(getBigrams(b))
  const intersection = [...bigramsA].filter(x => bigramsB.has(x)).length
  const union = new Set([...bigramsA, ...bigramsB]).size
  return union > 0 && (intersection / union) >= threshold
}

interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function loadGuiSettings(): GuiSettings | null {
  try {
    const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
    if (!existsSync(settingsPath)) return null
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as GuiSettings
  } catch {
    return null
  }
}

function loadPetAiModel(): string | null {
  try {
    const petPath = join(app.getPath('home'), '.claude', 'buddy-pets.json')
    if (!existsSync(petPath)) return null
    const raw = readFileSync(petPath, 'utf-8')
    if (!raw.trim()) return null
    const parsed = JSON.parse(raw)
    const model = parsed?.settings?.aiModel
    return typeof model === 'string' && model ? model : null
  } catch {
    return null
  }
}

function getProviderConfig(gui: GuiSettings): ProviderConfig | undefined {
  const method = gui.authMethod || 'openai_compatible'
  if (method === 'openai_compatible') return gui.openaiConfig
  if (method === 'gemini_api') return gui.geminiConfig
  return gui.anthropicConfig
}

export async function loadLLMConfig(): Promise<LLMConfig | null> {
  const gui = loadGuiSettings()
  if (!gui) return null

  const cfg = getProviderConfig(gui)
  if (!cfg?.apiKey || !cfg?.baseUrl) return null

  // 统一从当前 provider 的三槽位提取模型（openai/gemini/anthropic 均使用相同字段）
  const model = loadPetAiModel() || cfg.sonnetModel || cfg.haikuModel || cfg.opusModel || ''
  if (!model) return null

  return {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model
  }
}

async function callLLM(systemPrompt: string, config: LLMConfig): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请生成反应' }
        ],
        max_tokens: 50,
        temperature: 0.8
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) {
      warn('PetLLMProxy', `LLM API returned ${response.status}`)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    return content?.trim() || null
  } catch (err) {
    warn('PetLLMProxy', `LLM call failed: ${err}`)
    return null
  }
}

export class PetLLMProxy {
  private recentReactions: string[] = []

  async generateReaction(req: PetReactionRequest): Promise<string | null> {
    const config = await loadLLMConfig()
    if (!config || !config.apiKey) {
      warn('PetLLMProxy', 'No API key configured')
      return null
    }

    const systemPrompt = buildSystemPrompt(req)
    let reaction = await callLLM(systemPrompt, config)

    if (!reaction) return null

    if (this.recentReactions.some(r => isSimilar(r, reaction!, SIMILARITY_THRESHOLD))) {
      info('PetLLMProxy', 'Reaction too similar, retrying')
      const retry = await callLLM(systemPrompt + '\n\n（请与之前不同）', config)
      if (retry) reaction = retry
    }

    const truncated = truncate(reaction, MAX_REACTION_LENGTH)

    this.recentReactions.push(truncated)
    if (this.recentReactions.length > MAX_RECENT_REACTIONS) {
      this.recentReactions.shift()
    }

    return truncated
  }
}

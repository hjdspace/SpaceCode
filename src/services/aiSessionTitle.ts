import { initLLMService, sendMessage } from '@/services/llm'
import { useSettingsStore } from '@/stores/settings'

const MAX_TITLE_INPUT_CHARS = 2000
const MAX_TITLE_LENGTH = 40
// 推理型网关会先把 completion 预算花在 reasoning_content 上；预算一小就出现
// finish_reason=length 而 content 始终为空，标题永远取不到（glm / deepseek-r1 等）。
const TITLE_MAX_TOKENS = 1024
const TITLE_TIMEOUT_MS = 30_000
// 标题是后台补写，重试两次拿不到就放弃，不做多次烧 token 的重试风暴。
const TITLE_MAX_RETRIES = 1
const NO_TITLE_SENTINELS = new Set(['none', 'null', '无', '没有'])

// 中文没有空格分词，TITLE_WORD 会把整段连续文字切成一个 token，
// 所以词表命中的是「首句本身就是一句寒暄」这种最省钱的场景。
const FILLER_TITLE_TOKENS = new Set([
  'hi', 'hello', 'hey', 'yo', 'sup', 'thanks', 'thank', 'you', 'ok', 'okay',
  'yes', 'no', 'sure', 'good', 'great', 'fine', 'nice', 'cool', 'test', 'testing',
  'what', 'how', 'why', 'please', 'help', 'continue', 'proceed', 'yeah', 'yup',
  'nope', 'uh', 'um', 'hmm', 'oh', 'ah',
  '你好', '您好', '哈喽', '嗨', '在吗', '在么', '在不在', '谢谢', '感谢', '多谢',
  '好的', '好', '行', '可以', '嗯', '哦', '噢', '是的', '对', '知道了', '收到',
  '继续', '测试', '试试', '帮助', '请问', '这个', '那个', '我们',
])

const FENCED_CODE_BLOCK = /```+[\s\S]*?(?:```+|$)/g
const TITLE_WORD = /[\p{L}\p{N}]+/gu
const HAS_WORD = /[\p{L}\p{N}]/u

export function stripCodeBlocks(message: string): string {
  const cleaned = message
    .replace(FENCED_CODE_BLOCK, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // 整条消息就是代码时剥完不剩文字，此时原文更有信息量
  return HAS_WORD.test(cleaned) ? cleaned : message
}

export function isLowSignalInput(message: string): boolean {
  const tokens = stripCodeBlocks(message).toLowerCase().match(TITLE_WORD)
  if (!tokens) return true
  return tokens.every(token => FILLER_TITLE_TOKENS.has(token) || /^\d+$/.test(token))
}

function prepareTitleInput(message: string): string {
  const stripped = stripCodeBlocks(message)
  if (stripped.length > MAX_TITLE_INPUT_CHARS) {
    return stripped.slice(0, MAX_TITLE_INPUT_CHARS) + '…'
  }
  return stripped
}

export function buildSessionTitlePrompt(userMessage: string, isZh: boolean): { system: string; user: string } {
  const input = prepareTitleInput(userMessage)
  if (isZh) {
    return {
      system: '你是一个会话标题生成器。根据用户的第一条消息，生成一个简短的中文标题（不超过 16 个字）。只输出标题文本，不要引号、标点或解释。如果消息只是打招呼或没有实质内容，输出 "none"。',
      user: `用户消息:\n${input}\n\n请生成一个简短的会话标题:`,
    }
  }
  return {
    system: 'You are a session title generator. From the user\'s first message, produce a short title (at most 6 words). Output only the title text — no quotes, no trailing punctuation, no explanation. If the message is just a greeting or has no substance, output "none".',
    user: `User message:\n${input}\n\nGenerate a short session title:`,
  }
}

export function normalizeGeneratedTitle(value: string | null | undefined): string | null {
  const firstLine = value?.trim().split(/\r?\n/, 1)[0]?.trim()
  if (!firstLine) return null
  const title = firstLine
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/^(标题|Title)\s*[:：]\s*/i, '')
    .replace(/^[-*#]\s*/, '')
    .replace(/[.!?。！？]+$/, '')
    // 句末标点剥掉后可能露出被它包住的闭引号
    .replace(/["'“”‘’]+$/, '')
    .trim()
  if (!title || NO_TITLE_SENTINELS.has(title.toLowerCase())) return null
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}...` : title
}

export async function generateSessionTitle(userMessage: string, isZh: boolean): Promise<string | null> {
  if (isLowSignalInput(userMessage)) return null

  const settings = useSettingsStore()
  const cfg = settings.config
  // claudeai / console 是 OAuth 登录，config.apiKey 为空、无法直连 API —— 静默保留截取名
  if (!cfg.apiKey) return null
  await initLLMService({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })

  // config.model 走的是会话主模型，给它起标题太贵；改用设置里的 haiku（快速）模型，未配置时回退主模型。
  const titleModel = settings.getHaikuModel() || cfg.model

  const prompt = buildSessionTitlePrompt(userMessage, isZh)
  try {
    const raw = await sendMessage([{ role: 'user', content: prompt.user }], {
      system: prompt.system,
      model: titleModel,
      maxTokens: TITLE_MAX_TOKENS,
      timeoutMs: TITLE_TIMEOUT_MS,
      maxRetries: TITLE_MAX_RETRIES,
    })
    const title = normalizeGeneratedTitle(raw)
    if (!title) {
      console.warn(`[aiSessionTitle] 模型未产出可用标题 (model=${titleModel}, rawLength=${raw.length})`)
    }
    return title
  } catch (err) {
    console.warn('[aiSessionTitle] generation failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

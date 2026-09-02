/**
 * AI commit message generation — extracted from the SCM store so the LLM
 * prompt construction is testable in isolation and the store stays thin.
 */
import { api } from '@/services/electronAPI'
import { sendMessage as sendLLMMessage, initLLMService, isLLMConfigured } from '@/services/llm'
import { useSettingsStore } from '@/stores/settings'
import type { ScmFile, ScmLogEntry } from '@/stores/scm'

interface PromptInput {
  diff: string
  recentSubjects: string[]
  changedFiles: string[]
  isZh: boolean
}

export function buildCommitMessagePrompt(input: PromptInput): { system: string; user: string } {
  const { diff, recentSubjects, changedFiles, isZh } = input
  const recentCommits = recentSubjects.join('\n')
  const changedFilesText = changedFiles.map(f => `  ${f}`).join('\n')

  const systemPrompt = isZh
    ? `你是一位专业的 Git 提交信息撰写专家。你需要根据代码变更生成高质量、规范的中文提交信息。

## 输出格式要求
- 使用 Conventional Commits 规范：type(scope): subject
- type 包括：feat / fix / refactor / docs / style / test / chore / perf / ci / build
- scope 为可选，表示影响范围（模块、组件、功能区域等）
- subject 使用中文，简明扼要描述"做了什么"，不超过 72 个字符
- 必须在 subject 空一行后添加 body，用编号列表逐条说明关键变更：
  1. 每条说明一个具体的改动点
  2. 描述改动的目的和影响
  3. 条目数量根据实际变更复杂度决定，至少1条
- 仅输出提交信息本身，不要输出任何解释、分析或额外文字

## 示例
feat(登录): 新增微信扫码登录功能

1. 实现微信扫码OAuth2.0认证流程
2. 添加登录页面二维码组件及自动刷新逻辑
3. 集成后端回调接口完成用户自动绑定

fix(支付): 修复订单金额计算精度丢失的问题

1. 将浮点数运算替换为BigDecimal精确计算
2. 修复折扣叠加时金额溢出的边界情况

refactor(路由): 将路由配置从硬编码改为动态加载

1. 抽取路由表为独立配置文件，支持按模块拆分
2. 实现路由守卫的插件化注册机制
3. 提升路由模块的可维护性，支持插件动态注册路由

chore(deps): 升级 vite 至 5.4 版本

1. 更新vite及相关插件版本至5.4以修复HMR缓存泄漏
2. 适配vite配置breaking change`
    : `You are an expert Git commit message writer. Generate high-quality, well-structured commit messages based on code changes.

## Output Format Requirements
- Use Conventional Commits format: type(scope): subject
- Types: feat / fix / refactor / docs / style / test / chore / perf / ci / build
- scope is optional, indicating the affected area (module, component, feature, etc.)
- subject should concisely describe "what was done", max 72 characters
- Always add a body after a blank line, using a numbered list to detail key changes:
  1. Each item describes a specific change
  2. Explain the purpose and impact of the change
  3. Number of items depends on change complexity, at least 1
- Output ONLY the commit message, no explanations or extra text

## Examples
feat(auth): add WeChat QR code login

1. Implement WeChat OAuth2.0 authentication flow
2. Add QR code component with auto-refresh logic on login page
3. Integrate backend callback for automatic user binding

fix(payment): fix order amount precision loss

1. Replace floating-point arithmetic with BigDecimal precise calculation
2. Fix edge case of amount overflow when stacking discounts

refactor(router): migrate route config from hardcoded to dynamic loading

1. Extract route table into independent config files with module-level splitting
2. Implement plugin-based route guard registration mechanism
3. Improve router maintainability and support dynamic plugin route registration

chore(deps): upgrade vite to v5.4

1. Update vite and related plugins to v5.4 to fix HMR cache leak
2. Adapt to vite config breaking changes`

  const userPrompt = isZh
    ? `## 最近的提交记录（用于参考风格）：
${recentCommits || '（暂无提交记录）'}

## 变更文件列表：
${changedFilesText}

## Git Diff：
${diff.substring(0, 16000)}${diff.length > 16000 ? '\n... (已截断)' : ''}

请根据以上变更生成提交信息。`
    : `## Recent commit messages (for style reference):
${recentCommits || '(none - this may be a new repo)'}

## Changed files:
${changedFilesText}

## Git Diff:
${diff.substring(0, 16000)}${diff.length > 16000 ? '\n... (truncated)' : ''}

Generate a commit message based on the above changes.`

  return { system: systemPrompt, user: userPrompt }
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
    throw new Error('AI 生成提交消息需要 API Key 认证。当前使用的是 OAuth 认证方式，不支持直接调用 API。请在设置中切换到 Anthropic 兼容协议并填写 API Key。')
  }
  throw new Error('LLM not configured. Please set API key in Settings.')
}

/**
 * Generate a commit message from the staged diff. Requires at least one
 * staged file. Returns the raw LLM output (trimmed).
 */
export async function generateAiCommitMessage(cwd: string, stagedFiles: ScmFile[], locale: string): Promise<string> {
  if (!cwd) throw new Error('No project root')
  if (stagedFiles.length === 0) {
    throw new Error('No staged changes to analyze. Please stage your changes first.')
  }

  await ensureLLMConfigured()

  const [diff, logResult] = await Promise.all([
    api.git.getStagedDiff(cwd),
    api.git.getLog(cwd, 10),
  ])

  const logEntries: ScmLogEntry[] = logResult || []
  const prompt = buildCommitMessagePrompt({
    diff,
    recentSubjects: logEntries.map(e => e.subject),
    changedFiles: stagedFiles.map(f => `${f.status.toUpperCase()} ${f.path}`),
    isZh: locale === 'zh-CN',
  })

  const result = await sendLLMMessage([{ role: 'user', content: prompt.user }], { system: prompt.system })
  return result.trim()
}

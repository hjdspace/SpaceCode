import { app, ipcMain, net } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { debug, error, info, warn } from './logger'

// ============================================================
// Prompt Optimizer — Self-contained main-process implementation
// ----------------------------------------------------------------
// The engine module at engine/src/commands/prompt-optimizer/optimizer.ts
// cannot be require()'d from the Electron main process: it's TypeScript
// source shipped only via the bun-bundled `dist/chunk-*.js` artefacts,
// and it pulls in a huge bootstrap/auth runtime that does not exist
// inside the main process. We instead read the already-saved GUI
// settings and call the configured LLM directly, mirroring the approach
// used by the existing `http:fetch` IPC handler.
// ============================================================

const PROMPT_OPTIMIZER_SYSTEM_PROMPT = `You are a Prompt Optimization Expert. Your sole purpose is to enhance user prompts to make them more effective for AI assistants.

## Your Process

When given a user's prompt, you must analyze and improve it through these stages:

### 1. Analysis
- Identify the user's primary goal and intent
- Determine the task type (coding, writing, analysis, creative, etc.)
- Assess the current prompt's strengths and weaknesses

### 2. Enhancement
Apply these optimization techniques:

**Structure & Clarity**
- Add clear task definitions and boundaries
- Include specific constraints and requirements
- Define expected output format when relevant

**Context Enrichment**
- Add relevant domain context
- Include necessary background information
- Specify relevant constraints or limitations

**Instruction Quality**
- Use precise, actionable language
- Break down complex tasks into clear steps
- Add role/persona when appropriate

**Edge Case Handling**
- Include boundary conditions
- Specify error handling expectations
- Define quality standards

### 3. Output Format

Return ONLY the optimized prompt. Do NOT include:
- Explanations of what you changed
- Commentary or notes
- Prefixes like "Optimized:" or "Here is your improved prompt:"

## Important Rules

1. Output ONLY the optimized prompt text — no surrounding prose, no code fences
2. Preserve the user's original language (Chinese in → Chinese out, English in → English out)
3. Preserve the user's original intent exactly
4. Make the prompt more actionable and specific
5. Add structure without over-constraining
6. Keep the optimized prompt concise but complete
7. If the prompt is already well-structured, make only necessary improvements`

type AuthMethod =
  | 'anthropic_compatible'
  | 'openai_compatible'
  | 'gemini_api'
  | 'claudeai'
  | 'console'

interface ProviderConfig {
  baseUrl?: string
  apiKey?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

interface GuiSettings {
  authMethod?: AuthMethod
  anthropicConfig?: ProviderConfig
  openaiConfig?: ProviderConfig
  geminiConfig?: ProviderConfig
}

type OptimizeResult = { success: true; result: string } | { success: false; error: string }

// ----------------------------------------------------------------
// Settings loader — reads ~/.claude/gui-settings.json (same file
// the renderer writes via `settings:saveGuiSettings` in main.ts)
// ----------------------------------------------------------------

function getGuiSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'gui-settings.json')
}

function loadGuiSettings(): GuiSettings | null {
  const settingsPath = getGuiSettingsPath()
  if (!existsSync(settingsPath)) {
    warn('PromptOptimizer', `gui-settings.json not found at ${settingsPath}`)
    return null
  }
  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as GuiSettings
  } catch (err) {
    warn('PromptOptimizer', 'Failed to parse gui-settings.json', err)
    return null
  }
}

// ----------------------------------------------------------------
// Provider-specific callers
// ----------------------------------------------------------------

async function callOpenAICompatible(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const model = config.sonnetModel || 'gpt-4o-mini'
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 4096,
    temperature: 0.5,
  })
  debug('PromptOptimizer', `OpenAI-compatible call | url=${url} | model=${model}`)
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  const data = JSON.parse(text)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Empty response from OpenAI-compatible endpoint')
  }
  return content.trim()
}

async function callAnthropic(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const url = `${base}/v1/messages`
  const model = config.sonnetModel || 'claude-3-5-sonnet-latest'
  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  debug('PromptOptimizer', `Anthropic call | url=${url} | model=${model}`)
  const res = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey || '',
      'anthropic-version': '2023-06-01',
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  const data = JSON.parse(text)
  const textBlock = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string }) => b?.type === 'text')
    : null
  const out = textBlock && typeof textBlock.text === 'string' ? textBlock.text.trim() : ''
  if (!out) throw new Error('Empty response from Anthropic endpoint')
  return out
}

async function callGemini(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const base = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
  const model = config.sonnetModel || 'gemini-1.5-flash-latest'
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey || '')}`
  const body = JSON.stringify({
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.5 },
  })
  debug('PromptOptimizer', `Gemini call | url=${url.replace(/key=[^&]+/, 'key=***')} | model=${model}`)
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  const data = JSON.parse(text)
  const parts = data?.candidates?.[0]?.content?.parts
  const out = Array.isArray(parts)
    ? parts
        .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim()
    : ''
  if (!out) throw new Error('Empty response from Gemini endpoint')
  return out
}

// ----------------------------------------------------------------
// Public entry
// ----------------------------------------------------------------

export async function optimizePrompt(prompt: string): Promise<OptimizeResult> {
  const text = (prompt || '').trim()
  if (!text) return { success: false, error: 'Prompt cannot be empty' }

  const settings = loadGuiSettings()
  if (!settings) {
    return { success: false, error: 'No GUI settings found. Please configure your LLM provider first.' }
  }

  const method: AuthMethod = settings.authMethod || 'openai_compatible'
  debug('PromptOptimizer', `Using authMethod=${method}`)

  try {
    switch (method) {
      case 'anthropic_compatible':
      case 'claudeai':
      case 'console': {
        const c = settings.anthropicConfig
        if (!c?.apiKey) return { success: false, error: 'Anthropic API key is not configured' }
        return { success: true, result: await callAnthropic(c, PROMPT_OPTIMIZER_SYSTEM_PROMPT, text) }
      }
      case 'openai_compatible': {
        const c = settings.openaiConfig
        if (!c?.apiKey) return { success: false, error: 'OpenAI API key is not configured' }
        return { success: true, result: await callOpenAICompatible(c, PROMPT_OPTIMIZER_SYSTEM_PROMPT, text) }
      }
      case 'gemini_api': {
        const c = settings.geminiConfig
        if (!c?.apiKey) return { success: false, error: 'Gemini API key is not configured' }
        return { success: true, result: await callGemini(c, PROMPT_OPTIMIZER_SYSTEM_PROMPT, text) }
      }
      default:
        return { success: false, error: `Unsupported auth method: ${method}` }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error('PromptOptimizer', 'Exception during optimization', { error: msg })
    return { success: false, error: msg }
  }
}

export function registerPromptOptimizerIPC() {
  info('PromptOptimizer', 'Registering IPC handler')

  ipcMain.handle('prompt-optimizer:optimize', async (_event, prompt: string) => {
    debug('PromptOptimizer', `IPC optimize request | length=${prompt?.length || 0}`)
    const result = await optimizePrompt(prompt)
    if (result.success) {
      info(
        'PromptOptimizer',
        `Optimization successful | original=${prompt.length} | optimized=${result.result.length}`,
      )
    } else {
      warn('PromptOptimizer', `Optimization failed | ${result.error}`)
    }
    return result
  })
}

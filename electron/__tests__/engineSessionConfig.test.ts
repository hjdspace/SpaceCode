// @vitest-environment node
/**
 * 后台触发方（cron / IM）的引擎会话配置测试。
 * Seam: CLAUDE_CONFIG_DIR 注入设置文件目录，无需真实用户配置。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { loadEngineSessionConfig, resolveEngineModelAlias } from '../engine/engineSessionConfig'

let configDir: string
let homeDir: string
const prevEnv: Record<string, string | undefined> = {}

function writeSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(path.join(configDir, 'gui-settings.json'), JSON.stringify(settings), 'utf-8')
}

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-engine-settings-'))
  // homedir 兜底路径也要隔离：否则会读到开发者真实的 gui-settings.json（含 key）
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-engine-home-'))
  for (const key of ['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE']) {
    prevEnv[key] = process.env[key]
  }
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.HOME = homeDir
  process.env.USERPROFILE = homeDir
})

afterEach(() => {
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(configDir, { recursive: true, force: true })
  fs.rmSync(homeDir, { recursive: true, force: true })
})

describe('resolveEngineModelAlias', () => {
  it('把槽位里的实际模型名反查成引擎别名', () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { haikuModel: 'glm-5.2', sonnetModel: 'kimi-k3', opusModel: 'deepseek-v4-flash' },
    })

    expect(resolveEngineModelAlias('deepseek-v4-flash')).toBe('opus')
    expect(resolveEngineModelAlias('kimi-k3')).toBe('sonnet')
    expect(resolveEngineModelAlias('glm-5.2')).toBe('haiku')
  })

  it('槽位之外的模型原样返回', () => {
    writeSettings({ authMethod: 'openai_compatible', openaiConfig: { sonnetModel: 'kimi-k3' } })
    expect(resolveEngineModelAlias('deepseek-v4-flash')).toBe('deepseek-v4-flash')
  })

  it('读不到设置文件时原样返回，不猜模型', () => {
    expect(resolveEngineModelAlias('kimi-k3')).toBe('kimi-k3')
  })

  it('只看当前 authMethod 的槽位', () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { sonnetModel: 'kimi-k3' },
      anthropicConfig: { opusModel: 'kimi-k3' },
    })
    expect(resolveEngineModelAlias('kimi-k3')).toBe('sonnet')
  })

  it('订阅登录（claudeai）没有可反查的槽位', () => {
    writeSettings({ authMethod: 'claudeai', anthropicConfig: { sonnetModel: 'kimi-k3' } })
    expect(resolveEngineModelAlias('kimi-k3')).toBe('kimi-k3')
  })

  it('engineType=pi 时保留真实模型 id，反查只属于 claude-code 的代理路由', () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { haikuModel: 'glm-5.2', sonnetModel: 'kimi-k3', opusModel: 'deepseek-v4-flash' },
      engineType: 'pi',
    })

    expect(resolveEngineModelAlias('kimi-k3', 'pi')).toBe('kimi-k3')
    // 同一个设置文件切回 claude-code 仍然要别名
    expect(resolveEngineModelAlias('kimi-k3', 'claude-code')).toBe('sonnet')
  })
})

describe('loadEngineSessionConfig', () => {
  it('按 authMethod 选 provider 并取 sonnet 槽位为默认模型', () => {
    writeSettings({
      authMethod: 'gemini_api',
      geminiConfig: { baseUrl: 'https://g.example/v1', apiKey: 'g-key', sonnetModel: 'gemini-x' },
      openaiConfig: { sonnetModel: 'other' },
    })

    expect(loadEngineSessionConfig('/w')).toMatchObject({
      cwd: '/w',
      provider: 'gemini',
      model: 'gemini-x',
      apiKey: 'g-key',
      baseUrl: 'https://g.example/v1',
    })
  })

  it('订阅登录不带 anthropicConfig 的 key/baseUrl', () => {
    writeSettings({
      authMethod: 'claudeai',
      anthropicConfig: { baseUrl: 'https://old.example', apiKey: 'stale', sonnetModel: 'x' },
    })

    expect(loadEngineSessionConfig('/w')).toEqual({ cwd: '/w', provider: 'anthropic' })
  })

  it('读不到设置文件时只返回 cwd', () => {
    expect(loadEngineSessionConfig('/w')).toEqual({ cwd: '/w' })
  })

  it('设置页的 modelCapabilities.contextWindow 是后台会话的上下文窗口来源', () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { sonnetModel: 'kimi-k3' },
      modelCapabilities: { 'kimi-k3': { contextWindow: 200_000 } },
      modelContextWindows: { 'kimi-k3': 1_000_000 },
    })

    expect(loadEngineSessionConfig('/w').modelContextWindows).toEqual({ 'kimi-k3': 200_000 })
  })

  it('只有旧版 modelContextWindows 时仍然带上，不丢历史配置', () => {
    writeSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { sonnetModel: 'kimi-k3' },
      modelContextWindows: { 'kimi-k3': 400_000 },
    })

    expect(loadEngineSessionConfig('/w').modelContextWindows).toEqual({ 'kimi-k3': 400_000 })
  })
})

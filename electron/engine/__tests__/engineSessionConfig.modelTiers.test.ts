// @vitest-environment node
/**
 * 桌面设置里的模型槽位：向导要靠这份映射把真实模型名标成 haiku/sonnet/opus 档位，
 * 而不是把档位名当成模型选项。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadEngineSessionConfig, loadModelTiers } from '../engineSessionConfig'

let dir: string
const previousDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-session-config-'))
  process.env.CLAUDE_CONFIG_DIR = dir
})

afterEach(() => {
  if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousDir
  rmSync(dir, { recursive: true, force: true })
})

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(join(dir, 'gui-settings.json'), JSON.stringify(settings), 'utf-8')
}

describe('loadModelTiers', () => {
  it('maps each configured slot to its real model name', () => {
    writeSettings({
      authMethod: 'anthropic_compatible',
      anthropicConfig: {
        haikuModel: 'glm-5.3-flash',
        sonnetModel: 'qwen3.8-max',
        opusModel: 'glm-5.3',
      },
    })

    expect(loadModelTiers()).toEqual({
      'glm-5.3-flash': 'haiku',
      'qwen3.8-max': 'sonnet',
      'glm-5.3': 'opus',
    })
    expect(loadEngineSessionConfig('/repo').selectableModels).toEqual([
      'glm-5.3-flash',
      'qwen3.8-max',
      'glm-5.3',
    ])
  })

  it('returns no tiers when the provider has no configured slots', () => {
    writeSettings({ authMethod: 'anthropic_compatible' })
    expect(loadModelTiers()).toEqual({})
  })

  it('ignores subscription auth methods without model slots', () => {
    writeSettings({ authMethod: 'claudeai' })
    expect(loadModelTiers()).toEqual({})
  })
})

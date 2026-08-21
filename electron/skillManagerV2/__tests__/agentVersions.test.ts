import { describe, it, expect } from 'vitest'
import { AGENT_CLI_META, detectAgentVersion } from '../agentVersions'

describe('agentVersions', () => {
  it('returns null for agents without CLI metadata', async () => {
    expect(await detectAgentVersion('agents')).toBeNull()
    expect(await detectAgentVersion('no-such-agent')).toBeNull()
  })

  it('gives every known CLI at least one binary candidate', () => {
    for (const [agentId, meta] of Object.entries(AGENT_CLI_META)) {
      expect(meta.binaries.length, agentId).toBeGreaterThan(0)
    }
  })

  it('covers the npm-managed agents with their package names', () => {
    expect(AGENT_CLI_META['claude-code'].npmPackage).toBe('@anthropic-ai/claude-code')
    expect(AGENT_CLI_META['codex'].npmPackage).toBe('@openai/codex')
    expect(AGENT_CLI_META['gemini'].npmPackage).toBe('@google/gemini-cli')
    expect(AGENT_CLI_META['kimi'].npmPackage).toBe('@moonshot-ai/kimi-code')
  })

  it('keeps binary aliases for renamed CLIs', () => {
    expect(AGENT_CLI_META['qwen'].binaries).toEqual(['qwen-coder', 'qwen'])
    expect(AGENT_CLI_META['cursor'].binaries).toEqual(['cursor-agent'])
  })
})

import { describe, it, expect } from 'vitest'
import {
  getBuiltInAgents,
  getBuiltInAgentIds,
  getBuiltInAgent,
  pathsForAgent,
  sharedSkillsDir,
} from '../agentRegistry'

describe('agentRegistry', () => {
  describe('getBuiltInAgents', () => {
    it('returns 4 built-in agents', () => {
      const agents = getBuiltInAgents()
      expect(agents.length).toBe(4)
    })

    it('includes Claude Code, Codex, Cursor, Trae', () => {
      const agents = getBuiltInAgents()
      const ids = agents.map((a) => a.id)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('codex')
      expect(ids).toContain('cursor')
      expect(ids).toContain('trae')
    })

    it('each agent has a non-empty skillsDir', () => {
      const agents = getBuiltInAgents()
      for (const agent of agents) {
        expect(agent.skillsDir.length).toBeGreaterThan(0)
        expect(agent.displayName.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getBuiltInAgentIds', () => {
    it('returns 4 agent IDs', () => {
      const ids = getBuiltInAgentIds()
      expect(ids.length).toBe(4)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('codex')
      expect(ids).toContain('cursor')
      expect(ids).toContain('trae')
    })
  })

  describe('getBuiltInAgent', () => {
    it('returns the agent for a valid ID', () => {
      const agent = getBuiltInAgent('claude-code')
      expect(agent).not.toBeNull()
      expect(agent!.displayName).toBe('Claude Code')
    })

    it('returns null for an unknown ID', () => {
      expect(getBuiltInAgent('unknown-agent')).toBeNull()
    })
  })

  describe('pathsForAgent', () => {
    it('returns paths for claude-code', () => {
      const paths = pathsForAgent('claude-code')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs.length).toBe(1)
      expect(paths!.skillDirs[0]).toContain('.claude')
      expect(paths!.skillDirs[0]).toContain('skills')
    })

    it('returns paths for codex with shared dir', () => {
      const paths = pathsForAgent('codex')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs.length).toBe(2)
      expect(paths!.skillDirs[0]).toContain('.codex')
      expect(paths!.skillDirs[1]).toContain('.agents')
    })

    it('returns paths for cursor', () => {
      const paths = pathsForAgent('cursor')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs[0]).toContain('.cursor')
    })

    it('returns paths for trae', () => {
      const paths = pathsForAgent('trae')
      expect(paths).not.toBeNull()
      expect(paths!.skillDirs[0]).toContain('.trae')
    })

    it('returns null for unknown agent', () => {
      expect(pathsForAgent('unknown')).toBeNull()
    })
  })

  describe('sharedSkillsDir', () => {
    it('returns a path containing .agents/skills', () => {
      const dir = sharedSkillsDir()
      expect(dir).toContain('.agents')
      expect(dir).toContain('skills')
    })
  })
})

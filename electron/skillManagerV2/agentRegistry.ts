/**
 * Skill Manager V2 — Agent Registry
 *
 * Built-in registry for Claude Code, Codex, Cursor, Trae.
 * Each agent returns its skill directory path and config path.
 *
 * Reference: AgentBro `src-tauri/src/skills/agent_paths.rs`
 */

import * as path from 'path'
import { home } from './fsutil'

// ── Types ──────────────────────────────────────────────────────────

export interface AgentPaths {
  skillDirs: string[]
  mcpConfig: string | null
  settingsFile: string | null
}

export interface BuiltInAgent {
  id: string
  displayName: string
  skillsDir: string
  configPath: string | null
  mcpConfigPath: string | null
  icon: string
}

// ── Built-in agents ────────────────────────────────────────────────

const BUILT_IN_AGENTS: BuiltInAgent[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: path.join(home(), '.claude', 'skills'),
    configPath: path.join(home(), '.claude', 'settings.json'),
    mcpConfigPath: path.join(home(), '.claude', 'settings.json'),
    icon: 'claude',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    skillsDir: path.join(home(), '.codex', 'skills'),
    configPath: path.join(home(), '.codex', 'config.toml'),
    mcpConfigPath: path.join(home(), '.codex', 'config.toml'),
    icon: 'codex',
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    skillsDir: path.join(home(), '.cursor', 'skills'),
    configPath: path.join(home(), '.cursor', 'mcp.json'),
    mcpConfigPath: path.join(home(), '.cursor', 'mcp.json'),
    icon: 'cursor',
  },
  {
    id: 'trae',
    displayName: 'Trae',
    skillsDir: path.join(home(), '.trae', 'skills'),
    configPath: path.join(home(), '.trae', 'config.json'),
    mcpConfigPath: null,
    icon: 'trae',
  },
]

/** Returns the built-in agent definitions. */
export function getBuiltInAgents(): BuiltInAgent[] {
  return BUILT_IN_AGENTS
}

/** Returns the IDs of all built-in agents. */
export function getBuiltInAgentIds(): string[] {
  return BUILT_IN_AGENTS.map((a) => a.id)
}

/**
 * Resolve skill paths for a given agent ID.
 * Returns null for unknown agents.
 */
export function pathsForAgent(agentId: string): AgentPaths | null {
  const agent = BUILT_IN_AGENTS.find((a) => a.id === agentId)
  if (!agent) return null

  // Codex also reads from the shared ~/.agents/skills directory
  if (agentId === 'codex') {
    return {
      skillDirs: [
        agent.skillsDir,
        path.join(home(), '.agents', 'skills'),
      ],
      mcpConfig: agent.mcpConfigPath,
      settingsFile: agent.configPath,
    }
  }

  return {
    skillDirs: [agent.skillsDir],
    mcpConfig: agent.mcpConfigPath,
    settingsFile: agent.configPath,
  }
}

/** Get a built-in agent by ID. */
export function getBuiltInAgent(agentId: string): BuiltInAgent | null {
  return BUILT_IN_AGENTS.find((a) => a.id === agentId) ?? null
}

/** The shared skills directory used by multiple agents. */
export function sharedSkillsDir(): string {
  return path.join(home(), '.agents', 'skills')
}

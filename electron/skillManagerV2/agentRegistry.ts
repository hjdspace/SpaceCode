/**
 * Skill Manager V2 — Agent Registry
 *
 * Built-in registry for the agents supported by the shared skill layout.
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

/** Resolve the cache directory used by an agent's installed plugins. */
export function pluginCachePathForAgent(agentId: string): string | null {
  const root = home()
  const paths: Record<string, string> = {
    'claude-code': path.join(root, '.claude', 'plugins', 'cache'),
    codex: path.join(root, '.codex', 'plugins', 'cache'),
    kimi: path.join(root, '.kimi-code', 'plugins', 'managed'),
    workbuddy: path.join(root, '.workbuddy', 'plugins'),
    zcode: path.join(root, '.zcode', 'cli', 'plugins', 'cache'),
    antigravity: path.join(root, '.gemini', 'config', 'plugins'),
  }
  return paths[agentId] ?? null
}

// ── Built-in agents ────────────────────────────────────────────────

const BUILT_IN_AGENTS: BuiltInAgent[] = [
  {
    id: 'agents',
    displayName: '.agents',
    skillsDir: path.join(home(), '.agents', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'agents',
  },
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
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    skillsDir: path.join(home(), '.gemini', 'skills'),
    configPath: path.join(home(), '.gemini', 'settings.json'),
    mcpConfigPath: path.join(home(), '.gemini', 'settings.json'),
    icon: 'gemini',
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: path.join(home(), '.gemini', 'config', 'skills'),
    configPath: path.join(home(), '.gemini', 'config', 'hooks.json'),
    mcpConfigPath: path.join(home(), '.gemini', 'config', 'mcp_config.json'),
    icon: 'antigravity',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    skillsDir: path.join(home(), '.opencode', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'opencode',
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: path.join(home(), '.openclaw', 'skills'),
    configPath: path.join(home(), '.openclaw', 'openclaw.json'),
    mcpConfigPath: null,
    icon: 'openclaw',
  },
  {
    id: 'copilot',
    displayName: 'Copilot',
    skillsDir: path.join(home(), '.copilot', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'copilot',
  },
  {
    id: 'qwen',
    displayName: 'Qwen Code',
    skillsDir: path.join(home(), '.qwen', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'qwen',
  },
  {
    id: 'kimi',
    displayName: 'Kimi Code',
    skillsDir: path.join(home(), '.kimi-code', 'skills'),
    configPath: null,
    mcpConfigPath: path.join(home(), '.kimi-code', 'mcp.json'),
    icon: 'kimi',
  },
  {
    id: 'doubao',
    displayName: 'Doubao',
    skillsDir: path.join(home(), 'Doubao', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'doubao',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    skillsDir: path.join(home(), '.deepseek', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'deepseek',
  },
  {
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    skillsDir: path.join(home(), '.workbuddy', 'skills'),
    configPath: path.join(home(), '.workbuddy', 'settings.json'),
    mcpConfigPath: path.join(home(), '.workbuddy', 'settings.json'),
    icon: 'workbuddy',
  },
  {
    id: 'zcode',
    displayName: 'ZCode',
    skillsDir: path.join(home(), '.zcode', 'skills'),
    configPath: path.join(home(), '.zcode', 'cli', 'config.json'),
    mcpConfigPath: path.join(home(), '.zcode', 'cli', 'config.json'),
    icon: 'zcode',
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: path.join(home(), '.windsurf', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'windsurf',
  },
  {
    id: 'augment',
    displayName: 'Augment',
    skillsDir: path.join(home(), '.augment', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'augment',
  },
  {
    id: 'kilocode',
    displayName: 'Kilo Code',
    skillsDir: path.join(home(), '.kilocode', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'kilocode',
  },
  {
    id: 'aider',
    displayName: 'Aider',
    skillsDir: path.join(home(), '.aider', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'aider',
  },
  {
    id: 'amp',
    displayName: 'Amp',
    skillsDir: path.join(home(), '.amp', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'amp',
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    skillsDir: path.join(home(), '.kiro', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'kiro',
  },
  {
    id: 'hermes',
    displayName: 'Hermes',
    skillsDir: path.join(home(), '.hermes', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'hermes',
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

  // Several agents also read the shared ~/.agents/skills directory.
  if (agentId === 'codex' || agentId === 'kimi' || agentId === 'zcode') {
    return {
      skillDirs: [
        agent.skillsDir,
        path.join(home(), '.agents', 'skills'),
      ],
      mcpConfig: agent.mcpConfigPath,
      settingsFile: agent.configPath,
    }
  }

  if (agentId === 'cursor') {
    return {
      skillDirs: [agent.skillsDir, path.join(home(), '.cursor', 'rules')],
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

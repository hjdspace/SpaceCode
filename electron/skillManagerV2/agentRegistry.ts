/**
 * Skill Manager V2 — Agent Registry
 *
 * Built-in registry for the agents supported by the shared skill layout.
 * Each agent returns its skill directory path and config path.
 *
 * Reference: AgentBro `src-tauri/src/skills/agent_paths.rs` + `v2/agent_meta.rs`
 */

import * as fs from 'fs'
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

/**
 * Built-in agent definitions, resolved lazily so tests can override the home
 * directory before the first lookup (paths are home-relative).
 */
function computeBuiltInAgents(): BuiltInAgent[] {
  return [
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
    id: 'qclaw',
    displayName: 'QClaw',
    skillsDir: path.join(home(), '.qclaw', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'qclaw',
  },
  {
    id: 'easyclaw',
    displayName: 'EasyClaw',
    skillsDir: path.join(home(), '.easyclaw', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'easyclaw',
  },
  {
    id: 'easyclaw-v2',
    displayName: 'EasyClaw V2',
    skillsDir: path.join(home(), '.easyclaw-20260322-01', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'easyclaw',
  },
  {
    id: 'autoclaw',
    displayName: 'AutoClaw',
    skillsDir: path.join(home(), '.openclaw-autoclaw', 'skills'),
    configPath: null,
    mcpConfigPath: null,
    icon: 'autoclaw',
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
    skillsDir: path.join(kimiCodeHome(), 'skills'),
    configPath: null,
    mcpConfigPath: path.join(kimiCodeHome(), 'mcp.json'),
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
}

/** Returns the built-in agent definitions. */
export function getBuiltInAgents(): BuiltInAgent[] {
  return computeBuiltInAgents()
}

/** Returns the IDs of all built-in agents. */
export function getBuiltInAgentIds(): string[] {
  return computeBuiltInAgents().map((a) => a.id)
}

/**
 * Resolve skill paths for a given agent ID.
 * Returns null for unknown agents.
 */
export function pathsForAgent(agentId: string): AgentPaths | null {
  const agent = computeBuiltInAgents().find((a) => a.id === agentId)
  if (!agent) return null

  // Several agents also read the shared ~/.agents/skills directory.
  if (inheritsSharedAgentsSkills(agentId)) {
    return {
      skillDirs: [
        agent.skillsDir,
        ...extraSkillDirsForAgent(agentId),
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
  return computeBuiltInAgents().find((a) => a.id === agentId) ?? null
}

/** The shared skills directory used by multiple agents. */
export function sharedSkillsDir(): string {
  return path.join(home(), '.agents', 'skills')
}

/** Kimi Code home: `$KIMI_CODE_HOME` override, else `~/.kimi-code`. Reference: AgentBro `kimi_code_home_for`. */
function kimiCodeHome(): string {
  const override = process.env.KIMI_CODE_HOME
  if (override && override.trim()) {
    if (override.startsWith('~/') || override.startsWith('~\\')) {
      return path.join(home(), override.slice(2))
    }
    return override
  }
  return path.join(home(), '.kimi-code')
}

/**
 * Agents that also load the shared `~/.agents/skills` directory.
 * That directory is scanned separately as the `agents` pseudo-agent.
 * Reference: AgentBro `agent_meta::inherits_shared_agents_skills`.
 */
export function inheritsSharedAgentsSkills(agentId: string): boolean {
  return agentId === 'codex' || agentId === 'kimi' || agentId === 'openclaw' || agentId === 'zcode'
}

/** Expand a leading `~` in a config value against the real home dir. */
function expandHomeDir(value: string): string {
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(home(), value.slice(2))
  }
  return value
}

/**
 * OpenClaw workspace dir: `~/.openclaw/openclaw.json` → `agents.defaults.workspace`,
 * defaulting to `~/.openclaw/workspace`. Reference: AgentBro `openclaw_workspace_dir`.
 */
function openclawWorkspaceDir(): string {
  const configPath = path.join(home(), '.openclaw', 'openclaw.json')
  try {
    const json = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      agents?: { defaults?: { workspace?: unknown } }
    }
    const workspace = json.agents?.defaults?.workspace
    if (typeof workspace === 'string' && workspace.trim()) {
      return expandHomeDir(workspace)
    }
  } catch {
    // Missing or invalid config — fall through to the default workspace.
  }
  return path.join(home(), '.openclaw', 'workspace')
}

/** Bundled OpenClaw skill dirs: dir of the `openclaw` binary on PATH + global npm installs. */
function openclawBundledSkillDirs(): string[] {
  const dirs: string[] = []
  const pathVar = process.env.PATH ?? ''
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue
    for (const candidate of ['openclaw', 'openclaw.exe', 'openclaw.cmd']) {
      const binary = path.join(dir, candidate)
      try {
        if (fs.statSync(binary).isFile()) {
          dirs.push(path.join(path.dirname(fs.realpathSync(binary)), 'skills'))
          break
        }
      } catch {
        // Not present — keep scanning PATH.
      }
    }
  }
  dirs.push('/opt/homebrew/lib/node_modules/openclaw/skills')
  dirs.push('/usr/local/lib/node_modules/openclaw/skills')
  return dirs
}

/**
 * Doubao built-in (read-only) skill roots — the macOS app support layout.
 * Reference: AgentBro `agent_paths::doubao_builtin_skill_dirs_for`.
 */
function doubaoBuiltinSkillDirs(): string[] {
  const profilesRoot = path.join(home(), 'Library', 'Application Support', 'Doubao')
  const suffix = path.join('.doubao', 'agent_mode', 'workspace', '.skills')
  const dirs = [path.join(profilesRoot, 'Default', suffix)]
  try {
    const discovered = fs
      .readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(profilesRoot, entry.name, suffix))
      .filter((dir) => dir !== dirs[0])
    discovered.sort()
    dirs.push(...discovered)
  } catch {
    // No Doubao profiles — keep just the Default dir.
  }
  return dedupePaths(dirs)
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** Extra owned roots beyond the primary dir for multi-root agents (OpenClaw). */
function extraSkillDirsForAgent(agentId: string): string[] {
  if (agentId !== 'openclaw') return []
  const workspace = openclawWorkspaceDir()
  return [path.join(workspace, '.agents', 'skills')]
}

/**
 * Every skill root an agent loads from, highest precedence first.
 * Reference: AgentBro `agent_meta::agent_skill_dirs`.
 */
export function agentSkillDirs(agentId: string): string[] {
  if (agentId === 'openclaw') {
    const workspace = openclawWorkspaceDir()
    return dedupePaths([
      path.join(workspace, 'skills'),
      path.join(workspace, '.agents', 'skills'),
      sharedSkillsDir(),
      path.join(home(), '.openclaw', 'skills'),
      path.join(home(), '.openclaw', 'plugin-skills'),
      ...openclawBundledSkillDirs(),
    ])
  }
  const agent = getBuiltInAgent(agentId)
  if (agent) {
    const dirs = [agent.skillsDir]
    if (inheritsSharedAgentsSkills(agentId)) dirs.push(sharedSkillsDir())
    return dedupePaths(dirs)
  }
  return []
}

/**
 * Read-only (agent built-in) skill roots — Doubao builtins today.
 * Reference: AgentBro `agent_meta::agent_read_only_skill_dirs`.
 */
export function readOnlyAgentSkillDirs(agentId: string): string[] {
  if (agentId === 'doubao') return doubaoBuiltinSkillDirs()
  return []
}

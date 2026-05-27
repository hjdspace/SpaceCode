/**
 * Command metadata — shared constants for slash commands and their expansion prompts.
 *
 * Lives in lib/constants/ to avoid circular dependencies between hooks and logic modules.
 */

import type { SlashCommand } from '@/types'

/** Command kind types */
export type CommandKind =
  | 'immediate'      // 立即执行，不发送给 AI
  | 'sdk_command'    // 直接发送给 SDK/Claude Code 处理
  | 'codepilot_command' // 展开为预设提示词后发送给 Claude
  | 'agent_skill'    // 技能命令
  | 'slash_command'  // 普通斜杠命令

/** Expansion prompts for codepilot and sdk commands (expanded before sending to AI). */
export const COMMAND_PROMPTS: Record<string, string> = {
  '/init': `Set up a CLAUDE.md file for this repo. CLAUDE.md is loaded into every Claude Code session, so it must be concise — only include what Claude would get wrong without it.

## Steps
1. Explore the codebase: read key files to understand the project — manifest files (package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, etc.), README, Makefile/build configs, CI config, existing CLAUDE.md, .claude/rules/, AGENTS.md, .cursor/rules or .cursorrules, .github/copilot-instructions.md.
2. Detect: build/test/lint commands, languages, frameworks, project structure, code style rules, non-obvious gotchas, required env vars.
3. Create a minimal CLAUDE.md at the project root. Every line must pass this test: "Would removing this cause Claude to make mistakes?" If no, cut it.
4. Include: build/test/lint commands Claude can't guess, code style rules that differ from language defaults, testing instructions, required env vars or setup steps, non-obvious gotchas, important parts from existing AI coding tool configs.
5. Exclude: file-by-file structure, standard language conventions, generic advice, detailed API docs, commands obvious from manifest files.

Prefix with:
\`\`\`
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
\`\`\`

If CLAUDE.md already exists: read it, propose specific changes as diffs. Do not silently overwrite.`,
  '/compact': 'Compress and summarize the conversation context to reduce token usage while preserving important information.',
  '/review': 'Review the current codebase for code quality issues, potential bugs, performance problems, and suggest improvements.',
  '/doctor': 'Run diagnostic checks on this project. Check system health, dependencies, configuration files, and report any issues. Look for common problems like missing dependencies, outdated packages, configuration errors, and security vulnerabilities.',
  '/terminal-setup': 'Help me configure my terminal for optimal use with Claude Code. Check current setup (shell, dotfiles, PATH, aliases) and suggest improvements for productivity.',
  '/memory': 'Show the current CLAUDE.md project memory file and help me review or edit it. If it doesn\'t exist, help create one with project context.',
}

/** Built-in slash commands shown in the popover */
export const BUILT_IN_COMMANDS: SlashCommand[] = [
  // Immediate commands
  {
    name: 'help',
    description: 'Show available commands and tips',
    icon: 'HelpCircle',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'clear',
    description: 'Clear conversation history',
    icon: 'Trash2',
    kind: 'immediate',
    immediate: true,
    aliases: ['reset', 'new'],
  },
  {
    name: 'cost',
    description: 'Show token usage statistics',
    icon: 'Coins',
    kind: 'immediate',
    immediate: true,
  },
  // SDK commands - sent directly to SDK
  {
    name: 'compact',
    description: 'Compress conversation context',
    icon: 'Minimize2',
    kind: 'sdk_command',
  },
  {
    name: 'init',
    description: 'Initialize CLAUDE.md for project',
    icon: 'FilePlus',
    kind: 'sdk_command',
  },
  {
    name: 'review',
    description: 'Review code quality',
    icon: 'Eye',
    kind: 'sdk_command',
  },
  // CodePilot commands - expanded before sending
  {
    name: 'doctor',
    description: 'Diagnose project health',
    icon: 'Stethoscope',
    kind: 'codepilot_command',
  },
  {
    name: 'terminal-setup',
    description: 'Configure terminal settings',
    icon: 'Terminal',
    kind: 'codepilot_command',
  },
  {
    name: 'memory',
    description: 'Edit project memory file',
    icon: 'Bookmark',
    kind: 'codepilot_command',
  },
  // UI commands - handled by the UI
  {
    name: 'terminal',
    description: 'Open terminal panel',
    icon: 'Terminal',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'settings',
    description: 'Open settings panel',
    icon: 'Settings',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'skills',
    description: 'Open skills manager',
    icon: 'Zap',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'context',
    description: 'Show current context usage',
    icon: 'Layers',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'git',
    description: 'Git operations (e.g., /git status)',
    icon: 'GitBranch',
    kind: 'sdk_command',
  },
  {
    name: 'mcp',
    description: 'MCP server management',
    icon: 'Cpu',
    kind: 'immediate',
    immediate: true,
  },
  {
    name: 'rewind',
    description: 'Rewind conversation to a previous message',
    icon: 'RotateCcw',
    kind: 'immediate',
    immediate: true,
    aliases: ['checkpoint'],
  },
  // Agent skill commands - dispatched as skill invocations via SkillTool
  {
    name: 'commit',
    description: 'Create a git commit with AI-generated message',
    icon: 'GitCommit',
    kind: 'agent_skill',
  },
]

/** Find a command by name (including aliases) */
export function findCommand(name: string): SlashCommand | undefined {
  return BUILT_IN_COMMANDS.find(
    (cmd) =>
      cmd.name === name || cmd.aliases?.includes(name)
  )
}

/** Check if a command is an immediate command */
export function isImmediateCommand(name: string): boolean {
  const cmd = findCommand(name)
  return cmd?.immediate === true || cmd?.kind === 'immediate'
}

/** Get the prompt for a codepilot command */
export function getCommandPrompt(command: string): string | undefined {
  return COMMAND_PROMPTS[command.startsWith('/') ? command : `/${command}`]
}

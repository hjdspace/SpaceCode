/**
 * Skill Manager V2 — Agent CLI Version Detection
 *
 * Resolves the installed version of an agent CLI, following AgentBro's
 * approach (`src-tauri/src/agents/programs.rs` `version_info_for`):
 *   1. npm-managed agents query the global npm package version.
 *   2. Fallback: run the CLI binary found in PATH with `--version`.
 */

import { execFile } from 'child_process'

const IS_WINDOWS = process.platform === 'win32'
const NPM_TIMEOUT_MS = 4000
const BINARY_TIMEOUT_MS = 4000

export interface AgentCliMeta {
  /** Executable names to look for in PATH, in priority order. */
  binaries: string[]
  /** Global npm package name when the agent is distributed via npm. */
  npmPackage?: string
}

/** How each registry agent's CLI is invoked on this machine. */
export const AGENT_CLI_META: Record<string, AgentCliMeta> = {
  'claude-code': { binaries: ['claude'], npmPackage: '@anthropic-ai/claude-code' },
  codex: { binaries: ['codex'], npmPackage: '@openai/codex' },
  gemini: { binaries: ['gemini'], npmPackage: '@google/gemini-cli' },
  opencode: { binaries: ['opencode'], npmPackage: 'opencode-ai' },
  copilot: { binaries: ['copilot'], npmPackage: '@github/copilot' },
  kimi: { binaries: ['kimi'], npmPackage: '@moonshot-ai/kimi-code' },
  amp: { binaries: ['amp'], npmPackage: '@sourcegraph/amp' },
  aider: { binaries: ['aider'] },
  qwen: { binaries: ['qwen-coder', 'qwen'] },
  cursor: { binaries: ['cursor-agent'] },
  antigravity: { binaries: ['agy'] },
  kiro: { binaries: ['kiro', 'kiro-cli'] },
  openclaw: { binaries: ['openclaw'] },
  zcode: { binaries: ['zcode'] },
  trae: { binaries: ['trae'] },
  hermes: { binaries: ['hermes'] },
  workbuddy: { binaries: ['workbuddy'] },
}

function execFileAsync(
  command: string,
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Windows 上 .cmd/.bat 不是真正的可执行文件，必须通过 shell 解释。
    const lower = command.toLowerCase()
    const useShell = IS_WINDOWS && (lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1'))
    const finalCommand = useShell && command.includes(' ') ? `"${command}"` : command
    execFile(finalCommand, args, { timeout, windowsHide: true, shell: useShell }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

async function findBinaryInPath(name: string): Promise<string | null> {
  try {
    const cmd = IS_WINDOWS ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [name], 5000)
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    if (IS_WINDOWS) {
      // npm 安装的 CLI 会同时生成 <name> / <name>.cmd / <name>.ps1，优先 .cmd。
      const cmdFile = lines.find((l) => l.toLowerCase().endsWith('.cmd'))
      if (cmdFile) return cmdFile
    }
    return lines[0] ?? null
  } catch {
    return null
  }
}

/** Strip `v` prefix and take the first whitespace token, like AgentBro's normalize_version. */
function normalizeVersion(raw: string): string | null {
  const version = raw.trim().replace(/^v/i, '').split(/\s+/)[0] ?? ''
  return version.length > 0 ? version : null
}

/** `npm list -g <pkg> --depth=0 --json` → dependencies[pkg].version */
async function npmInstalledVersion(packageName: string): Promise<string | null> {
  try {
    const npmPath = await findBinaryInPath('npm')
    const { stdout } = await execFileAsync(
      npmPath ?? 'npm',
      ['list', '-g', packageName, '--depth=0', '--json'],
      NPM_TIMEOUT_MS
    )
    const parsed = JSON.parse(stdout) as {
      dependencies?: Record<string, { version?: unknown }>
    }
    const version = parsed.dependencies?.[packageName]?.version
    return typeof version === 'string' ? normalizeVersion(version) : null
  } catch {
    return null
  }
}

/** Run `<binary> --version` and extract a leading semver-ish token. */
async function binaryVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], BINARY_TIMEOUT_MS)
    const output = stdout || stderr
    if (!output) return null
    const semver = output.match(/(\d+\.\d+\.\d+[-+.\w]*)/)
    return semver ? semver[1] : normalizeVersion(output)
  } catch {
    return null
  }
}

/**
 * Detect the installed CLI version for an agent.
 * Returns null when the agent has no known CLI or the version cannot be resolved.
 */
export async function detectAgentVersion(agentId: string): Promise<string | null> {
  const meta = AGENT_CLI_META[agentId]
  if (!meta) return null

  if (meta.npmPackage) {
    const version = await npmInstalledVersion(meta.npmPackage)
    if (version) return version
  }

  for (const binary of meta.binaries) {
    const binaryPath = await findBinaryInPath(binary)
    if (!binaryPath) continue
    const version = await binaryVersion(binaryPath)
    if (version) return version
  }

  return null
}

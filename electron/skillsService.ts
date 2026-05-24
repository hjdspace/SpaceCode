/**
 * Skills Service - Handles skill management and marketplace operations
 */

import { ipcMain, app } from 'electron'
import { join, dirname, basename } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync, cpSync, rmSync } from 'fs'
import { net } from 'electron'

// Types
export interface Skill {
  name: string
  description: string
  content: string
  source: 'global' | 'project' | 'plugin' | 'installed' | 'builtin'
  installedSource?: 'agents' | 'claude'
  filePath: string
}

export interface MarketplaceSkill {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
  isInstalled?: boolean
  installedAt?: string
}

// Constants
const MARKETPLACE_API_URL = 'https://skills.sh/api/search'
const SKILL_MARKETPLACE_CACHE_KEY = 'skill_marketplace_cache'
const SKILL_MARKETPLACE_CACHE_TIME = 1000 * 60 * 60 // 1 hour

// Cache for marketplace skills
let marketplaceCache: { skills: MarketplaceSkill[]; timestamp: number } | null = null

/**
 * Get the path to global skills directory
 */
function getGlobalSkillsDirs(): string[] {
  return [
    join(app.getPath('home'), '.claude', 'commands'),
    join(app.getPath('home'), '.claude', 'skills')
  ]
}

/**
 * Get the paths to project skills directories
 */
function getProjectSkillsDirs(cwd: string): string[] {
  return [
    join(cwd, '.claude', 'commands'),
    join(cwd, '.claude', 'skills')
  ]
}

/**
 * Plugin install root (Claude Code compatible).
 * Each plugin lives in <root>/<pluginName>/ with .claude-plugin/plugin.json + skills/.
 */
function getGlobalPluginsRoot(): string {
  return join(app.getPath('home'), '.claude', 'plugins')
}

function getProjectPluginsRoot(cwd: string): string {
  return join(cwd, '.claude', 'plugins')
}

/**
 * Scan a plugins root directory and return every plugin's `skills/<name>/SKILL.md`
 * as Skill[] with source='plugin'. installedSource is reused to carry plugin name.
 */
function readPluginSkills(pluginsRoot: string): Skill[] {
  if (!existsSync(pluginsRoot)) return []
  const out: Skill[] = []
  try {
    const pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true })
    for (const pd of pluginDirs) {
      if (!pd.isDirectory()) continue
      const pluginDir = join(pluginsRoot, pd.name)
      const skillsDir = join(pluginDir, 'skills')
      if (!existsSync(skillsDir)) continue
      try {
        const skillEntries = readdirSync(skillsDir, { withFileTypes: true })
        for (const se of skillEntries) {
          if (!se.isDirectory()) continue
          const filePath = join(skillsDir, se.name, 'SKILL.md')
          if (!existsSync(filePath)) continue
          try {
            const content = readFileSync(filePath, 'utf-8')
            const fm = parseYamlFrontMatter(content)
            const name = fm?.name || se.name
            const description = fm?.description ||
              content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() ||
              `Skill: /${name}`
            out.push({ name, description, content, source: 'plugin', filePath })
          } catch (err) {
            console.error(`[Skills] Failed to read plugin skill: ${filePath}`, err)
          }
        }
      } catch (err) {
        console.error(`[Skills] Failed to read plugin skills dir: ${skillsDir}`, err)
      }
    }
  } catch (err) {
    console.error(`[Skills] Failed to scan plugins root: ${pluginsRoot}`, err)
  }
  return out
}

/**
 * Read skills from a directory
 */
function readSkillsFromDir(dirPath: string, source: Skill['source']): Skill[] {
  if (!existsSync(dirPath)) {
    return []
  }

  const skills: Skill[] = []
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = join(dirPath, entry.name)
        const filePath = join(skillDir, 'SKILL.md')
        if (!existsSync(filePath)) {
          continue
        }
        try {
          const content = readFileSync(filePath, 'utf-8')
          const frontMatter = parseYamlFrontMatter(content)
          const name = frontMatter?.name || entry.name
          const description = frontMatter?.description ||
            content.split('\n').find(line => line.trim() && !line.startsWith('#') && !line.startsWith('---'))?.trim() ||
            `Skill: /${name}`

          skills.push({
            name,
            description,
            content,
            source,
            filePath
          })
        } catch (err) {
          console.error(`[Skills] Failed to read skill file: ${filePath}`, err)
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = join(dirPath, entry.name)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const frontMatter = parseYamlFrontMatter(content)
          const name = frontMatter?.name || entry.name.replace('.md', '')
          const description = frontMatter?.description ||
            content.split('\n')[0]?.replace(/^#+\s*/, '') ||
            `Skill: /${name}`

          skills.push({
            name,
            description,
            content,
            source,
            filePath
          })
        } catch (err) {
          console.error(`[Skills] Failed to read skill file: ${filePath}`, err)
        }
      }
    }
  } catch (err) {
    console.error(`[Skills] Failed to read skills directory: ${dirPath}`, err)
  }

  return skills
}

/**
 * CLI Engine 内置的 bundled skills（与 engine/src/skills/bundled/index.ts 保持一致）
 * 这些技能编译在 CLI 二进制中，无需磁盘上的 .md 文件
 */
function getEngineRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'engine')
  }
  return join(__dirname, '../engine')
}

function getBundledSkillContent(name: string, description: string): string {
  const skillMdPath = join(getEngineRoot(), 'src/skills/bundled', name, 'SKILL.md')
  if (existsSync(skillMdPath)) {
    try {
      const content = readFileSync(skillMdPath, 'utf-8').trim()
      if (content && content !== '# Skill') {
        return content
      }
    } catch (err) {
      console.error(`[Skills] Failed to read bundled skill file: ${skillMdPath}`, err)
    }
  }

  return `# /${name}

${description}

> Built-in CLI skill (read-only). This skill is bundled with Claude Code and cannot be edited or deleted.`
}

export const BUNDLED_SKILLS: Array<{ name: string; description: string }> = [
  { name: 'update-config', description: 'Update Claude Code configuration' },
  { name: 'keybindings-help', description: 'Show keyboard shortcuts help' },
  { name: 'verify', description: 'Verify implementation against requirements' },
  { name: 'debug', description: 'Debug issues with systematic analysis' },
  { name: 'lorem-ipsum', description: 'Generate lorem ipsum placeholder text' },
  { name: 'skillify', description: 'Convert a workflow into a reusable skill' },
  { name: 'remember', description: 'Remember context for future conversations' },
  { name: 'simplify', description: 'Simplify complex code or explanations' },
  { name: 'batch', description: 'Process multiple items in batch operations' },
  { name: 'stuck', description: 'Get unstuck when progress is blocked' },
  { name: 'loop', description: 'Iterate on a task until completion' },
  { name: 'cron-list', description: 'List scheduled cron jobs' },
  { name: 'cron-delete', description: 'Delete a cron job' },
  { name: 'dream', description: 'Generate creative ideas or solutions' },
  { name: 'hunter', description: 'Review code artifacts for quality (requires REVIEW_ARTIFACT)' },
  { name: 'schedule-remote-agents', description: 'Schedule remote agent triggers (requires AGENT_TRIGGERS_REMOTE)' },
  { name: 'claude-api', description: 'Build Claude API applications (requires BUILDING_CLAUDE_APPS)' },
  { name: 'claude-in-chrome', description: 'Use Claude in Chrome browser (when enabled)' },
  { name: 'run-skill-generator', description: 'Generate new skills from examples (requires RUN_SKILL_GENERATOR)' },
]

/**
 * Default marketplace skills - used when online marketplace is not available
 */
const DEFAULT_MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    id: 'skill-001',
    skillId: 'web-search',
    name: 'web-search',
    installs: 1250,
    source: 'anthropics/skills/web-search.md'
  },
  {
    id: 'skill-002',
    skillId: 'git-expert',
    name: 'git-expert',
    installs: 890,
    source: 'anthropics/skills/git-expert.md'
  },
  {
    id: 'skill-003',
    skillId: 'code-reviewer',
    name: 'code-reviewer',
    installs: 2100,
    source: 'anthropics/skills/code-reviewer.md'
  },
  {
    id: 'skill-004',
    skillId: 'test-writer',
    name: 'test-writer',
    installs: 650,
    source: 'anthropics/skills/test-writer.md'
  },
  {
    id: 'skill-005',
    skillId: 'doc-generator',
    name: 'doc-generator',
    installs: 430,
    source: 'anthropics/skills/doc-generator.md'
  }
]

/**
 * Fetch marketplace skills from skills.sh API or cache
 */
async function fetchMarketplaceSkills(query: string = 'claude'): Promise<MarketplaceSkill[]> {
  // Check cache - use query as part of cache key
  const cacheKey = `${query}_${MARKETPLACE_API_URL}`
  if (marketplaceCache && Date.now() - marketplaceCache.timestamp < SKILL_MARKETPLACE_CACHE_TIME) {
    return marketplaceCache.skills
  }

  try {
    const url = `${MARKETPLACE_API_URL}?q=${encodeURIComponent(query)}&limit=50`
    const response = await net.fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Claude-Code-Desktop'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const text = await response.text()
    const data = JSON.parse(text)

    // The API returns skills in the 'skills' array
    if (data.skills && Array.isArray(data.skills)) {
      marketplaceCache = {
        skills: data.skills,
        timestamp: Date.now()
      }
      return data.skills
    }

    return []
  } catch (err) {
    console.log('[Skills] Online marketplace not available, using default skills list:', err)
    // Return default skills when online marketplace is not available
    marketplaceCache = {
      skills: DEFAULT_MARKETPLACE_SKILLS,
      timestamp: Date.now()
    }
    return DEFAULT_MARKETPLACE_SKILLS
  }
}

/**
 * Check if a skill is installed
 */
function isSkillInstalled(skillName: string, globalSkills: Skill[]): boolean {
  return globalSkills.some(s => s.name.toLowerCase() === skillName.toLowerCase())
}

function getSkillInstallPath(targetDir: string, skillName: string): string {
  return join(targetDir, skillName, 'SKILL.md')
}

function removeInstalledSkillFromDir(dirPath: string, skillName: string): boolean {
  const skillDir = join(dirPath, skillName)
  const skillFile = join(skillDir, 'SKILL.md')
  const legacyFile = join(dirPath, `${skillName}.md`)
  let removed = false

  if (existsSync(skillFile)) {
    rmSync(skillDir, { recursive: true, force: true })
    removed = true
  }

  if (existsSync(legacyFile)) {
    unlinkSync(legacyFile)
    removed = true
  }

  return removed
}

function deleteSkillPath(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }

  if (basename(filePath) === 'SKILL.md') {
    rmSync(dirname(filePath), { recursive: true, force: true })
    return
  }

  unlinkSync(filePath)
}

/**
 * Register all skills-related IPC handlers
 */
export function registerSkillsIPCHandlers(): void {
  // Get all skills (global and project)
  ipcMain.handle('skills:getSkills', async (_event, cwd?: string) => {
    try {
      const globalDirs = getGlobalSkillsDirs()
      const globalSkills = globalDirs.flatMap(dir => readSkillsFromDir(dir, 'global'))

      const projectSkills = cwd ? getProjectSkillsDirs(cwd).flatMap(dir => readSkillsFromDir(dir, 'project')) : []

      const pluginSkills = [
        ...readPluginSkills(getGlobalPluginsRoot()),
        ...(cwd ? readPluginSkills(getProjectPluginsRoot(cwd)) : [])
      ]

      // Combine and deduplicate
      const allSkills = [...globalSkills, ...projectSkills, ...pluginSkills]

      return { skills: allSkills }
    } catch (err) {
      console.error('[Skills] Failed to get skills:', err)
      return { skills: [] }
    }
  })

  // Get bundled skills (built into CLI engine binary)
  ipcMain.handle('skills:getBundledSkills', async () => {
    const skills: Skill[] = BUNDLED_SKILLS.map(({ name, description }) => ({
      name,
      description,
      content: getBundledSkillContent(name, description),
      source: 'builtin' as const,
      filePath: `builtin://${name}`,
    }))
    return { skills }
  })

  // Create a new skill
  ipcMain.handle('skills:createSkill', async (_event, name: string, scope: 'global' | 'project', content: string, cwd?: string) => {
    try {
      const dirPath = scope === 'global' ? getGlobalSkillsDirs()[0] : getProjectSkillsDirs(cwd || process.cwd())[0]

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true })
      }

      const filePath = getSkillInstallPath(dirPath, name)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content, 'utf-8')

      const skill: Skill = {
        name,
        description: content.split('\n')[0]?.replace(/^#+\s*/, '') || `Skill: /${name}`,
        content,
        source: scope,
        filePath
      }

      return { skill }
    } catch (err) {
      console.error('[Skills] Failed to create skill:', err)
      throw err
    }
  })

  // Save/update a skill
  ipcMain.handle('skills:saveSkill', async (_event, skill: Skill, content: string) => {
    if (skill.source === 'builtin') {
      throw new Error('Built-in skills cannot be modified')
    }
    try {
      writeFileSync(skill.filePath, content, 'utf-8')

      const updatedSkill: Skill = {
        ...skill,
        content,
        description: content.split('\n')[0]?.replace(/^#+\s*/, '') || skill.description
      }

      return { skill: updatedSkill }
    } catch (err) {
      console.error('[Skills] Failed to save skill:', err)
      throw err
    }
  })

  // Delete a skill
  ipcMain.handle('skills:deleteSkill', async (_event, filePath: string) => {
    if (filePath.startsWith('builtin://')) {
      throw new Error('Built-in skills cannot be deleted')
    }
    try {
      deleteSkillPath(filePath)
      return { success: true }
    } catch (err) {
      console.error('[Skills] Failed to delete skill:', err)
      throw err
    }
  })

  // Search marketplace skills
  ipcMain.handle('skills:searchMarketplace', async (_event, query: string) => {
    try {
      // Use the query parameter to fetch from API, default to 'claude' if empty
      const searchQuery = query && query.trim() ? query.trim() : 'claude'
      const marketplaceSkills = await fetchMarketplaceSkills(searchQuery)
      const globalDirs = getGlobalSkillsDirs()
      const globalSkills = globalDirs.flatMap(dir => readSkillsFromDir(dir, 'global'))

      // Filter by query if provided (for local filtering on top of API results)
      let filtered = marketplaceSkills
      if (query && query.trim()) {
        const lowerQuery = query.toLowerCase()
        filtered = marketplaceSkills.filter(s =>
          s.name.toLowerCase().includes(lowerQuery) ||
          s.source.toLowerCase().includes(lowerQuery)
        )
      }

      // Check installation status
      const withStatus = filtered.map(s => ({
        ...s,
        isInstalled: isSkillInstalled(s.name, globalSkills)
      }))

      return { skills: withStatus }
    } catch (err) {
      console.error('[Skills] Failed to search marketplace:', err)
      return { skills: [] }
    }
  })

  // Install a marketplace skill
  ipcMain.handle('skills:installMarketplaceSkill', async (_event, source: string, skillId: string, global: boolean = true, cwd?: string) => {
    const logs: string[] = []
    
    try {
      // Fetch the skill content from the marketplace
      // The source format is "owner/repo" and skillId is the specific skill file name
      // Build the GitHub raw URL for the skill
      let readmeUrl: string
      
      logs.push(`Installing skill: ${skillId}`)
      logs.push(`Source: ${source}`)
      logs.push(`Scope: ${global ? 'global' : 'project'}`)
      
      if (source.startsWith('http')) {
        // Full URL provided, convert to raw URL
        readmeUrl = source.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
        logs.push(`Using provided URL: ${readmeUrl}`)
      } else {
        // Path format: owner/repo/skillId or owner/repo
        // Need to construct the full path to the skill file
        // The skill file is typically at: owner/repo/skills/{skillId}.md or owner/repo/{skillId}.md
        
        logs.push(`Resolving skill file from GitHub: ${source}`)
        
        // Try common paths for skill files
        // Different repos organize skills differently:
        // - anthropics/skills: skills/{skillId}.md
        // - anthropics/claude-code: plugins/plugin-dev/skills/{skillId}/SKILL.md
        // - others: {skillId}.md or skills/{skillId}.md
        const possiblePaths = [
          // Anthropics claude-code repo structure
          `https://raw.githubusercontent.com/${source}/main/plugins/plugin-dev/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/main/plugins/plugin-dev/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/plugins/plugin-dev/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/plugins/plugin-dev/skills/${skillId}.md`,
          // Standard skills directory structure
          `https://raw.githubusercontent.com/${source}/main/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/skills/${skillId}/SKILL.md`,
          // Root level
          `https://raw.githubusercontent.com/${source}/main/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/main/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/${skillId}/SKILL.md`,
        ]
        
        logs.push(`Searching for skill file in ${possiblePaths.length} possible locations...`)
        
        // Try each path until we find the skill
        let content: string | null = null
        let foundUrl: string | null = null
        
        for (const url of possiblePaths) {
          try {
            logs.push(`Trying: ${url}`)
            const response = await net.fetch(url, {
              method: 'GET',
              headers: {
                'User-Agent': 'Claude-Code-Desktop'
              }
            })
            
            if (response.ok) {
              content = await response.text()
              foundUrl = url
              logs.push(`✓ Found skill file at: ${url}`)
              break
            }
          } catch (e) {
            // Continue to next path
          }
        }
        
        if (!content) {
          throw new Error(`Could not find skill file for ${skillId} in ${source}`)
        }
        
        const scope = global ? 'global' : 'project'
        const dirPath = global ? getGlobalSkillsDirs()[0] : getProjectSkillsDirs(cwd || process.cwd())[0]
        
        logs.push(`Target directory: ${dirPath}`)

        if (!existsSync(dirPath)) {
          logs.push(`Creating directory: ${dirPath}`)
          mkdirSync(dirPath, { recursive: true })
        }

        const filePath = getSkillInstallPath(dirPath, skillId)
        mkdirSync(dirname(filePath), { recursive: true })
        logs.push(`Writing skill file: ${filePath}`)
        writeFileSync(filePath, content, 'utf-8')
        logs.push(`✓ Successfully installed ${skillId} to ${filePath}`)

        return { success: true, skillName: skillId, logs }
      }

      // If we have a full URL, fetch it directly
      logs.push(`Fetching from: ${readmeUrl}`)
      const response = await net.fetch(readmeUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Claude-Code-Desktop'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch skill: HTTP ${response.status}`)
      }

      const content = await response.text()
      logs.push(`✓ Downloaded skill content (${content.length} bytes)`)

      // Use skillId as the file name
      const skillName = skillId || source.split('/').pop()?.replace('.md', '') || 'unknown'
      const scope = global ? 'global' : 'project'
      const dirPath = global ? getGlobalSkillsDirs()[0] : getProjectSkillsDirs(cwd || process.cwd())[0]
      
      logs.push(`Target directory: ${dirPath}`)

      if (!existsSync(dirPath)) {
        logs.push(`Creating directory: ${dirPath}`)
        mkdirSync(dirPath, { recursive: true })
      }

      const filePath = getSkillInstallPath(dirPath, skillName)
      mkdirSync(dirname(filePath), { recursive: true })
      logs.push(`Writing skill file: ${filePath}`)
      writeFileSync(filePath, content, 'utf-8')
      logs.push(`✓ Successfully installed ${skillName} to ${filePath}`)

      return { success: true, skillName, logs }
    } catch (err) {
      console.error('[Skills] Failed to install marketplace skill:', err)
      logs.push(`✗ Error: ${(err as Error).message}`)
      return { success: false, error: (err as Error).message, logs }
    }
  })

  // Uninstall a marketplace skill
  ipcMain.handle('skills:uninstallMarketplaceSkill', async (_event, skillName: string, global: boolean = true, cwd?: string) => {
    try {
      const dirs = global ? getGlobalSkillsDirs() : getProjectSkillsDirs(cwd || process.cwd())
      let removed = false
      for (const dirPath of dirs) {
        removed = removeInstalledSkillFromDir(dirPath, skillName) || removed
      }
      if (!removed) {
        throw new Error(`Skill '${skillName}' is not installed`)
      }

      return { success: true }
    } catch (err) {
      console.error('[Skills] Failed to uninstall marketplace skill:', err)
      throw err
    }
  })

  // Fetch marketplace skill readme
  ipcMain.handle('skills:fetchMarketplaceReadme', async (_event, source: string, skillId: string) => {
    try {
      // Build full GitHub raw URL if source is a path like "owner/repo"
      // The skillId is used to construct the full path to the skill file
      let readmeUrl: string
      if (source.startsWith('http')) {
        // Full URL provided, convert to raw URL
        readmeUrl = source.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
      } else {
        // Path format: owner/repo
        // Try common paths for skill files
        // Different repos organize skills differently:
        // - anthropics/skills: skills/{skillId}.md
        // - anthropics/claude-code: plugins/plugin-dev/skills/{skillId}/SKILL.md
        // - others: {skillId}.md or skills/{skillId}.md
        const possiblePaths = [
          // Anthropics claude-code repo structure
          `https://raw.githubusercontent.com/${source}/main/plugins/plugin-dev/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/main/plugins/plugin-dev/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/plugins/plugin-dev/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/plugins/plugin-dev/skills/${skillId}.md`,
          // Standard skills directory structure
          `https://raw.githubusercontent.com/${source}/main/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/skills/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/skills/${skillId}/SKILL.md`,
          // Root level
          `https://raw.githubusercontent.com/${source}/main/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/main/${skillId}/SKILL.md`,
          `https://raw.githubusercontent.com/${source}/master/${skillId}.md`,
          `https://raw.githubusercontent.com/${source}/master/${skillId}/SKILL.md`,
        ]
        
        // Try each path until we find the skill
        for (const url of possiblePaths) {
          try {
            const response = await net.fetch(url, {
              method: 'GET',
              headers: {
                'User-Agent': 'Claude-Code-Desktop'
              }
            })
            
            if (response.ok) {
              const content = await response.text()
              return { content }
            }
          } catch (e) {
            // Continue to next path
          }
        }
        
        // If none of the paths work, return null
        console.error(`[Skills] Could not find readme for ${skillId} in ${source}`)
        return { content: null }
      }

      // If we have a full URL, fetch it directly
      const response = await net.fetch(readmeUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Claude-Code-Desktop'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch readme: HTTP ${response.status}`)
      }

      const content = await response.text()
      return { content }
    } catch (err) {
      console.error('[Skills] Failed to fetch marketplace readme:', err)
      return { content: null }
    }
  })

  console.log('[Skills] IPC handlers registered')
}

// ==================== Local Library Functions ====================

interface LocalSkill {
  name: string
  description: string
  content: string
  category: string
  tags?: string[]
  sourceDir: string
  skillPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  installedAt?: Date
  bundleId?: string
  bundleName?: string
}

interface LocalSkillBundle {
  id: string                 // bundleDir absolute path
  name: string               // plugin.json.name
  version?: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  keywords?: string[]
  bundleDir: string          // absolute path
  hasHooks: boolean
  hasCommands: boolean
  hasAgents: boolean
  skillCount: number
  isInstalled: boolean
  installedScope?: 'global' | 'project' | 'mixed'
}

const CUSTOM_DIRS_STORAGE_KEY = 'local_skill_custom_dirs'
const CUSTOM_DIRS_FILE = join(app.getPath('userData'), 'custom-skill-dirs.json')

function loadCustomDirsFromFile(): string[] {
  try {
    if (existsSync(CUSTOM_DIRS_FILE)) {
      const content = readFileSync(CUSTOM_DIRS_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (err) {
    console.error('[LocalLibrary] Failed to load custom directories from file:', err)
  }
  return []
}

function saveCustomDirsToFile(directories: string[]): void {
  try {
    writeFileSync(CUSTOM_DIRS_FILE, JSON.stringify(directories, null, 2), 'utf-8')
  } catch (err) {
    console.error('[LocalLibrary] Failed to save custom directories to file:', err)
    throw err
  }
}

function parseYamlFrontMatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  try {
    const yaml = match[1]
    const result: Record<string, any> = {}
    const lines = yaml.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      let value: string | string[] = line.slice(colonIndex + 1).trim()

      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = (value as string).slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
      } else if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
        value = (value as string).slice(1, -1)
      }

      result[key] = value
    }

    return result
  } catch (err) {
    return null
  }
}

function inferCategory(skillPath: string, content: string): string {
  const frontMatter = parseYamlFrontMatter(content)

  if (frontMatter?.category) {
    return frontMatter.category.toLowerCase().replace(/[\s_]+/g, '-')
  }

  const dirName = dirname(skillPath).split(/[\\/]/).pop()?.toLowerCase() || ''
  const categoryMap: Record<string, string> = {
    'frontend': 'frontend-design',
    'ui': 'frontend-design',
    'design': 'frontend-design',
    'css': 'frontend-design',
    'office': 'office',
    'document': 'office',
    'excel': 'office',
    'word': 'office',
    'dev': 'development',
    'code': 'development',
    'programming': 'development',
    'api': 'development',
    'ai': 'ai-ml',
    'ml': 'ai-ml',
    'machine-learning': 'ai-ml',
    'nlp': 'ai-ml',
    'devops': 'devops',
    'docker': 'devops',
    'kubernetes': 'devops',
    'ci': 'devops',
    'creative': 'creative',
    'art': 'creative',
    'image': 'creative',
    'communication': 'communication',
    'chat': 'communication',
    'email': 'communication'
  }

  if (categoryMap[dirName]) {
    return categoryMap[dirName]
  }

  const lowerContent = content.toLowerCase()
  const keywordPatterns: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /react|vue|angular|css|scss|tailwind|frontend/i, category: 'frontend-design' },
    { pattern: /excel|word|powerpoint|office|document|pdf/i, category: 'office' },
    { pattern: /api|rest|graphql|database|sql|backend/i, category: 'development' },
    { pattern: /machine.?learning|deep.?learning|neural|nlp|gpt|llm|ai/i, category: 'ai-ml' },
    { pattern: /docker|kubernetes|ci.?cd|deploy|pipeline/i, category: 'devops' },
    { pattern: /design|ui|ux|figma|sketch|creative|art/i, category: 'creative' },
    { pattern: /slack|discord|email|notification|chat|message/i, category: 'communication' }
  ]

  for (const { pattern, category } of keywordPatterns) {
    if (pattern.test(lowerContent)) {
      return category
    }
  }

  return 'other'
}

function checkSkillInstalled(skillName: string, cwd?: string): boolean {
  const globalDirs = getGlobalSkillsDirs()
  const globalSkills = globalDirs.flatMap(dir => readSkillsFromDir(dir, 'global'))
  if (isSkillInstalled(skillName, globalSkills)) return true

  if (cwd) {
    const projectDirs = getProjectSkillsDirs(cwd)
    const projectSkills = projectDirs.flatMap(dir => readSkillsFromDir(dir, 'project'))
    if (isSkillInstalled(skillName, projectSkills)) return true
  }

  return false
}

function readLocalSkillFile(
  skillFile: string,
  fallbackName: string,
  sourceDir: string,
  cwd?: string,
  bundleId?: string,
  bundleName?: string
): LocalSkill | null {
  try {
    const content = readFileSync(skillFile, 'utf-8')
    const fm = parseYamlFrontMatter(content)
    const name = fm?.name || fallbackName
    const description = fm?.description ||
      content.split('\n').find(line => line.trim() && !line.startsWith('#') && !line.startsWith('---'))?.trim() ||
      `Skill: ${name}`
    const tags = fm?.tags ? (Array.isArray(fm.tags) ? fm.tags : [fm.tags]) : undefined
    return {
      name,
      description,
      content,
      category: inferCategory(skillFile, content),
      tags,
      sourceDir,
      skillPath: skillFile,
      isInstalled: checkSkillInstalled(name, cwd),
      bundleId,
      bundleName
    }
  } catch (err) {
    console.error(`[LocalLibrary] Failed to read skill: ${skillFile}`, err)
    return null
  }
}

function readLocalSkillsFromDir(
  skillsDir: string,
  sourceDir: string,
  cwd?: string,
  bundleId?: string,
  bundleName?: string
): LocalSkill[] {
  if (!existsSync(skillsDir)) return []
  const list: LocalSkill[] = []
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        const skill = readLocalSkillFile(skillFile, entry.name, sourceDir, cwd, bundleId, bundleName)
        if (skill) list.push(skill)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const skillFile = join(skillsDir, entry.name)
        const fallbackName = entry.name.toLowerCase() === 'skill.md'
          ? basename(skillsDir)
          : entry.name.replace(/\.md$/i, '')
        const skill = readLocalSkillFile(skillFile, fallbackName, sourceDir, cwd, bundleId, bundleName)
        if (skill) list.push(skill)
      }
    }
  } catch (err) {
    console.error(`[LocalLibrary] Failed to read skills directory: ${skillsDir}`, err)
  }
  return list
}

function getLocalSkillDirs(rootDir: string): string[] {
  return [
    rootDir,
    join(rootDir, 'skills'),
    join(rootDir, '.claude', 'skills'),
    join(rootDir, '.claude', 'commands')
  ]
}

function readPluginManifest(bundleDir: string): Record<string, any> | null {
  const manifestPath = join(bundleDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    console.error(`[LocalLibrary] Failed to parse plugin.json: ${manifestPath}`, err)
    return null
  }
}

function bundleIsInstalled(bundleName: string, cwd?: string): { installed: boolean; scope?: 'global' | 'project' | 'mixed' } {
  const globalPath = join(getGlobalPluginsRoot(), bundleName, '.claude-plugin', 'plugin.json')
  const projectPath = cwd ? join(getProjectPluginsRoot(cwd), bundleName, '.claude-plugin', 'plugin.json') : ''
  const inGlobal = existsSync(globalPath)
  const inProject = !!projectPath && existsSync(projectPath)
  if (inGlobal && inProject) return { installed: true, scope: 'mixed' }
  if (inGlobal) return { installed: true, scope: 'global' }
  if (inProject) return { installed: true, scope: 'project' }
  return { installed: false }
}

function readBundleSkills(bundleDir: string, bundleId: string, bundleName: string, cwd?: string): LocalSkill[] {
  const list: LocalSkill[] = []
  const seen = new Set<string>()
  for (const skillsDir of [join(bundleDir, 'skills'), join(bundleDir, '.claude', 'skills'), join(bundleDir, '.claude', 'commands')]) {
    for (const skill of readLocalSkillsFromDir(skillsDir, bundleDir, cwd, bundleId, bundleName)) {
      if (seen.has(skill.skillPath)) continue
      seen.add(skill.skillPath)
      list.push(skill)
    }
  }
  return list
}

async function handleScanLocalLibrary(
  _event: Electron.IpcMainInvokeEvent,
  dirPaths: string[],
  cwd?: string
): Promise<{ skills: LocalSkill[]; bundles: LocalSkillBundle[] }> {
  try {
    const allSkills: LocalSkill[] = []
    const allBundles: LocalSkillBundle[] = []

    const tryAsBundle = (bundleDir: string): boolean => {
      const manifest = readPluginManifest(bundleDir)
      if (!manifest) return false
      const bundleName: string = manifest.name || basename(bundleDir)
      const bundleId = bundleDir
      const status = bundleIsInstalled(bundleName, cwd)
      const skills = readBundleSkills(bundleDir, bundleId, bundleName, cwd)
      const author = typeof manifest.author === 'string'
        ? manifest.author
        : (manifest.author?.name || undefined)
      allBundles.push({
        id: bundleId,
        name: bundleName,
        version: manifest.version,
        description: manifest.description,
        author,
        homepage: manifest.homepage,
        license: manifest.license,
        keywords: Array.isArray(manifest.keywords) ? manifest.keywords : undefined,
        bundleDir,
        hasHooks: existsSync(join(bundleDir, 'hooks')),
        hasCommands: existsSync(join(bundleDir, 'commands')),
        hasAgents: existsSync(join(bundleDir, 'agents')),
        skillCount: skills.length,
        isInstalled: status.installed,
        installedScope: status.scope
      })
      allSkills.push(...skills)
      return true
    }

    for (const dirPath of dirPaths) {
      const fullPath = dirPath.startsWith('skills-lib') ? join(app.getAppPath(), dirPath) : dirPath

      if (!existsSync(fullPath)) {
        console.log(`[LocalLibrary] Directory not found: ${fullPath}`)
        continue
      }

      // The custom directory itself may already be a plugin bundle root.
      if (tryAsBundle(fullPath)) {
        continue
      }

      const entries = readdirSync(fullPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = join(fullPath, entry.name)

          // Plugin bundle directory: <subDir>/.claude-plugin/plugin.json
          if (tryAsBundle(subDir)) {
            continue
          }

          const seen = new Set<string>()
          for (const skillsDir of getLocalSkillDirs(subDir)) {
            for (const skill of readLocalSkillsFromDir(skillsDir, fullPath, cwd)) {
              if (seen.has(skill.skillPath)) continue
              seen.add(skill.skillPath)
              allSkills.push(skill)
            }
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const skill = readLocalSkillFile(join(fullPath, entry.name), entry.name.replace(/\.md$/i, ''), fullPath, cwd)
          if (skill) allSkills.push(skill)
        }
      }
    }

    console.log(`[LocalLibrary] Scanned ${allSkills.length} skills, ${allBundles.length} bundles from ${dirPaths.length} directories`)
    return { skills: allSkills, bundles: allBundles }
  } catch (err) {
    console.error('[LocalLibrary] Failed to scan library:', err)
    throw err
  }
}

async function handleInstallLocalBundle(
  _event: Electron.IpcMainInvokeEvent,
  bundleId: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ success: boolean; bundleName: string; targetDir: string }> {
  try {
    const bundleDir = bundleId
    if (!existsSync(bundleDir)) {
      throw new Error(`Bundle source not found: ${bundleDir}`)
    }
    const manifest = readPluginManifest(bundleDir)
    if (!manifest) {
      throw new Error(`Not a valid plugin bundle (missing .claude-plugin/plugin.json): ${bundleDir}`)
    }
    const bundleName: string = manifest.name || basename(bundleDir)
    const root = scope === 'global' ? getGlobalPluginsRoot() : getProjectPluginsRoot(cwd || process.cwd())
    const targetDir = join(root, bundleName)

    if (existsSync(targetDir)) {
      throw new Error(`Bundle '${bundleName}' is already installed at ${targetDir}`)
    }

    mkdirSync(dirname(targetDir), { recursive: true })
    cpSync(bundleDir, targetDir, { recursive: true, force: false })

    console.log(`[LocalLibrary] Installed bundle '${bundleName}' to ${targetDir}`)
    return { success: true, bundleName, targetDir }
  } catch (err) {
    console.error('[LocalLibrary] Failed to install bundle:', err)
    throw err
  }
}

async function handleUninstallLocalBundle(
  _event: Electron.IpcMainInvokeEvent,
  bundleName: string,
  cwd?: string
): Promise<{ success: boolean; removed: string[] }> {
  try {
    const candidates = [
      join(getGlobalPluginsRoot(), bundleName),
      ...(cwd ? [join(getProjectPluginsRoot(cwd), bundleName)] : [])
    ]
    const removed: string[] = []
    for (const target of candidates) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true })
        removed.push(target)
      }
    }
    if (removed.length === 0) {
      throw new Error(`Bundle '${bundleName}' is not installed`)
    }
    console.log(`[LocalLibrary] Uninstalled bundle '${bundleName}' from ${removed.join(', ')}`)
    return { success: true, removed }
  } catch (err) {
    console.error('[LocalLibrary] Failed to uninstall bundle:', err)
    throw err
  }
}

async function handleInstallLocalSkill(
  _event: Electron.IpcMainInvokeEvent,
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string,
  skillPath?: string
): Promise<{ success: boolean }> {
  try {
    const targetDir = scope === 'global' ? getGlobalSkillsDirs()[0] : getProjectSkillsDirs(cwd || process.cwd())[0]

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    const targetPath = getSkillInstallPath(targetDir, skillName)
    const legacyTargetPath = join(targetDir, `${skillName}.md`)

    if (existsSync(targetPath) || existsSync(legacyTargetPath)) {
      throw new Error(`Skill '${skillName}' is already installed`)
    }

    let sourceSkillPath = skillPath
    if (!sourceSkillPath || !existsSync(sourceSkillPath)) {
      const allDirPaths = ['skills-lib']
      const customDirs = loadCustomDirsFromFile()
      allDirPaths.push(...customDirs)

      for (const dirPath of allDirPaths) {
        const fullPath = dirPath.startsWith('skills-lib') ? join(app.getAppPath(), dirPath) : dirPath
        const entries = existsSync(fullPath) ? readdirSync(fullPath, { withFileTypes: true }) : []

        for (const entry of entries) {
          const candidatePath = entry.isDirectory()
            ? join(fullPath, entry.name, 'SKILL.md')
            : entry.isFile() && entry.name.endsWith('.md')
              ? join(fullPath, entry.name)
              : null

          if (!candidatePath || !existsSync(candidatePath)) {
            continue
          }

          const content = readFileSync(candidatePath, 'utf-8')
          const frontMatter = parseYamlFrontMatter(content)
          const candidateName = frontMatter?.name || (entry.isDirectory() ? entry.name : entry.name.replace('.md', ''))
          if (candidateName.toLowerCase() === skillName.toLowerCase()) {
            sourceSkillPath = candidatePath
            break
          }
        }

        if (sourceSkillPath) {
          break
        }
      }
    }

    if (!sourceSkillPath || !existsSync(sourceSkillPath)) {
      throw new Error(`Skill '${skillName}' source not found`)
    }

    mkdirSync(dirname(targetPath), { recursive: true })
    if (basename(sourceSkillPath) === 'SKILL.md') {
      cpSync(dirname(sourceSkillPath), dirname(targetPath), { recursive: true, force: false })
    } else {
      writeFileSync(targetPath, readFileSync(sourceSkillPath, 'utf-8'), 'utf-8')
    }

    console.log(`[LocalLibrary] Installed skill '${skillName}' to ${scope}`)
    return { success: true }
  } catch (err) {
    console.error('[LocalLibrary] Failed to install skill:', err)
    throw err
  }
}

async function handleUninstallLocalSkill(
  _event: Electron.IpcMainInvokeEvent,
  skillName: string,
  cwd?: string
): Promise<{ success: boolean }> {
  try {
    const globalDirs = getGlobalSkillsDirs()
    const projectDirs = cwd ? getProjectSkillsDirs(cwd) : []

    const allDirs = [...globalDirs, ...projectDirs]
    let removed = false

    for (const dir of allDirs) {
      removed = removeInstalledSkillFromDir(dir, skillName) || removed
    }

    if (!removed) {
      throw new Error(`Skill '${skillName}' is not installed`)
    }

    console.log(`[LocalLibrary] Uninstalled skill '${skillName}'`)
    return { success: true }
  } catch (err) {
    console.error('[LocalLibrary] Failed to uninstall skill:', err)
    throw err
  }
}

async function handleGetCustomDirectories(
  _event: Electron.IpcMainInvokeEvent
): Promise<{ directories: string[] }> {
  try {
    const directories = loadCustomDirsFromFile()
    return { directories }
  } catch (err) {
    console.error('[LocalLibrary] Failed to get custom directories:', err)
    return { directories: [] }
  }
}

async function handleAddCustomDirectory(
  _event: Electron.IpcMainInvokeEvent,
  dirPath: string
): Promise<{ success: boolean }> {
  try {
    if (!existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`)
    }

    const directories = loadCustomDirsFromFile()

    if (directories.includes(dirPath)) {
      throw new Error(`Directory already exists: ${dirPath}`)
    }

    directories.push(dirPath)
    saveCustomDirsToFile(directories)

    console.log(`[LocalLibrary] Added custom directory: ${dirPath}`)
    return { success: true }
  } catch (err) {
    console.error('[LocalLibrary] Failed to add custom directory:', err)
    throw err
  }
}

async function handleRemoveCustomDirectory(
  _event: Electron.IpcMainInvokeEvent,
  dirPath: string
): Promise<{ success: boolean }> {
  try {
    let directories = loadCustomDirsFromFile()
    directories = directories.filter(d => d !== dirPath)

    saveCustomDirsToFile(directories)

    console.log(`[LocalLibrary] Removed custom directory: ${dirPath}`)
    return { success: true }
  } catch (err) {
    console.error('[LocalLibrary] Failed to remove custom directory:', err)
    throw err
  }
}

export function registerLocalLibraryIPCHandlers(): void {
  ipcMain.handle('skills:scan-local-library', handleScanLocalLibrary)
  ipcMain.handle('skills:install-local', handleInstallLocalSkill)
  ipcMain.handle('skills:uninstall-local', handleUninstallLocalSkill)
  ipcMain.handle('skills:install-local-bundle', handleInstallLocalBundle)
  ipcMain.handle('skills:uninstall-local-bundle', handleUninstallLocalBundle)
  ipcMain.handle('skills:get-custom-dirs', handleGetCustomDirectories)
  ipcMain.handle('skills:add-custom-dir', handleAddCustomDirectory)
  ipcMain.handle('skills:remove-custom-dir', handleRemoveCustomDirectory)

  console.log('[LocalLibrary] IPC handlers registered')
}


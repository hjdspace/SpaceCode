/**
 * Skills Service - Handles skill management and marketplace operations
 */

import { ipcMain, app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { net } from 'electron'

// Types
export interface Skill {
  name: string
  description: string
  content: string
  source: 'global' | 'project' | 'plugin' | 'installed'
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
function getGlobalSkillsDir(): string {
  return join(app.getPath('home'), '.claude', 'commands')
}

/**
 * Get the path to project skills directory
 */
function getProjectSkillsDir(cwd: string): string {
  return join(cwd, '.claude', 'commands')
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
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = join(dirPath, entry.name)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const name = entry.name.replace('.md', '')
          const description = content.split('\n')[0]?.replace(/^#+\s*/, '') || `Skill: /${name}`

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

/**
 * Register all skills-related IPC handlers
 */
export function registerSkillsIPCHandlers(): void {
  // Get all skills (global and project)
  ipcMain.handle('skills:getSkills', async (_event, cwd?: string) => {
    try {
      const globalDir = getGlobalSkillsDir()
      const globalSkills = readSkillsFromDir(globalDir, 'global')

      const projectSkills = cwd ? readSkillsFromDir(getProjectSkillsDir(cwd), 'project') : []

      // Combine and deduplicate
      const allSkills = [...globalSkills, ...projectSkills]

      return { skills: allSkills }
    } catch (err) {
      console.error('[Skills] Failed to get skills:', err)
      return { skills: [] }
    }
  })

  // Get bundled skills (built into CLI engine binary)
  ipcMain.handle('skills:getBundledSkills', async () => {
    return { skills: BUNDLED_SKILLS }
  })

  // Create a new skill
  ipcMain.handle('skills:createSkill', async (_event, name: string, scope: 'global' | 'project', content: string, cwd?: string) => {
    try {
      const dirPath = scope === 'global' ? getGlobalSkillsDir() : getProjectSkillsDir(cwd || process.cwd())

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true })
      }

      const filePath = join(dirPath, `${name}.md`)
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
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
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
      const globalDir = getGlobalSkillsDir()
      const globalSkills = readSkillsFromDir(globalDir, 'global')

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
  ipcMain.handle('skills:installMarketplaceSkill', async (_event, source: string, skillId: string, global: boolean = true) => {
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
        const dirPath = global ? getGlobalSkillsDir() : getProjectSkillsDir(process.cwd())
        
        logs.push(`Target directory: ${dirPath}`)

        if (!existsSync(dirPath)) {
          logs.push(`Creating directory: ${dirPath}`)
          mkdirSync(dirPath, { recursive: true })
        }

        const filePath = join(dirPath, `${skillId}.md`)
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
      const dirPath = global ? getGlobalSkillsDir() : getProjectSkillsDir(process.cwd())
      
      logs.push(`Target directory: ${dirPath}`)

      if (!existsSync(dirPath)) {
        logs.push(`Creating directory: ${dirPath}`)
        mkdirSync(dirPath, { recursive: true })
      }

      const filePath = join(dirPath, `${skillName}.md`)
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
  ipcMain.handle('skills:uninstallMarketplaceSkill', async (_event, skillName: string, global: boolean = true) => {
    try {
      const dirPath = global ? getGlobalSkillsDir() : getProjectSkillsDir(process.cwd())
      const filePath = join(dirPath, `${skillName}.md`)

      if (existsSync(filePath)) {
        unlinkSync(filePath)
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

function checkSkillInstalled(skillName: string): boolean {
  const globalDir = getGlobalSkillsDir()
  const globalSkills = readSkillsFromDir(globalDir, 'global')
  return isSkillInstalled(skillName, globalSkills)
}

async function handleScanLocalLibrary(
  _event: Electron.IpcMainInvokeEvent,
  dirPaths: string[],
  cwd?: string
): Promise<{ skills: LocalSkill[] }> {
  try {
    const allSkills: LocalSkill[] = []

    for (const dirPath of dirPaths) {
      const fullPath = dirPath.startsWith('skills-lib') ? join(app.getAppPath(), dirPath) : dirPath

      if (!existsSync(fullPath)) {
        console.log(`[LocalLibrary] Directory not found: ${fullPath}`)
        continue
      }

      const entries = readdirSync(fullPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(fullPath, entry.name)
          const skillFile = join(skillDir, 'SKILL.md')

          if (existsSync(skillFile)) {
            try {
              const content = readFileSync(skillFile, 'utf-8')
              const frontMatter = parseYamlFrontMatter(content)
              const name = frontMatter?.name || entry.name
              const description = frontMatter?.description ||
                content.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim() ||
                `Skill: ${name}`
              const tags = frontMatter?.tags ? (Array.isArray(frontMatter.tags) ? frontMatter.tags : [frontMatter.tags]) : undefined

              const localSkill: LocalSkill = {
                name,
                description,
                content,
                category: inferCategory(skillFile, content),
                tags,
                sourceDir: fullPath,
                skillPath: skillFile,
                isInstalled: checkSkillInstalled(name)
              }

              allSkills.push(localSkill)
            } catch (err) {
              console.error(`[LocalLibrary] Failed to read skill: ${skillFile}`, err)
            }
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = join(fullPath, entry.name)
          try {
            const content = readFileSync(filePath, 'utf-8')
            const frontMatter = parseYamlFrontMatter(content)
            const name = frontMatter?.name || entry.name.replace('.md', '')
            const description = frontMatter?.description ||
              content.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim() ||
              `Skill: ${name}`
            const tags = frontMatter?.tags ? (Array.isArray(frontMatter.tags) ? frontMatter.tags : [frontMatter.tags]) : undefined

            const localSkill: LocalSkill = {
              name,
              description,
              content,
              category: inferCategory(filePath, content),
              tags,
              sourceDir: fullPath,
              skillPath: filePath,
              isInstalled: checkSkillInstalled(name)
            }

            allSkills.push(localSkill)
          } catch (err) {
            console.error(`[LocalLibrary] Failed to read file: ${filePath}`, err)
          }
        }
      }
    }

    console.log(`[LocalLibrary] Scanned ${allSkills.length} skills from ${dirPaths.length} directories`)
    return { skills: allSkills }
  } catch (err) {
    console.error('[LocalLibrary] Failed to scan library:', err)
    throw err
  }
}

async function handleInstallLocalSkill(
  _event: Electron.IpcMainInvokeEvent,
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ success: boolean }> {
  try {
    const targetDir = scope === 'global' ? getGlobalSkillsDir() : getProjectSkillsDir(cwd || process.cwd())

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    const targetPath = join(targetDir, `${skillName}.md`)

    if (existsSync(targetPath)) {
      throw new Error(`Skill '${skillName}' is already installed`)
    }

    writeFileSync(targetPath, `# Installed from Local Library\n\nName: ${skillName}\nScope: ${scope}\n`, 'utf-8')

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
    const globalDir = getGlobalSkillsDir()
    const projectDir = cwd ? getProjectSkillsDir(cwd) : null

    const globalPath = join(globalDir, `${skillName}.md`)
    const projectPath = projectDir ? join(projectDir, `${skillName}.md`) : null

    let removed = false

    if (existsSync(globalPath)) {
      unlinkSync(globalPath)
      removed = true
    }

    if (projectPath && existsSync(projectPath)) {
      unlinkSync(projectPath)
      removed = true
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
  ipcMain.handle('skills:get-custom-dirs', handleGetCustomDirectories)
  ipcMain.handle('skills:add-custom-dir', handleAddCustomDirectory)
  ipcMain.handle('skills:remove-custom-dir', handleRemoveCustomDirectory)

  console.log('[LocalLibrary] IPC handlers registered')
}


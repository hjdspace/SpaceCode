import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type SkillSource = 'global' | 'project' | 'plugin' | 'installed'
export type InstalledSource = 'agents' | 'claude'

export interface Skill {
  name: string
  description: string
  content: string
  source: SkillSource
  installedSource?: InstalledSource
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

const SKILLS_STORAGE_KEY = 'claude_desktop_skills'

// Get electron API
const electronAPI = (window as any).electronAPI

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<Skill[]>([])
  const marketplaceSkills = ref<MarketplaceSkill[]>([])
  const loading = ref(false)
  const marketplaceLoading = ref(false)
  const error = ref<string | null>(null)

  const globalSkills = computed(() => skills.value.filter(s => s.source === 'global'))
  const installedSkills = computed(() => skills.value.filter(s => s.source === 'installed'))
  const pluginSkills = computed(() => skills.value.filter(s => s.source === 'plugin'))
  const projectSkills = computed(() => skills.value.filter(s => s.source === 'project'))

  async function fetchSkills(cwd?: string) {
    loading.value = true
    error.value = null
    try {
      // Use IPC instead of HTTP API
      if (electronAPI?.skills?.getSkills) {
        const data = await electronAPI.skills.getSkills(cwd)
        skills.value = (data.skills || []).filter((s: Skill) => s.source !== 'project')
      } else {
        // Fallback: load from localStorage
        const stored = localStorage.getItem(SKILLS_STORAGE_KEY)
        if (stored) {
          skills.value = JSON.parse(stored)
        }
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch skills'
    } finally {
      loading.value = false
    }
  }

  async function createSkill(name: string, scope: 'global' | 'project', content: string, cwd?: string) {
    try {
      if (electronAPI?.skills?.createSkill) {
        const data = await electronAPI.skills.createSkill(name, scope, content, cwd)
        skills.value.push(data.skill)
        // Save to localStorage as fallback
        localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills.value))
        return data.skill
      } else {
        // Fallback: create in memory only
        const skill: Skill = {
          name,
          description: content.split('\n')[0]?.replace(/^#+\s*/, '') || `Skill: /${name}`,
          content,
          source: scope === 'global' ? 'global' : 'project',
          filePath: scope === 'global' ? `~/.claude/commands/${name}.md` : `${cwd}/.claude/commands/${name}.md`
        }
        skills.value.push(skill)
        localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills.value))
        return skill
      }
    } catch (err) {
      console.error('Failed to create skill:', err)
      throw err
    }
  }

  async function saveSkill(skill: Skill, content: string) {
    try {
      if (electronAPI?.skills?.saveSkill) {
        const data = await electronAPI.skills.saveSkill(skill, content)
        const index = skills.value.findIndex(s =>
          s.name === skill.name &&
          s.source === data.skill.source &&
          s.installedSource === data.skill.installedSource
        )
        if (index !== -1) {
          skills.value[index] = data.skill
        }
        localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills.value))
        return data.skill
      } else {
        // Fallback: update in memory
        const index = skills.value.findIndex(s =>
          s.name === skill.name &&
          s.source === skill.source &&
          s.installedSource === skill.installedSource
        )
        if (index !== -1) {
          skills.value[index] = { ...skill, content }
          localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills.value))
        }
        return skill
      }
    } catch (err) {
      console.error('Failed to save skill:', err)
      throw err
    }
  }

  async function deleteSkill(skill: Skill) {
    try {
      if (electronAPI?.skills?.deleteSkill) {
        // Only pass the filePath (serializable string) instead of the whole skill object
        await electronAPI.skills.deleteSkill(skill.filePath)
      }
      skills.value = skills.value.filter(s =>
        !(s.name === skill.name &&
          s.source === skill.source &&
          s.installedSource === skill.installedSource)
      )
      localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills.value))
    } catch (err) {
      console.error('Failed to delete skill:', err)
      throw err
    }
  }

  async function searchMarketplace(query: string) {
    marketplaceLoading.value = true
    try {
      if (electronAPI?.skills?.searchMarketplace) {
        const data = await electronAPI.skills.searchMarketplace(query)
        marketplaceSkills.value = data.skills || []
      } else {
        // Fallback: return empty results
        marketplaceSkills.value = []
      }
    } catch (err) {
      console.error('Failed to search marketplace:', err)
      marketplaceSkills.value = []
    } finally {
      marketplaceLoading.value = false
    }
  }

  async function installMarketplaceSkill(source: string, skillId: string, global: boolean = true): Promise<{ success: boolean; logs: string[]; error?: string }> {
    try {
      if (electronAPI?.skills?.installMarketplaceSkill) {
        const result = await electronAPI.skills.installMarketplaceSkill(source, skillId, global)
        return result
      }
      return { success: false, logs: ['Electron API not available'], error: 'Electron API not available' }
    } catch (err) {
      console.error('Failed to install skill:', err)
      throw err
    }
  }

  async function uninstallMarketplaceSkill(skillName: string, global: boolean = true) {
    try {
      if (electronAPI?.skills?.uninstallMarketplaceSkill) {
        await electronAPI.skills.uninstallMarketplaceSkill(skillName, global)
      }
      return true
    } catch (err) {
      console.error('Failed to uninstall skill:', err)
      throw err
    }
  }

  async function fetchMarketplaceReadme(source: string, skillId: string) {
    try {
      if (electronAPI?.skills?.fetchMarketplaceReadme) {
        return await electronAPI.skills.fetchMarketplaceReadme(source, skillId)
      }
      return null
    } catch (err) {
      console.error('Failed to fetch readme:', err)
      return null
    }
  }

  return {
    skills,
    marketplaceSkills,
    loading,
    marketplaceLoading,
    error,
    globalSkills,
    installedSkills,
    pluginSkills,
    projectSkills,
    fetchSkills,
    createSkill,
    saveSkill,
    deleteSkill,
    searchMarketplace,
    installMarketplaceSkill,
    uninstallMarketplaceSkill,
    fetchMarketplaceReadme
  }
})

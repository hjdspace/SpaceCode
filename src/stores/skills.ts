import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'

export type SkillSource = 'global' | 'project' | 'plugin' | 'installed' | 'builtin'
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
  const builtinSkills = computed(() => skills.value.filter(s => s.source === 'builtin'))

  async function fetchSkills(cwd?: string) {
    loading.value = true
    error.value = null
    try {
      let userSkills: Skill[] = []
      const data = await api.skills.getSkills(cwd)
      userSkills = data.skills || []

      let bundled: Skill[] = []
      const bundledData = await api.skills.getBundledSkills()
      bundled = bundledData.skills || []

      skills.value = [...userSkills, ...bundled]
    } catch (err) {
      console.error('Failed to fetch skills:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch skills'
    } finally {
      loading.value = false
    }
  }

  async function createSkill(name: string, scope: 'global' | 'project', content: string, cwd?: string) {
    try {
      const data = await api.skills.createSkill(name, scope, content, cwd)
      if (data?.skill) {
        skills.value.push(data.skill)
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
    if (skill.source === 'builtin') {
      throw new Error('Built-in skills cannot be modified')
    }
    try {
      const data = await api.skills.saveSkill(skill, content)
      if (data?.skill) {
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
    if (skill.source === 'builtin') {
      throw new Error('Built-in skills cannot be deleted')
    }
    try {
      await api.skills.deleteSkill(skill.filePath)
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
      const data = await api.skills.searchMarketplace(query)
      marketplaceSkills.value = data.skills || []
    } catch (err) {
      console.error('Failed to search marketplace:', err)
      marketplaceSkills.value = []
    } finally {
      marketplaceLoading.value = false
    }
  }

  async function installMarketplaceSkill(source: string, skillId: string, global: boolean = true, cwd?: string): Promise<{ success: boolean; logs: string[]; error?: string }> {
    try {
      const result = await api.skills.installMarketplaceSkill(source, skillId, global, cwd)
      return result
    } catch (err) {
      console.error('Failed to install skill:', err)
      throw err
    }
  }

  async function uninstallMarketplaceSkill(skillName: string, global: boolean = true, cwd?: string) {
    try {
      await api.skills.uninstallMarketplaceSkill(skillName, global, cwd)
      return true
    } catch (err) {
      console.error('Failed to uninstall skill:', err)
      throw err
    }
  }

  async function fetchMarketplaceReadme(source: string, skillId: string) {
    try {
      return await api.skills.fetchMarketplaceReadme(source, skillId)
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
    builtinSkills,
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

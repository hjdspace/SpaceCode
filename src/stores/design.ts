import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { QuestionFormBlock } from '@/utils/design/questionForm'
import { getTemplateById } from '@/lib/design/templates'

export interface DesignSystem { id: string; name: string; category: string }
export interface DesignSkill { id: string; name: string; description: string; mode?: string }
export interface ArtifactFile { name: string; path: string; updatedAt: number }
export interface NextStepAction { label: string; prompt: string }
export interface DesignUsage {
  inputTokens: number; outputTokens: number; costUsd: number; durationMs: number
}

export const useDesignStore = defineStore('design', () => {
  // 会话关联
  const activeSessionId = ref<string | null>(null)
  const designWorkspace = ref<string>('')

  // 实时预览与产物
  const previewHtml = ref<string>('')
  const previewTitle = ref<string>('Design Preview')
  const artifactFiles = ref<ArtifactFile[]>([])
  const selectedArtifactPath = ref<string | null>(null)

  // Question-Form 发现表单
  const pendingQuestionForm = ref<QuestionFormBlock | null>(null)

  // FileWorkspace 多 tab
  const openTabs = ref<ArtifactFile[]>([])
  const activeTabPath = ref<string | null>(null)

  // 用量与建议动作
  const lastUsage = ref<DesignUsage | null>(null)
  const nextStepActions = ref<NextStepAction[]>([])

  // DesignToolboxPanel
  const toolboxSkills = ref<DesignSkill[]>([
    { id: 'huashu-design', name: '华术设计 (Huashu Design)', description: '遵循大师级中文设计师章程，5维度精细打磨，杜绝 AI 垃圾套路' },
    { id: 'canvas-design', name: 'Canvas 互动设计', description: '基于 Canvas API/WebGL 的高动效、高保真游戏化 UI 设计' },
    { id: 'ui-ux-pro-max', name: 'UI/UX Pro Max', description: '高品质多文件响应式 Web 原型系统设计，支持 Tailwind' },
    { id: 'html-ppt-skill', name: '演示文稿专家 (Morph PPT)', description: 'HTML 动态转场幻灯片设计模式' },
  ])
  const selectedToolboxSkillId = ref<string>('huashu-design')

  const currentToolboxSkill = computed(() =>
    toolboxSkills.value.find(s => s.id === selectedToolboxSkillId.value) || null,
  )

  // 模板与设计系统选择
  const selectedTemplateId = ref<string | null>(null)
  const selectedDesignSystemId = ref<string | null>(null)
  const selectedDesignSystemName = ref<string | null>(null)

  const currentTemplate = computed(() =>
    selectedTemplateId.value ? getTemplateById(selectedTemplateId.value) : null,
  )

  function setPendingQuestionForm(form: QuestionFormBlock | null) {
    pendingQuestionForm.value = form
  }
  function clearPendingQuestionForm() { pendingQuestionForm.value = null }
  function updateArtifactFiles(files: ArtifactFile[]) { artifactFiles.value = files }

  function addTab(file: ArtifactFile) {
    if (openTabs.value.some(t => t.path === file.path)) {
      activeTabPath.value = file.path
      return
    }
    openTabs.value.push(file)
    activeTabPath.value = file.path
  }
  function removeTab(path: string) {
    const idx = openTabs.value.findIndex(t => t.path === path)
    if (idx === -1) return
    openTabs.value.splice(idx, 1)
    if (activeTabPath.value === path) {
      const next = openTabs.value[idx] || openTabs.value[idx - 1] || null
      activeTabPath.value = next ? next.path : null
    }
  }
  function setActiveTab(path: string) { activeTabPath.value = path }

  function setUsage(u: DesignUsage) { lastUsage.value = u }
  function setNextStepActions(actions: NextStepAction[]) { nextStepActions.value = actions }

  return {
    activeSessionId, designWorkspace, previewHtml, previewTitle,
    artifactFiles, selectedArtifactPath, pendingQuestionForm,
    openTabs, activeTabPath, lastUsage, nextStepActions,
    toolboxSkills, selectedToolboxSkillId, currentToolboxSkill,
    selectedTemplateId, selectedDesignSystemId, selectedDesignSystemName, currentTemplate,
    setPendingQuestionForm, clearPendingQuestionForm, updateArtifactFiles,
    addTab, removeTab, setActiveTab, setUsage, setNextStepActions,
  }
})

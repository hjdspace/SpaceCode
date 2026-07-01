<template>
  <div class="editor-overlay" @click.self="$emit('close')">
    <div class="editor-modal">
      <div class="editor-header">
        <h2>{{ t('customAssistant.title') }}</h2>
        <button class="close-btn" @click="$emit('close')">
          <X :size="18" />
        </button>
      </div>

      <div class="editor-body">
        <!-- 模板快选 -->
        <div class="form-section">
          <div class="form-label">{{ t('customAssistant.templates') }}</div>
          <div class="template-chips">
            <button
              v-for="tpl in templates"
              :key="tpl.name"
              class="template-chip"
              @click="applyTemplate(tpl)"
            >
              <span class="tpl-emoji">{{ tpl.avatar }}</span>
              {{ t(`customAssistant.tpl_${tpl.name}`) }}
            </button>
          </div>
        </div>

        <!-- 基本信息 -->
        <div class="form-row">
          <div class="form-section">
            <div class="form-label">{{ t('customAssistant.name') }}</div>
            <input v-model="form.name" type="text" placeholder="my-ppt-assistant" class="form-input" />
          </div>
          <div class="form-section">
            <div class="form-label">{{ t('customAssistant.displayName') }}</div>
            <input v-model="form.descriptionZh" type="text" :placeholder="t('customAssistant.displayNamePlaceholder')" class="form-input" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-section form-avatar">
            <div class="form-label">{{ t('customAssistant.avatar') }}</div>
            <input v-model="form.avatar" type="text" placeholder="📊" class="form-input emoji-input" />
          </div>
          <div class="form-section">
            <div class="form-label">{{ t('customAssistant.mode') }}</div>
            <select v-model="form.mode" class="form-select">
              <option value="work">{{ t('customAssistant.modeWork') }}</option>
              <option value="code">{{ t('customAssistant.modeCode') }}</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <div class="form-label">{{ t('customAssistant.description') }}</div>
          <textarea v-model="form.description" :placeholder="t('customAssistant.descriptionPlaceholder')" class="form-textarea" rows="2"></textarea>
        </div>

        <!-- 技能绑定 -->
        <div class="form-section">
          <div class="form-label">
            {{ t('customAssistant.skills') }}
            <span class="form-hint">{{ t('customAssistant.skillsHint') }}</span>
          </div>
          <div class="skill-checkbox-group">
            <label
              v-for="skill in availableSkills"
              :key="skill.name"
              class="skill-checkbox-item"
              :class="{ 'skill-unavailable': !skill.available }"
            >
              <input
                type="checkbox"
                :value="skill.name"
                v-model="form.skills"
                :disabled="!skill.available"
              />
              <span class="skill-name">{{ skill.name }}</span>
              <span class="skill-desc">{{ skill.description }}</span>
            </label>
          </div>
        </div>

        <!-- 模型与权限 -->
        <div class="form-row">
          <div class="form-section">
            <div class="form-label">{{ t('customAssistant.model') }}</div>
            <select v-model="form.model" class="form-select">
              <option value="">{{ t('customAssistant.modelDefault') }}</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          <div class="form-section">
            <div class="form-label">{{ t('customAssistant.permission') }}</div>
            <select v-model="form.permission" class="form-select">
              <option value="acceptEdits">acceptEdits</option>
              <option value="default">default</option>
              <option value="plan">plan</option>
              <option value="bypassPermissions">bypassPermissions</option>
            </select>
          </div>
        </div>

        <!-- 推荐 prompt -->
        <div class="form-section">
          <div class="form-label">{{ t('customAssistant.recommendedPrompts') }}</div>
          <textarea
            v-model="recommendedPromptsText"
            :placeholder="t('customAssistant.recommendedPromptsPlaceholder')"
            class="form-textarea"
            rows="3"
          ></textarea>
        </div>

        <!-- 系统提示 -->
        <div class="form-section">
          <div class="form-label">{{ t('customAssistant.systemPrompt') }}</div>
          <textarea
            v-model="form.content"
            :placeholder="t('customAssistant.systemPromptPlaceholder')"
            class="form-textarea content-textarea"
            rows="6"
          ></textarea>
        </div>
      </div>

      <div class="editor-actions">
        <button class="btn-cancel" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn-save" @click="saveAssistant">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'

const { t } = useI18n()

const emit = defineEmits<{
  close: []
  saved: [name: string]
}>()

const form = ref({
  name: '',
  description: '',
  descriptionZh: '',
  avatar: '🤖',
  mode: 'work' as 'work' | 'code',
  category: 'custom',
  model: '',
  permission: 'acceptEdits',
  skills: [] as string[],
  content: '',
  recommendedPrompts: [] as string[],
  recommendedPromptsZh: [] as string[],
})

const officeCliAvailable = ref(false)

const templates = [
  {
    name: 'custom-ppt',
    avatar: '📊',
    mode: 'work' as const,
    skills: ['officecli-pptx'],
    content: '你是一个专业的 PPT 制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .pptx 文件。',
  },
  {
    name: 'custom-word',
    avatar: '📝',
    mode: 'work' as const,
    skills: ['officecli-docx'],
    content: '你是一个专业的 Word 文档制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .docx 文件。',
  },
  {
    name: 'custom-excel',
    avatar: '📈',
    mode: 'work' as const,
    skills: ['officecli-xlsx'],
    content: '你是一个专业的 Excel 表格制作助手。根据用户需求，使用 officecli 创建高质量的可编辑 .xlsx 文件。',
  },
  {
    name: 'custom-multi',
    avatar: '🚀',
    mode: 'work' as const,
    skills: ['officecli-pptx', 'officecli-docx', 'officecli-xlsx'],
    content: '你是一个全能办公助手，能同时处理 PPT、Word、Excel 三种格式。根据用户需求选择合适的技能。',
  },
]

/** 已知的办公技能列表 */
const knownSkills = [
  { name: 'officecli-pptx', description: 'OfficeCLI PPT 创建' },
  { name: 'officecli-docx', description: 'OfficeCLI Word 创建' },
  { name: 'officecli-xlsx', description: 'OfficeCLI Excel 创建' },
  { name: 'morph-ppt', description: 'Morph 动画 PPT' },
  { name: 'morph-ppt-3d', description: '3D Morph PPT' },
  { name: 'officecli-pitch-deck', description: '融资路演 Deck' },
  { name: 'officecli-academic-paper', description: '学术论文' },
  { name: 'officecli-financial-model', description: '财务模型' },
  { name: 'officecli-data-dashboard', description: '数据看板' },
  { name: 'officecli-word-form', description: 'Word 表单' },
  { name: 'pptx', description: 'Node PPT (降级)' },
  { name: 'docx', description: 'Node Word (降级)' },
  { name: 'xlsx', description: 'Node Excel (降级)' },
]

const availableSkills = computed(() =>
  knownSkills.map(s => ({
    ...s,
    available: s.name.startsWith('officecli') || s.name.startsWith('morph')
      ? officeCliAvailable.value
      : true,
  })),
)

const recommendedPromptsText = computed({
  get: () => form.value.recommendedPromptsZh?.join('\n') || '',
  set: (val: string) => {
    form.value.recommendedPromptsZh = val.split('\n').filter(s => s.trim())
    form.value.recommendedPrompts = form.value.recommendedPromptsZh
  },
})

function applyTemplate(tpl: typeof templates[0]) {
  form.value.name = tpl.name
  form.value.avatar = tpl.avatar
  form.value.mode = tpl.mode
  form.value.skills = [...tpl.skills]
  form.value.content = tpl.content
}

onMounted(async () => {
  try {
    officeCliAvailable.value = await api.officecli.checkInstalled()
  } catch { /* ignore */ }
})

async function saveAssistant() {
  if (!form.value.name) {
    alert(t('customAssistant.errorNameRequired'))
    return
  }
  if (!/^[a-zA-Z0-9-]+$/.test(form.value.name)) {
    alert(t('customAssistant.errorNameInvalid'))
    return
  }

  const frontmatter: Record<string, unknown> = {
    name: form.value.name,
    mode: form.value.mode,
    category: form.value.category,
    description: form.value.description,
    description_zh: form.value.descriptionZh,
    avatar: form.value.avatar,
    model: form.value.model || undefined,
    permission: form.value.permission,
    skills: form.value.skills,
    recommendedPrompts: form.value.recommendedPrompts,
    recommendedPrompts_zh: form.value.recommendedPromptsZh,
    skill_runtime: form.value.skills.some(s => s.startsWith('officecli') || s.startsWith('morph'))
      ? 'officecli'
      : 'none',
  }

  Object.keys(frontmatter).forEach(k => {
    if (frontmatter[k] === undefined || frontmatter[k] === '' || frontmatter[k] === null) {
      delete frontmatter[k]
    }
  })

  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}: [${v.map(yamlEscape).join(', ')}]`
      }
      return `${k}: ${yamlEscape(v)}`
    })
    .join('\n')

  const mdContent = `---\n${yaml}\n---\n\n${form.value.content || ''}\n`

  try {
    await api.agents.saveCustom(form.value.name, mdContent)
    emit('saved', form.value.name)
    emit('close')
  } catch (err) {
    alert(t('customAssistant.errorSave') + ': ' + (err instanceof Error ? err.message : String(err)))
  }
}

function yamlEscape(v: unknown): string {
  const s = String(v)
  if (/[:#\[{}\],&*!|>'"%@\n\r]/.test(s) || s.includes(' ')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}
</script>

<style lang="scss" scoped>
.editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.editor-modal {
  width: 640px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
}

.close-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--text-primary); background: var(--surface-glass-hover); }
}

.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.form-section {
  margin-bottom: 14px;
}

.form-row {
  display: flex;
  gap: 12px;
  .form-section { flex: 1; }
}

.form-avatar { max-width: 80px; }

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.form-input, .form-select, .form-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-secondary, var(--surface-glass));
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  &:focus { outline: none; border-color: var(--accent-primary); }
}

.form-textarea {
  resize: vertical;
  line-height: 1.5;
}

.content-textarea {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.emoji-input { text-align: center; font-size: 18px; }

.template-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 16px);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .tpl-emoji { font-size: 14px; }
}

.skill-checkbox-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 6px;
}

.skill-checkbox-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  font-size: 12px;

  &:hover { background: var(--surface-glass-hover); }
  &.skill-unavailable { opacity: 0.4; cursor: not-allowed; }

  input[type="checkbox"] {
    margin-top: 2px;
    accent-color: var(--accent-primary);
  }

  .skill-name {
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .skill-desc {
    color: var(--text-muted);
    font-size: 11px;
  }
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--surface-border);
}

.btn-cancel, .btn-save {
  padding: 7px 18px;
  font-size: 13px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--surface-border);
  transition: all 0.15s;
}

.btn-cancel {
  background: transparent;
  color: var(--text-secondary);
  &:hover { background: var(--surface-glass-hover); }
}

.btn-save {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
  &:hover { opacity: 0.9; }
}
</style>

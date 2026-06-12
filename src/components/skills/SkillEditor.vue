<template>
  <div class="skill-editor">
    <!-- Toolbar -->
    <div class="editor-toolbar">
      <div class="toolbar-left">
        <span class="skill-name">/{{ skill.name }}</span>
        <span v-if="isDirty" class="dirty-indicator" :title="t('skills.editor.unsavedChanges')" />
        <span class="source-badge" :class="skill.source">
          <Globe v-if="skill.source === 'global'" :size="10" />
          <FolderOpen v-else-if="skill.source === 'installed'" :size="10" />
          <FolderOpen v-else-if="skill.source === 'project'" :size="10" />
          <Zap v-else :size="10" />
          {{ sourceLabel }}
        </span>
      </div>

      <div class="toolbar-right">
        <button
          class="toolbar-btn translate-btn"
          :class="{ active: isTranslated }"
          @click="handleToggleTranslation"
          :disabled="isTranslating"
          :title="isTranslated ? t('skills.showOriginal') : t('skills.translateToChinese')"
        >
          <Loader2 v-if="isTranslating" :size="12" class="spin" />
          <Languages v-else :size="12" />
          <span class="translate-label">
            {{ isTranslating ? '...' : isTranslated ? t('skills.showOriginal') : t('skills.translate') }}
          </span>
        </button>

        <template v-if="!isReadonly">
          <button
            class="toolbar-btn"
            :class="{ active: viewMode === 'edit' }"
            @click="viewMode = 'edit'"
            :title="t('skills.editor.edit')"
          >
            <Pencil :size="12" />
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: viewMode === 'preview' }"
            @click="viewMode = 'preview'"
            :title="t('skills.editor.preview')"
          >
            <Eye :size="12" />
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: viewMode === 'split' }"
            @click="viewMode = 'split'"
            :title="t('skills.editor.splitView')"
          >
            <Columns :size="12" />
          </button>

          <div class="toolbar-divider" />

          <button
            class="btn btn-primary save-btn"
            :disabled="!isDirty || saving"
            @click="handleSave"
          >
            <Loader2 v-if="saving" :size="12" class="spin" />
            <Save v-else :size="12" />
            {{ saving ? t('skills.editor.saving') : saved ? t('skills.editor.saved') : t('skills.editor.save') }}
          </button>

          <button
            class="toolbar-btn"
            :class="{ 'btn-danger': confirmDelete }"
            @click="handleDelete"
          >
            <Trash2 :size="12" />
          </button>
        </template>
      </div>
    </div>

    <!-- Content area -->
    <div class="editor-content">
      <template v-if="viewMode === 'edit'">
        <textarea
          v-model="content"
          class="editor-textarea"
          :placeholder="t('skills.editor.enterMarkdown')"
          @keydown="handleKeyDown"
        />
      </template>

      <template v-else-if="viewMode === 'preview'">
        <div class="preview-content" v-html="renderedContent" />
      </template>

      <template v-else-if="viewMode === 'split'">
        <div class="split-view">
          <textarea
            v-model="content"
            class="editor-textarea split-left"
            placeholder="Enter skill content in Markdown..."
            @keydown="handleKeyDown"
          />
          <div class="preview-content split-right" v-html="renderedContent" />
        </div>
      </template>
    </div>

    <!-- Footer -->
    <div class="editor-footer">
      <span class="file-path">{{ skill.filePath }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Save, Trash2, Pencil, Eye, Columns, Loader2, Globe, FolderOpen, Languages, Zap
} from 'lucide-vue-next'
import type { Skill } from '@/stores/skills'
import { marked } from 'marked'
import { useSkillTranslation } from '@/composables/useSkillTranslation'

const { t } = useI18n()

interface Props {
  skill: Skill
}

const props = defineProps<Props>()
const emit = defineEmits<{
  save: [skill: Skill, content: string]
  delete: [skill: Skill]
}>()

type ViewMode = 'edit' | 'preview' | 'split'

const content = ref(props.skill.content)
const viewMode = ref<ViewMode>(props.skill.source === 'builtin' ? 'preview' : 'edit')
const saving = ref(false)
const saved = ref(false)
const confirmDelete = ref(false)

const isReadonly = computed(() => props.skill.source === 'builtin')

const {
  isTranslating,
  isTranslated,
  displayContent,
  resetTranslation,
  toggleTranslation,
} = useSkillTranslation(() => content.value)

const isDirty = computed(() => !isReadonly.value && content.value !== props.skill.content)

const sourceLabel = computed(() => {
  if (props.skill.source === 'builtin') {
    return t('skills.builtin')
  }
  if (props.skill.source === 'installed' && props.skill.installedSource) {
    return `installed:${props.skill.installedSource}`
  }
  return props.skill.source
})

const renderedContent = computed(() => {
  return marked(displayContent.value || '', { gfm: true })
})

watch(() => props.skill, (newSkill) => {
  content.value = newSkill.content
  viewMode.value = newSkill.source === 'builtin' ? 'preview' : 'edit'
  confirmDelete.value = false
  saved.value = false
  resetTranslation()
}, { deep: true })

async function handleToggleTranslation() {
  const switchingToTranslation = !isTranslated.value
  await toggleTranslation()
  if (switchingToTranslation && isTranslated.value && viewMode.value === 'edit') {
    viewMode.value = 'preview'
  }
}

async function handleSave() {
  if (isReadonly.value) return
  saving.value = true
  try {
    await emit('save', props.skill, content.value)
    saved.value = true
    setTimeout(() => saved.value = false, 2000)
  } finally {
    saving.value = false
  }
}

function handleDelete() {
  if (isReadonly.value) return
  if (confirmDelete.value) {
    emit('delete', props.skill)
    confirmDelete.value = false
  } else {
    confirmDelete.value = true
    setTimeout(() => confirmDelete.value = false, 3000)
  }
}

function handleKeyDown(e: KeyboardEvent) {
  // Tab indentation
  if (e.key === 'Tab') {
    e.preventDefault()
    const target = e.target as HTMLTextAreaElement
    const start = target.selectionStart
    const end = target.selectionEnd
    content.value = content.value.substring(0, start) + '  ' + content.value.substring(end)
    nextTick(() => {
      target.selectionStart = start + 2
      target.selectionEnd = start + 2
    })
  }

  // Ctrl/Cmd + S to save
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    if (isDirty.value) handleSave()
  }
}
</script>

<style lang="scss" scoped>
.skill-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skill-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  flex-shrink: 0;

  &.global {
    border-color: #10b981;
    color: #10b981;
  }

  &.installed {
    border-color: #f59e0b;
    color: #f59e0b;
  }

  &.builtin {
    border-color: #6366f1;
    color: #6366f1;
  }
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.translate-btn {
    width: auto;
    padding: 0 8px;
    gap: 4px;
    font-size: 11px;
  }

  &.btn-danger {
    background: var(--error);
    color: white;

    &:hover {
      background: #c82333;
    }
  }
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border-default);
  margin: 0 4px;
}

.save-btn {
  padding: 6px 12px;
  font-size: 12px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 4px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.editor-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-textarea {
  width: 100%;
  height: 100%;
  padding: 16px;
  border: none;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;

  &::placeholder {
    color: var(--text-muted);
  }
}

.preview-content {
  width: 100%;
  height: 100%;
  padding: 16px;
  overflow: auto;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-size-base);
  line-height: 1.6;

  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    margin-top: 16px;
    margin-bottom: 8px;
    font-weight: 600;
  }

  :deep(p) {
    margin-bottom: 12px;
  }

  :deep(ul), :deep(ol) {
    margin-bottom: 12px;
    padding-left: 24px;
  }

  :deep(code) {
    padding: 2px 6px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  :deep(pre) {
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 6px;
    overflow: auto;
    margin-bottom: 12px;

    code {
      padding: 0;
      background: transparent;
    }
  }
}

.split-view {
  display: flex;
  height: 100%;
}

.split-left {
  flex: 1;
  border-right: 1px solid var(--border-default);
}

.split-right {
  flex: 1;
}

.editor-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.file-path {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
}
</style>

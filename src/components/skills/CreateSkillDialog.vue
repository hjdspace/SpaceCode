<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay" @click.self="handleClose">
        <div class="dialog-content">
          <div class="dialog-header">
            <h3 class="dialog-title">{{ t('skills.create.title') }}</h3>
            <p class="dialog-desc">{{ t('skills.create.description') }}</p>
          </div>

          <div class="dialog-body">
            <!-- Name input -->
            <div class="form-group">
              <label class="form-label">{{ t('skills.create.skillName') }}</label>
              <div class="name-input-wrapper">
                <span class="name-prefix">/</span>
                <input
                  v-model="name"
                  type="text"
                  class="form-input"
                  placeholder="my-skill"
                  @keydown.enter="handleCreate"
                />
              </div>
            </div>

            <!-- Scope selection -->
            <div class="form-group">
              <label class="form-label">{{ t('skills.create.scope') }}</label>
              <div class="scope-options">
                <button
                  class="scope-btn"
                  :class="{ active: scope === 'project' }"
                  @click="scope = 'project'"
                >
                  <FolderOpen :size="16" />
                  {{ t('skills.create.project') }}
                </button>
                <button
                  class="scope-btn"
                  :class="{ active: scope === 'global' }"
                  @click="scope = 'global'"
                >
                  <Globe :size="16" />
                  {{ t('skills.create.global') }}
                </button>
              </div>
              <p class="scope-desc">
                {{ scope === 'project'
                  ? t('skills.create.projectScopeDesc')
                  : t('skills.create.globalScopeDesc') }}
              </p>
            </div>

            <!-- Template selection -->
            <div class="form-group">
              <label class="form-label">{{ t('skills.create.template') }}</label>
              <div class="template-options">
                <button
                  v-for="(tpl, i) in templates"
                  :key="tpl.labelKey"
                  class="template-btn"
                  :class="{ active: templateIdx === i }"
                  @click="templateIdx = i"
                >
                  {{ t(tpl.labelKey) }}
                </button>
              </div>
            </div>

            <p v-if="error" class="error-text">{{ error }}</p>
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="handleClose" :disabled="creating">
              {{ t('skills.create.cancel') }}
            </button>
            <button class="btn btn-primary" @click="handleCreate" :disabled="creating || !isValid">
              <Loader2 v-if="creating" :size="16" class="spin" />
              <Plus v-else :size="16" />
              {{ creating ? t('skills.create.creating') : t('skills.create.createSkill') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, FolderOpen, Globe, Loader2 } from 'lucide-vue-next'

interface Template {
  labelKey: string
  content: string
}

const { t } = useI18n()

const templates: Template[] = [
  { labelKey: 'skills.create.blank', content: '' },
  {
    labelKey: 'skills.create.commitHelper',
    content: `# Commit Helper

Review the staged changes and generate a concise, descriptive commit message following conventional commit format.

Rules:
- Use conventional commit prefixes: feat, fix, refactor, docs, test, chore
- Keep the first line under 72 characters
- Add a blank line and detailed description if needed
- Reference relevant issue numbers if applicable
`
  },
  {
    labelKey: 'skills.create.codeReviewer',
    content: `# Code Reviewer

Review the provided code and give feedback on:

1. **Correctness** - Logic errors, edge cases, potential bugs
2. **Performance** - Inefficiencies, unnecessary allocations
3. **Readability** - Naming, structure, comments where needed
4. **Security** - Input validation, injection risks, data exposure

Be specific with line references. Suggest concrete improvements, not just problems.
`
  }
]

interface Props {
  open: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  create: [name: string, scope: 'global' | 'project', content: string]
}>()

const name = ref('')
const scope = ref<'global' | 'project'>('project')
const templateIdx = ref(0)
const creating = ref(false)
const error = ref('')

const isValid = computed(() => {
  const trimmed = name.value.trim()
  return trimmed && /^[a-zA-Z0-9_-]+$/.test(trimmed)
})

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    name.value = ''
    scope.value = 'project'
    templateIdx.value = 0
    error.value = ''
    creating.value = false
  }
})

function handleClose() {
  if (!creating.value) {
    emit('update:open', false)
  }
}

async function handleCreate() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('skills.create.nameRequired')
    return
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    error.value = t('skills.create.nameInvalid')
    return
  }

  creating.value = true
  error.value = ''

  try {
    await emit('create', trimmed, scope.value, templates[templateIdx.value].content)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create skill'
  } finally {
    creating.value = false
  }
}
</script>

<style lang="scss" scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog-content {
  width: 100%;
  max-width: 420px;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  padding: 20px 20px 0;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.dialog-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.name-input-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.name-prefix {
  color: var(--text-muted);
  font-size: 14px;
}

.form-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-base);
  outline: none;

  &::placeholder {
    color: var(--text-muted);
  }
}

.scope-options {
  display: flex;
  gap: 8px;
}

.scope-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }
}

.scope-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.template-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.template-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }
}

.error-text {
  font-size: 12px;
  color: var(--error);
  margin: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 20px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
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

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover:not(:disabled) {
      background: var(--bg-hover);
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

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>

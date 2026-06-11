<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay" @click.self="handleClose">
        <div class="dialog-content">
          <div class="dialog-header">
            <h3 class="dialog-title">
              {{ isEditing ? `${t('mcpSettings.editServer')}: ${originalName}` : t('mcpSettings.addMcpServer') }}
            </h3>
          </div>

          <div class="dialog-body">
            <!-- Server Name -->
            <div class="form-group">
              <label class="form-label">{{ t('mcpSettings.serverName') }}</label>
              <input
                v-model="form.name"
                type="text"
                class="form-input"
                placeholder="my-mcp-server"
                :disabled="isEditing"
              />
            </div>

            <!-- Edit Mode Toggle -->
            <div class="form-group">
              <label class="form-label">{{ t('mcpSettings.editMode') }}</label>
              <div class="mode-toggle">
                <button
                  class="mode-btn"
                  :class="{ active: !jsonMode }"
                  @click="jsonMode = false"
                >
                  {{ t('mcpSettings.form') }}
                </button>
                <button
                  class="mode-btn"
                  :class="{ active: jsonMode }"
                  @click="switchToJsonMode"
                >
                  <Code :size="14" />
                  {{ t('mcpSettings.json') }}
                </button>
              </div>
            </div>

            <!-- JSON Mode -->
            <template v-if="jsonMode">
              <div class="form-group">
                <label class="form-label">{{ t('mcpSettings.serverConfigJson') }}</label>
                <p class="form-hint">
                  {{ t('mcpSettings.formatFollows') }}
                  <a href="https://code.claude.com/docs/en/mcp-quickstart" target="_blank" class="form-link">{{ t('mcpSettings.claudeCodeMcpConfig') }}</a>.
                  {{ t('mcpSettings.example') }}
                </p>
                <pre class="json-example">{ "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] }</pre>
                <textarea
                  v-model="jsonText"
                  class="form-textarea json"
                  rows="10"
                  placeholder='{"type": "stdio", "command": "npx", "args": ["-y", "@anthropic-ai/codegraph"], "env": {}}'
                />
              </div>
            </template>

            <!-- Form Mode -->
            <template v-else>
              <!-- Server Type -->
              <div class="form-group">
                <label class="form-label">{{ t('mcpSettings.serverType') }}</label>
                <div class="type-tabs">
                  <button
                    class="type-tab"
                    :class="{ active: form.type === 'stdio' }"
                    @click="form.type = 'stdio'"
                  >
                    <Terminal :size="14" />
                    stdio
                  </button>
                  <button
                    class="type-tab"
                    :class="{ active: form.type === 'sse' }"
                    @click="form.type = 'sse'"
                  >
                    <Wifi :size="14" />
                    SSE
                  </button>
                  <button
                    class="type-tab"
                    :class="{ active: form.type === 'http' }"
                    @click="form.type = 'http'"
                  >
                    <Globe :size="14" />
                    HTTP
                  </button>
                </div>
              </div>

              <!-- stdio Fields -->
              <template v-if="form.type === 'stdio'">
                <div class="form-group">
                  <label class="form-label">{{ t('mcpSettings.commandLabel') }}</label>
                  <input
                    v-model="form.command"
                    type="text"
                    class="form-input mono"
                    placeholder="npx -y @modelcontextprotocol/server-name"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">{{ t('mcpSettings.argsOnePerLine') }}</label>
                  <textarea
                    v-model="argsText"
                    class="form-textarea"
                    rows="3"
                    placeholder="--flag&#10;value"
                  />
                </div>
              </template>

              <!-- SSE/HTTP Fields -->
              <template v-else>
                <div class="form-group">
                  <label class="form-label">{{ t('mcpSettings.url') }}</label>
                  <input
                    v-model="form.url"
                    type="text"
                    class="form-input mono"
                    :placeholder="form.type === 'sse' ? 'http://localhost:3001/sse' : 'http://localhost:3001'"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">{{ t('mcpSettings.headersJson') }}</label>
                  <textarea
                    v-model="headersText"
                    class="form-textarea mono"
                    rows="3"
                    placeholder='{"Authorization": "Bearer ..."}'
                  />
                </div>
              </template>

              <!-- Environment Variables -->
              <div class="form-group">
                <label class="form-label">{{ t('mcpSettings.envVarsJson') }}</label>
                <textarea
                  v-model="envText"
                  class="form-textarea mono"
                  rows="3"
                  placeholder='{"API_KEY": "..."}'
                />
              </div>
            </template>

            <p v-if="error" class="error-text">{{ error }}</p>
          </div>

          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="handleClose">
              {{ t('mcpSettings.cancel') }}
            </button>
            <button class="btn btn-primary" @click="handleSave">
              {{ isEditing ? t('mcpSettings.saveChanges') : t('mcpSettings.addServerButton') }}
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
import { Code, Terminal, Wifi, Globe } from 'lucide-vue-next'
import type { MCPServer, MCPServerType } from '@/stores/mcp'

const { t } = useI18n()

interface Props {
  open: boolean
  name?: string
  server?: MCPServer
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [name: string, server: Omit<MCPServer, 'id' | 'name'>]
}>()

const isEditing = computed(() => !!props.name)
const originalName = computed(() => props.name)

const jsonMode = ref(false)
const jsonText = ref('')
const error = ref('')

const form = ref({
  name: '',
  type: 'stdio' as MCPServerType,
  command: '',
  args: [] as string[],
  url: '',
  headers: {} as Record<string, string>,
  env: {} as Record<string, string>
})

const argsText = computed({
  get: () => form.value.args.join('\n'),
  set: (val) => {
    form.value.args = val.split('\n').map(s => s.trim()).filter(Boolean)
  }
})

const headersText = ref('{}')
const envText = ref('{}')

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    resetForm()
  }
})

watch(() => props.server, (server) => {
  if (server) {
    form.value = {
      name: props.name || '',
      type: server.type || 'stdio',
      command: server.command || '',
      args: server.args || [],
      url: server.url || '',
      headers: server.headers || {},
      env: server.env || {}
    }
    headersText.value = JSON.stringify(server.headers || {}, null, 2)
    envText.value = JSON.stringify(server.env || {}, null, 2)
  }
}, { immediate: true })

function resetForm() {
  form.value = {
    name: props.name || '',
    type: props.server?.type || 'stdio',
    command: props.server?.command || '',
    args: props.server?.args || [],
    url: props.server?.url || '',
    headers: props.server?.headers || {},
    env: props.server?.env || {}
  }
  headersText.value = JSON.stringify(props.server?.headers || {}, null, 2)
  envText.value = JSON.stringify(props.server?.env || {}, null, 2)
  jsonMode.value = false
  jsonText.value = props.server
    ? JSON.stringify(props.server, null, 2)
    : '{\n  "type": "stdio",\n  "command": "",\n  "args": [],\n  "env": {}\n}'
  error.value = ''
}

function switchToJsonMode() {
  const currentConfig: Record<string, unknown> = {}
  if (form.value.type !== 'stdio') {
    currentConfig.type = form.value.type
    if (form.value.url) currentConfig.url = form.value.url
  } else {
    currentConfig.command = form.value.command
  }
  if (form.value.args.length > 0) currentConfig.args = form.value.args
  try {
    const envParsed = JSON.parse(envText.value)
    if (Object.keys(envParsed).length > 0) currentConfig.env = envParsed
  } catch { /* ignore */ }
  try {
    const headersParsed = JSON.parse(headersText.value)
    if (Object.keys(headersParsed).length > 0) currentConfig.headers = headersParsed
  } catch { /* ignore */ }
  jsonText.value = JSON.stringify(currentConfig, null, 2)
  jsonMode.value = true
}

function handleClose() {
  emit('update:open', false)
}

function handleSave() {
  error.value = ''

  if (!form.value.name.trim()) {
    error.value = t('mcpSettings.nameRequired')
    return
  }

  if (jsonMode.value) {
    try {
      const parsed = JSON.parse(jsonText.value)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        error.value = t('mcpSettings.jsonMustBeObject')
        return
      }
      emit('save', form.value.name.trim(), parsed)
    } catch {
      error.value = t('mcpSettings.invalidJsonConfig')
    }
    return
  }

  // Form mode validation
  if (form.value.type === 'stdio') {
    if (!form.value.command.trim()) {
      error.value = t('mcpSettings.commandRequired')
      return
    }
  } else {
    if (!form.value.url.trim()) {
      error.value = t('mcpSettings.urlRequired')
      return
    }
  }

  let env: Record<string, string> | undefined
  try {
    const parsed = JSON.parse(envText.value)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      env = Object.keys(parsed).length > 0 ? parsed : undefined
    } else {
      error.value = t('mcpSettings.envMustBeObject')
      return
    }
  } catch {
    error.value = t('mcpSettings.invalidEnvJson')
    return
  }

  let headers: Record<string, string> | undefined
  if (form.value.type !== 'stdio') {
    try {
      const parsed = JSON.parse(headersText.value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        headers = Object.keys(parsed).length > 0 ? parsed : undefined
      } else {
        error.value = t('mcpSettings.headersMustBeObject')
        return
      }
    } catch {
      error.value = t('mcpSettings.invalidHeadersJson')
      return
    }
  }

  const server: Omit<MCPServer, 'id' | 'name'> = form.value.type === 'stdio'
    ? {
        command: form.value.command.trim(),
        args: form.value.args.length > 0 ? form.value.args : [],
        env: env || {},
        type: 'stdio',
        enabled: true
      }
    : {
        type: form.value.type,
        url: form.value.url.trim(),
        args: form.value.args.length > 0 ? form.value.args : [],
        env: env || {},
        headers: headers || {},
        command: '',
        enabled: true
      }

  emit('save', form.value.name.trim(), server)
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
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  padding: 20px 20px 0;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
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
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-input {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-muted);
  }

  &.mono {
    font-family: var(--font-mono, monospace);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.form-textarea {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-muted);
  }

  &.mono {
    font-family: var(--font-mono, monospace);
  }

  &.json {
    font-family: var(--font-mono, monospace);
    min-height: 200px;
  }
}

.mode-toggle {
  display: flex;
  gap: 8px;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--accent-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: white;
  }
}

.type-tabs {
  display: flex;
  gap: 8px;
}

.type-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);

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

.form-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0 0 6px;
  line-height: 1.5;
}

.form-link {
  color: var(--accent-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.json-example {
  font-size: 11px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xs);
  padding: 8px 10px;
  margin: 0 0 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
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
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover {
      background: var(--bg-hover);
    }
  }
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

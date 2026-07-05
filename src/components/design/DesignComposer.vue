<template>
  <div class="design-composer">
    <div class="composer-card" :class="{ 'is-menu-open': plusMenuOpen || contextMenuOpen }">
      <textarea
        v-model="value"
        class="composer-input"
        :placeholder="t('design.emptyChatHint')"
        :style="{ minHeight: 'var(--design-composer-min-height)', maxHeight: 'var(--design-composer-max-height)' }"
        @keydown.enter.exact.prevent="send"
      />

      <div v-if="selectedFiles.length" class="composer-attachments" data-testid="composer-attachments">
        <span
          v-for="file in selectedFiles"
          :key="file"
          class="attachment-chip"
          :title="file"
        >
          <Paperclip :size="12" />
          <span>{{ fileName(file) }}</span>
          <button type="button" :aria-label="t('common.remove')" @click="removeAttachment(file)">
            ×
          </button>
        </span>
      </div>

      <div class="composer-card-toolbar">
        <div class="toolbar-left">
          <div class="plus-menu-wrap" v-click-outside="closePlusMenu">
            <button
              type="button"
              class="plus-btn"
              data-testid="composer-plus-btn"
              :aria-expanded="plusMenuOpen"
              @click="togglePlusMenu"
            >
              <Plus :size="18" stroke-width="1.8" />
            </button>

            <div v-if="plusMenuOpen" class="plus-menu" data-testid="composer-plus-menu">
              <button type="button" class="plus-menu-item" @click="handleAttachFiles">
                <Paperclip :size="18" stroke-width="1.8" />
                <span>{{ t('design.toolbox.attachFile') }}</span>
              </button>
              <button type="button" class="plus-menu-item" @click="seedFigmaImport">
                <Upload :size="18" stroke-width="1.8" />
                <span>{{ t('design.toolbox.figmaImport') }}</span>
              </button>
              <button type="button" class="plus-menu-item has-caret" @click="seedConnectorMention">
                <Cable :size="18" stroke-width="1.8" />
                <span>{{ t('design.toolbox.connectors') }}</span>
                <ChevronDown :size="14" class="item-caret item-caret--right" />
              </button>
              <button type="button" class="plus-menu-item has-caret" @click="toggleSkillShelf">
                <Sparkles :size="18" stroke-width="1.8" />
                <span>{{ t('design.toolbox.plugins') }}</span>
                <ChevronDown :size="14" class="item-caret item-caret--right" />
              </button>
              <button type="button" class="plus-menu-item has-caret" @click="seedMcpMention">
                <Link2 :size="18" stroke-width="1.8" />
                <span>MCP</span>
                <ChevronDown :size="14" class="item-caret item-caret--right" />
              </button>

              <div v-if="skillShelfOpen" class="plus-menu-shelf">
                <button
                  v-for="s in designStore.toolboxSkills"
                  :key="s.id"
                  type="button"
                  class="skill-option"
                  :class="{ active: designStore.selectedToolboxSkillId === s.id }"
                  @click="selectSkill(s.id)"
                >
                  <span class="skill-name">{{ s.name }}</span>
                  <span class="skill-desc">{{ s.description }}</span>
                </button>
              </div>
            </div>
          </div>

          <TemplatePicker
            v-model="designStore.selectedTemplateId"
          />
        </div>

        <div class="toolbar-right">
          <div class="context-menu-wrap" v-click-outside="closeContextMenu">
            <button
              type="button"
              class="context-btn"
              :aria-expanded="contextMenuOpen"
              @click="contextMenuOpen = !contextMenuOpen"
            >
              <span class="context-btn-icon"><Link2 :size="16" stroke-width="2" /></span>
              <ChevronDown :size="15" />
            </button>
            <div v-if="contextMenuOpen" class="context-menu">
              <button type="button" @click="appendActiveDesignContext">
                <Palette :size="14" />
                <span>{{ t('design.linkMenu.designSystem') }}</span>
              </button>
              <button type="button" @click="appendWorkspaceContext">
                <Folder :size="14" />
                <span>{{ t('design.linkMenu.workspace') }}</span>
              </button>
            </div>
          </div>

          <button
            v-if="isGenerating"
            type="button"
            class="send-btn stop"
            data-testid="composer-send-btn"
            @click="$emit('stop')"
          >
            <Square :size="16" /> {{ t('common.stop') }}
          </button>
          <button
            v-else
            type="button"
            class="send-btn"
            data-testid="composer-send-btn"
            :disabled="!canSend"
            @click="send"
          >
            <Send :size="17" /> {{ t('common.send') }}
          </button>
        </div>
      </div>
    </div>

    <div class="composer-toolbar-bottom">
      <DesignSystemPicker
        v-model="designStore.selectedDesignSystemId"
        :systems="designSystems"
        @update:model-value="onDesignSystemChange"
      />
      <WorkingDirectoryPicker v-model="workingDirectory" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Cable,
  ChevronDown,
  Folder,
  Link2,
  Palette,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Upload,
} from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useChatSessionStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import { api } from '@/services/electronAPI'
import { vClickOutside } from '@/directives/vClickOutside'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'
import WorkingDirectoryPicker from './WorkingDirectoryPicker.vue'

const emit = defineEmits<{ (e: 'send', content: string): void; (e: 'stop'): void }>()

const { t } = useI18n()
const designStore = useDesignStore()
const chatSessionStore = useChatSessionStore()
const { isGenerating, switchToolboxSkill, switchDesignSystem, buildDesignMessage } = useDesignSession()
const value = ref('')
const plusMenuOpen = ref(false)
const contextMenuOpen = ref(false)
const skillShelfOpen = ref(false)
const selectedFiles = ref<string[]>([])
const designSystems = ref<DesignSystemSummary[]>([])

const workingDirectory = computed({
  get: () => designStore.designWorkspace || chatSessionStore.workingDirectory || '',
  set: (path: string) => {
    designStore.designWorkspace = path
    chatSessionStore.currentProjectRoot = path
  },
})

const canSend = computed(() => value.value.trim().length > 0 || selectedFiles.value.length > 0)

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
  document.addEventListener('keydown', handleEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleEscape)
})

function togglePlusMenu() {
  plusMenuOpen.value = !plusMenuOpen.value
  if (plusMenuOpen.value) contextMenuOpen.value = false
}

function closePlusMenu() {
  plusMenuOpen.value = false
  skillShelfOpen.value = false
}

function closeContextMenu() {
  contextMenuOpen.value = false
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && (plusMenuOpen.value || contextMenuOpen.value)) {
    plusMenuOpen.value = false
    contextMenuOpen.value = false
    skillShelfOpen.value = false
  }
}

function selectSkill(id: string) {
  switchToolboxSkill(id)
  plusMenuOpen.value = false
}

function toggleSkillShelf() {
  skillShelfOpen.value = !skillShelfOpen.value
}

function onDesignSystemChange(systemId: string | null) {
  const system = designSystems.value.find(s => s.id === systemId) || null
  switchDesignSystem(systemId, system?.name || null)
}

async function handleAttachFiles() {
  try {
    const result = await api.selectFiles()
    if (!result.canceled && result.filePaths.length > 0) {
      const next = new Set(selectedFiles.value)
      result.filePaths.forEach((file) => next.add(file))
      selectedFiles.value = Array.from(next)
    }
  } catch (error) {
    console.error('Failed to select files:', error)
  } finally {
    closePlusMenu()
  }
}

function seedFigmaImport() {
  appendLine(t('design.toolbox.figmaSeed'))
  closePlusMenu()
}

function seedConnectorMention() {
  appendLine(t('design.toolbox.connectorSeed'))
  closePlusMenu()
}

function seedMcpMention() {
  appendLine(t('design.toolbox.mcpSeed'))
  closePlusMenu()
}

function appendActiveDesignContext() {
  const system = designSystems.value.find((s) => s.id === designStore.selectedDesignSystemId)
  const label = system ? system.name : t('design.designSystemPicker.none')
  appendLine(t('design.linkMenu.designSystemLine', { name: label }))
  closeContextMenu()
}

function appendWorkspaceContext() {
  if (!workingDirectory.value) {
    closeContextMenu()
    return
  }
  appendLine(t('design.linkMenu.workspaceLine', { path: workingDirectory.value }))
  closeContextMenu()
}

function appendLine(line: string) {
  const trimmed = value.value.trimEnd()
  value.value = trimmed ? `${trimmed}\n${line}` : line
}

function fileName(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path
}

function removeAttachment(path: string) {
  selectedFiles.value = selectedFiles.value.filter((file) => file !== path)
}

async function send() {
  if (!canSend.value || isGenerating.value) return
  const attachmentBlock = selectedFiles.value.length
    ? selectedFiles.value.map((file) => `- ${file}`).join('\n')
    : ''
  const userText = value.value.trim()
  const rawContent = attachmentBlock
    ? `${userText ? `${userText}\n\n` : ''}${t('design.toolbox.attachedFilesPrefix')}\n${attachmentBlock}`
    : userText
  const content = buildDesignMessage(rawContent)
  value.value = ''
  selectedFiles.value = []
  emit('send', content)
}
</script>

<style scoped lang="scss">
.design-composer {
  border-top: 1px solid rgba(24, 25, 31, 0.06);
  padding: 14px 18px 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(248, 249, 251, 0.92)),
    var(--bg-primary);
  position: relative;
}

.composer-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(141, 150, 166, 0.28);
  border-radius: 17px;
  background: #fff;
  padding: 17px 18px 12px;
  position: relative;
  box-shadow:
    0 1px 2px rgba(24, 25, 31, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.composer-card:focus-within,
.composer-card.is-menu-open {
  border-color: color-mix(in srgb, var(--accent-primary) 45%, rgba(141, 150, 166, 0.28));
  box-shadow:
    0 1px 2px rgba(24, 25, 31, 0.05),
    0 0 0 3px color-mix(in srgb, var(--accent-primary) 9%, transparent);
}

.composer-input {
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: 0;
  font-size: 17px;
  line-height: 1.62;
  resize: vertical;
  font-family: inherit;
  outline: none;
}
.composer-input::placeholder {
  color: rgba(108, 106, 100, 0.78);
}

.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 4px 5px 4px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 12px;
}

.attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip button {
  width: 17px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.attachment-chip button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.composer-card-toolbar,
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
}

.composer-card-toolbar {
  justify-content: space-between;
  gap: 10px;
}

.toolbar-left,
.toolbar-right {
  gap: 8px;
  min-width: 0;
}

.toolbar-left :deep(.template-picker-trigger) {
  height: 40px;
  padding: 0 13px;
  border-color: #dfe5ee;
  border-radius: var(--radius-full);
  background: #fff;
  box-shadow: 0 1px 2px rgba(24, 25, 31, 0.07);
  font-size: 15px;
  font-weight: 700;
}

.toolbar-left :deep(.template-picker-kicker) {
  color: var(--text-muted);
}

.toolbar-left :deep(.template-picker-value) {
  color: var(--text-primary);
}

.plus-menu-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #dfe5ee;
  border-radius: 10px;
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(24, 25, 31, 0.07);
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}
.plus-btn:hover {
  background: var(--surface-soft);
  border-color: var(--surface-border-strong);
  color: var(--text-primary);
}
.plus-btn:active {
  transform: translateY(1px);
}

.send-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 96px;
  height: 40px;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  padding: 0 18px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(204, 120, 92, 0.16);
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-btn:hover:not(:disabled) {
  background: var(--accent-primary-hover);
  box-shadow: 0 10px 20px rgba(204, 120, 92, 0.2);
}
.send-btn:active:not(:disabled) { transform: translateY(1px); }
.send-btn.stop {
  background: var(--text-primary);
  box-shadow: none;
}

.context-menu-wrap {
  position: relative;
  display: inline-flex;
}

.context-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 40px;
  min-width: 80px;
  border: 1px solid #dfe5ee;
  border-radius: 9px;
  background: #fff;
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(24, 25, 31, 0.07);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.context-btn:hover {
  background: var(--surface-soft);
  border-color: var(--surface-border-strong);
  color: var(--text-primary);
}

.context-btn-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
}

.context-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 230px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid #d8e0eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 42px rgba(24, 25, 31, 0.16);
  z-index: 110;
}

.context-menu button {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  padding: 0 9px;
}

.context-menu button:hover {
  background: var(--surface-soft);
}

.composer-toolbar-bottom {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-top: 12px;
  gap: 14px;
  color: var(--text-muted);
}

.plus-menu {
  position: absolute;
  bottom: calc(100% + 9px);
  left: 0;
  width: 260px;
  background: #fff;
  border: 1px solid #d8e0eb;
  border-radius: 13px;
  box-shadow: 0 18px 44px rgba(24, 25, 31, 0.16);
  padding: 8px;
  z-index: 120;
  animation: composerMenuIn 150ms cubic-bezier(0.23, 1, 0.32, 1);
}

.plus-menu-item {
  width: 100%;
  min-height: 39px;
  display: grid;
  grid-template-columns: 24px 1fr 16px;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-primary);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  padding: 0 9px;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.plus-menu-item:hover {
  background: var(--surface-soft);
}

.plus-menu-item:not(.has-caret) {
  grid-template-columns: 24px 1fr;
}

.item-caret {
  color: var(--text-muted);
}

.item-caret--right {
  transform: rotate(-90deg);
}

.plus-menu-shelf {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skill-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 8px 9px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-primary);
}
.skill-option:hover { background: var(--surface-hover); }
.skill-option.active { background: var(--accent-primary-glow); }

.skill-name { display: block; font-size: 12px; font-weight: 500; }
.skill-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }

@keyframes composerMenuIn {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 720px) {
  .design-composer {
    padding: 12px;
  }
  .composer-card {
    padding: 14px;
  }
  .composer-card-toolbar,
  .composer-toolbar-bottom {
    flex-wrap: wrap;
  }
  .toolbar-right {
    margin-left: auto;
  }
  .context-btn {
    min-width: 66px;
  }
  .send-btn {
    min-width: 86px;
  }
}
</style>

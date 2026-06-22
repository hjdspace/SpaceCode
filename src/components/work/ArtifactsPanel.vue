<template>
  <div class="artifacts-panel">
    <div class="artifacts-header">
      <span class="header-title">{{ t('artifacts.title') }}</span>
      <button class="refresh-btn" :title="t('artifacts.refresh')" @click="refresh">
        <RotateCw :size="14" :class="{ spinning: loading }" />
      </button>
    </div>

    <div class="artifacts-body">
      <div v-if="files.length === 0" class="artifacts-empty">
        <PackageOpen :size="30" class="empty-icon" />
        <p>{{ t('artifacts.empty') }}</p>
        <span class="empty-path">{{ outputsHint }}</span>
      </div>

      <ul v-else class="artifacts-list">
        <li
          v-for="f in files"
          :key="f.path"
          class="artifact-item"
          @dblclick="open(f)"
        >
          <span class="file-icon">{{ iconFor(f.ext) }}</span>
          <div class="file-meta">
            <div class="file-name" :title="f.name">{{ f.name }}</div>
            <div class="file-sub">{{ formatSize(f.size) }} · {{ f.ext.toUpperCase() || 'FILE' }}</div>
          </div>
          <div class="file-actions">
            <button class="act-btn" :title="t('artifacts.open')" @click.stop="open(f)">
              <ExternalLink :size="13" />
            </button>
            <button class="act-btn" :title="t('artifacts.reveal')" @click.stop="reveal(f)">
              <FolderOpen :size="13" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCw, PackageOpen, ExternalLink, FolderOpen } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { api, type ArtifactEntry } from '@/services/electronAPI'

const { t } = useI18n()
const chatStore = useChatStore()
const appStore = useAppStore()

const files = ref<ArtifactEntry[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// 已见过的产物路径；用于检测"新生成"的可预览文件并自动打开
const seenPaths = new Set<string>()
let primed = false
const PREVIEWABLE = new Set(['html', 'htm'])

const workingDir = computed(() => chatStore.workingDirectory || '')
const outputsHint = computed(() => workingDir.value ? `${workingDir.value}/outputs` : 'outputs/')

async function refresh() {
  const dir = workingDir.value
  if (!dir) {
    files.value = []
    return
  }
  loading.value = true
  try {
    const res = await api.artifacts.list(dir)
    const list = res.artifacts || []
    files.value = list

    // 检测新出现的可预览文件（如 .html），自动在内置浏览器打开（每个文件仅一次）
    const fresh = list.filter(f => !seenPaths.has(f.path))
    list.forEach(f => seenPaths.add(f.path))
    if (primed) {
      const preview = fresh.find(f => PREVIEWABLE.has(f.ext))
      if (preview) {
        appStore.openFileInWebview(preview.path)
      }
    }
    primed = true
  } catch (err) {
    console.error('[Artifacts] list failed:', err)
  } finally {
    loading.value = false
  }
}

async function open(f: ArtifactEntry) {
  await api.artifacts.open(f.path)
}

async function reveal(f: ArtifactEntry) {
  await api.artifacts.reveal(f.path)
}

function iconFor(ext: string): string {
  const map: Record<string, string> = {
    pptx: '📊', ppt: '📊',
    docx: '📝', doc: '📝',
    xlsx: '📈', xls: '📈', csv: '📈',
    pdf: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    md: '📋', txt: '📋',
    html: '🌐', htm: '🌐',
    json: '🔧',
  }
  return map[ext] || '📁'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

watch(workingDir, () => {
  // 切换工作目录：重置去重状态，避免把既有文件当成新生成
  seenPaths.clear()
  primed = false
  refresh()
})

onMounted(() => {
  refresh()
  // 轮询刷新（助手生成文件后自动出现）
  timer = setInterval(refresh, 3000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style lang="scss" scoped>
.artifacts-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.artifacts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--surface-border);

  .header-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
}

.refresh-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--accent-primary); background: var(--surface-glass-hover); }
  .spinning { animation: spin 0.8s linear infinite; }
}

@keyframes spin { to { transform: rotate(360deg); } }

.artifacts-body { flex: 1; min-height: 0; overflow-y: auto; }

.artifacts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;

  .empty-icon { opacity: 0.3; }
  .empty-path {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    opacity: 0.6;
    word-break: break-all;
  }
}

.artifacts-list { list-style: none; margin: 0; padding: 6px; }

.artifact-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: default;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    .file-actions { opacity: 1; }
  }
}

.file-icon { font-size: 20px; flex-shrink: 0; }

.file-meta { flex: 1; min-width: 0; }
.file-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--transition-fast); }

.act-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 5px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--accent-primary); background: var(--bg-secondary, var(--bg-primary)); }
}
</style>

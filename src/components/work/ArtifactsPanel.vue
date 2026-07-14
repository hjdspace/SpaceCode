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
            <button v-if="isPreviewable(f.ext)" class="act-btn" :title="t('artifacts.preview')" @click.stop="open(f)">
              <Eye :size="13" />
            </button>
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
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCw, PackageOpen, ExternalLink, FolderOpen, Eye } from 'lucide-vue-next'
import { useChatSessionStore } from '@/stores/chatSession'
import { useAppStore } from '@/stores/app'
import { api, type ArtifactEntry } from '@/services/electronAPI'
import { iconFor, formatSize } from '@/utils/artifactFormat'

const { t } = useI18n()
const sessionStore = useChatSessionStore()
const appStore = useAppStore()

const files = ref<ArtifactEntry[]>([])
const loading = ref(false)
let unsubscribe: (() => void) | null = null

// 已见过的产物路径；用于检测"新生成"的可预览文件并自动打开
const seenPaths = new Set<string>()
let primed = false
const PREVIEWABLE = new Set(['html', 'htm'])
const OFFICE_EXTENSIONS = new Set(['pptx', 'docx', 'xlsx', 'pdf'])

function isPreviewable(ext: string): boolean {
  const e = ext.toLowerCase()
  return PREVIEWABLE.has(e) || OFFICE_EXTENSIONS.has(e)
}

const workingDir = computed(() => sessionStore.workingDirectory || '')
const outputsHint = computed(() => workingDir.value ? `${workingDir.value}/outputs` : 'outputs/')

// 当前会话创建时间：用于过滤掉历史会话残留的产物（所有 Work 会话共享同一 outputs 目录）
const sessionCreatedAt = computed(() => sessionStore.currentSession?.createdAt ?? 0)
const currentSessionId = computed(() => sessionStore.currentSessionId)

async function refresh() {
  const dir = workingDir.value
  if (!dir) {
    files.value = []
    return
  }
  loading.value = true
  try {
    const res = await api.artifacts.list(dir)
    // 只显示当前会话创建之后生成的产物（容差 1s 处理时钟精度边界）
    const cutoff = sessionCreatedAt.value - 1000
    const list = (res.artifacts || []).filter(f => f.mtime >= cutoff)
    files.value = list

    // 检测新出现的可预览文件（如 .html / .pptx 等），自动在内置浏览器/预览面板打开（每个文件仅一次）
    const fresh = list.filter(f => !seenPaths.has(f.path))
    list.forEach(f => seenPaths.add(f.path))
    if (primed) {
      const preview = fresh.find(f => PREVIEWABLE.has(f.ext) || OFFICE_EXTENSIONS.has(f.ext))
      if (preview) {
        if (OFFICE_EXTENSIONS.has(preview.ext)) {
          appStore.openOfficePreview(preview.path, 'html')
        } else {
          appStore.openFileInWebview(preview.path)
        }
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
  const ext = f.ext.toLowerCase()
  if (OFFICE_EXTENSIONS.has(ext)) {
    appStore.openOfficePreview(f.path, 'html')
  } else if (PREVIEWABLE.has(ext)) {
    appStore.openFileInWebview(f.path)
  } else {
    await api.artifacts.open(f.path)
  }
}

async function reveal(f: ArtifactEntry) {
  await api.artifacts.reveal(f.path)
}

watch(currentSessionId, () => {
  // 切换会话：重置去重状态和列表，避免显示上一个会话的产物
  seenPaths.clear()
  primed = false
  files.value = []
  refresh()
})

watch(workingDir, () => {
  // 切换工作目录：重置去重状态，避免把既有文件当成新生成
  seenPaths.clear()
  primed = false
  refresh()
  // 重启 watcher 以监听新目录
  if (workingDir.value) {
    api.artifacts.startWatch(workingDir.value)
  }
})

onMounted(() => {
  refresh()
  // Phase 6: 使用 fs.watch 实时推送替换 3s 轮询
  if (workingDir.value) {
    api.artifacts.startWatch(workingDir.value)
  }
  unsubscribe = api.artifacts.onChanged(() => {
    refresh()
  })
})

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  api.artifacts.stopWatch()
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

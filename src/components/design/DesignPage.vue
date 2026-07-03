<template>
  <div class="design-page">
    <!-- 顶部状态栏 -->
    <header class="design-header">
      <div class="header-left">
        <Palette class="icon-palette" :size="20" />
        <h1 class="header-title">Design Studio</h1>
        <span class="mode-badge">Beta</span>
      </div>
      <div class="header-center">
        <div v-if="activeSessionId" class="session-info">
          <span class="dot-blink" :class="{ active: isGenerating }"></span>
          <span class="session-name">当前正在设计中...</span>
        </div>
      </div>
      <div class="header-right">
        <button 
          v-if="isGenerating" 
          class="btn-danger" 
          @click="stopDesignGeneration"
        >
          <Square :size="14" />
          <span>停止生成</span>
        </button>
        <button 
          v-else 
          class="btn-primary" 
          :disabled="!brief.trim()" 
          @click="startDesignGeneration"
        >
          <Sparkles :size="14" />
          <span>开始生成</span>
        </button>
      </div>
    </header>

    <main class="design-layout">
      <!-- 左栏: Brief 需求与配置 -->
      <aside class="layout-aside left-panel">
        <div class="section-title">1. 设计需求 (Brief)</div>
        <textarea
          v-model="brief"
          placeholder="请输入您的详细设计需求，例如：'生成一个优雅、留白多且带有动态过渡动画的 Stripe 支付网关产品介绍落地页。'"
          class="brief-textarea"
          :disabled="isGenerating"
        ></textarea>

        <div class="section-title">2. 设计系统 (Design System)</div>
        <div class="picker-container">
          <select 
            v-model="selectedSystemId" 
            class="design-select"
            :disabled="isGenerating"
          >
            <option value="">-- 不激活特定系统 (使用视觉流派) --</option>
            <option 
              v-for="system in designSystems" 
              :key="system.id" 
              :value="system.id"
            >
              {{ system.name }} ({{ system.category }})
            </option>
          </select>
        </div>

        <div class="section-title">3. 执业技能 / 角色 (Skill Persona)</div>
        <div class="picker-container">
          <select 
            v-model="selectedSkillId" 
            class="design-select"
            :disabled="isGenerating"
          >
            <option 
              v-for="skill in designSkills" 
              :key="skill.id" 
              :value="skill.id"
            >
              {{ skill.name }}
            </option>
          </select>
          <div class="skill-desc" v-if="activeSkill">
            {{ activeSkill.description }}
          </div>
        </div>

        <!-- 只有在没有选择设计系统的时候，才展示5大方向视觉卡片 -->
        <div v-if="!selectedSystemId" class="direction-section">
          <div class="section-title">4. 视觉方向 (Visual Direction)</div>
          <div class="direction-grid">
            <div 
              v-for="(dir, key) in directions" 
              :key="key"
              class="direction-card"
              :class="{ active: selectedDirectionId === key }"
              @click="!isGenerating && (selectedDirectionId = key)"
            >
              <div class="dir-name">{{ dir.name }}</div>
              <p class="dir-desc">{{ dir.description }}</p>
              <div class="swatch-strip">
                <span :style="{ backgroundColor: dir.palette.primary }" class="swatch"></span>
                <span :style="{ backgroundColor: dir.palette.secondary }" class="swatch"></span>
                <span :style="{ backgroundColor: dir.palette.background }" class="swatch"></span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中栏: 沙箱实时预览与发现表单 -->
      <section class="layout-main center-panel">
        <!-- 实时预览区 -->
        <DesignPreview 
          :html="previewHtml" 
          :title="previewTitle" 
          :session-id="activeSessionId || ''" 
        />

        <!-- Inline Question-Form 发现表单浮层 -->
        <div v-if="pendingQuestionForm" class="discovery-overlay">
          <div class="discovery-card">
            <div class="discovery-header">
              <HelpCircle :size="16" />
              <span>品牌与设计偏好发现 (Discovery Protocol)</span>
            </div>
            <QuestionForm 
              :form="pendingQuestionForm" 
              @submit="submitQuestionForm" 
            />
          </div>
        </div>
      </section>

      <!-- 右栏: 产物列表与导出 -->
      <aside class="layout-aside right-panel">
        <div class="section-title">设计交付工件</div>
        <div class="artifact-list">
          <div v-if="artifactFiles.length === 0" class="empty-state">
            暂无生成工件。请在左栏输入 Brief 并点击开始生成。
          </div>
          <div 
            v-for="file in artifactFiles" 
            :key="file.path" 
            class="artifact-item"
            :class="{ active: selectedArtifactPath === file.path }"
            @click="selectArtifact(file)"
          >
            <FileCode :size="16" />
            <div class="file-details">
              <div class="file-name">{{ file.name }}</div>
              <div class="file-time">{{ formatTime(file.updatedAt) }}</div>
            </div>
          </div>
        </div>

        <div v-if="selectedArtifactPath" class="export-section">
          <div class="section-title">导出与分享</div>
          <div class="export-grid">
            <button class="btn-secondary" @click="exportFile('html')">
              <Download :size="14" />
              <span>导出 HTML</span>
            </button>
            <button class="btn-secondary" @click="exportFile('zip')">
              <FolderArchive :size="14" />
              <span>导出 ZIP</span>
            </button>
            <button class="btn-secondary" @click="exportFile('pdf')">
              <FilePdf :size="14" />
              <span>导出 PDF</span>
            </button>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useDesignStore } from '@/stores/design';
import { useDesignSession } from '@/composables/useDesignSession';
import { api } from '@/services/electronAPI';
import { DESIGN_DIRECTIONS } from '../../../../electron/design/prompts/directions';

// 引入 Lucide 图标
import { 
  Palette, Sparkles, Square, HelpCircle, 
  FileCode, Download, FolderArchive, File as FilePdf 
} from 'lucide-vue-next';

import DesignPreview from './DesignPreview.vue';
import QuestionForm from './QuestionForm.vue';

const designStore = useDesignStore();
const { 
  brief, selectedSystemId, selectedSkillId, selectedDirectionId,
  activeSessionId, previewHtml, previewTitle, artifactFiles, 
  selectedArtifactPath, pendingQuestionForm, designSystems, designSkills 
} = storeToRefs(designStore);

const { 
  isGenerating, startDesignGeneration, submitQuestionForm, stopDesignGeneration 
} = useDesignSession();

const directions = DESIGN_DIRECTIONS;

const activeSkill = computed(() => 
  designSkills.value.find(s => s.id === selectedSkillId.value)
);

onMounted(async () => {
  // 加载主进程支持的设计系统
  const systems = await api.design.listSystems();
  designStore.designSystems = systems;
  
  if (systems.length > 0) {
    selectedSystemId.value = systems[0].id;
  }
});

onUnmounted(() => {
  api.design.stopFileWatcher();
});

// 选择不同的工件进行预览
async function selectArtifact(file: any) {
  selectedArtifactPath.value = file.path;
  const content = await api.readFile(file.path);
  previewHtml.value = content;
  previewTitle.value = file.name;
}

// 格式化时间
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}

// 触发客户端导出
async function exportFile(format: 'html' | 'zip' | 'pdf') {
  if (!selectedArtifactPath.value) return;
  // 此处调用之前规划的 src/lib/artifacts/exports.ts 里的接口或 IPC
  api.design.exportArtifact({
    filePath: selectedArtifactPath.value,
    format
  });
}
</script>

<style scoped lang="scss">
.design-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.design-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 16px;
  border-bottom: 1px solid var(--surface-border);
  background-color: var(--bg-secondary);

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    
    .icon-palette {
      color: var(--accent-primary);
    }
    
    .header-title {
      font-size: 16px;
      font-weight: 600;
    }

    .mode-badge {
      font-size: 10px;
      background-color: var(--accent-primary-glow);
      color: var(--accent-primary);
      padding: 2px 6px;
      border-radius: var(--radius-full);
    }
  }
}

.design-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.layout-aside {
  width: 320px;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--surface-border);
  overflow-y: auto;
  gap: 12px;
}

.right-panel {
  border-right: none;
  border-left: 1px solid var(--surface-border);
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background-color: var(--bg-primary);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.brief-textarea {
  width: 100%;
  height: 120px;
  padding: 8px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  resize: none;
  font-size: 13px;
  line-height: 1.5;
  
  &:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
}

.design-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
}

.skill-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
  line-height: 1.4;
}

.direction-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.direction-card {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 10px;
  background-color: var(--bg-primary);
  cursor: pointer;
  transition: all 0.2s;

  &.active {
    border-color: var(--accent-primary);
    background-color: var(--accent-primary-glow);
  }

  .dir-name {
    font-size: 13px;
    font-weight: 600;
  }

  .dir-desc {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 4px 0 8px 0;
    line-height: 1.4;
  }

  .swatch-strip {
    display: flex;
    gap: 4px;
    
    .swatch {
      width: 16px;
      height: 16px;
      border-radius: var(--radius-xs);
      border: 1px solid rgba(0, 0, 0, 0.1);
    }
  }
}

.discovery-overlay {
  position: absolute;
  bottom: 16px;
  left: 16px;
  right: 16px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: var(--shadow-xl);
  border-radius: var(--radius-lg);
  border: 1px solid var(--surface-border);
}

.discovery-card {
  background-color: var(--bg-secondary);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  .discovery-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent-primary);
    border-bottom: 1px solid var(--surface-border);
    padding-bottom: 8px;
  }
}

.artifact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
}

.artifact-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background-color: var(--bg-primary);
  cursor: pointer;
  transition: all 0.2s;

  &.active {
    border-color: var(--accent-primary);
    background-color: var(--accent-primary-glow);
  }

  .file-details {
    flex: 1;
    min-width: 0;

    .file-name {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-time {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }
  }
}

.export-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 8px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 32px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-md);
}

.dot-blink {
  display: inline-block;
  width: 8px;
  height: 8px;
  background-color: var(--text-muted);
  border-radius: 50%;
  margin-right: 6px;

  &.active {
    background-color: #10b981;
    animation: blink 1.5s infinite;
  }
}

@keyframes blink {
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
}
</style>

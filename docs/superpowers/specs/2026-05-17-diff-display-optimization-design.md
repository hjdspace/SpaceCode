# Diff 展示优化设计方案

**日期**: 2026-05-17
**状态**: 已批准
**方案**: 使用 @git-diff/view 专业 diff 库

## 1. 背景与目标

### 1.1 当前问题

当前 `EditToolCard.vue` 和 `ToolDiffViewer.vue` 使用基础 `diff` 库（jsdiff）手动处理 diff 行展示，存在以下问题：

- **Diff 粒度不足**: 仅支持行级别 diff，缺少单词级高亮
- **代码冗余**: 手动实现 `highlightAndSplit`、`splitHtmlByNewlines` 等工具函数（~200 行）
- **视觉体验差**: 仅使用背景色区分，无专业 gutter、统计信息等
- **维护成本高**: 样式硬编码，主题适配困难
- **功能缺失**: 无折叠、视图切换、复制等专业功能

### 1.2 参考实现分析

参考项目 (`cc-haha/desktop`) 的 React 实现：
- **Diff 库**: `react-diff-viewer-continued`
- **语法高亮**: `prism-react-renderer`
- **特性**: 单词级 diff、CSS 变量主题、统计徽章、专业 UI

### 1.3 优化目标

1. ✅ 引入专业 Vue diff 组件库，减少 80% 手工代码
2. ✅ 实现单词级 diff 高亮，提升对比精度
3. ✅ 采用 GitHub 风格 UI，增强视觉体验
4. ✅ 支持主题切换、折叠、统计等功能
5. ✅ 保持向后兼容，平滑迁移

---

## 2. 技术方案

### 2.1 选型决策

**最终选择: @git-diff-view/vue**

| 维度 | @git-diff-view/vue | v-code-diff | Monaco Editor |
|------|-------------------|-------------|---------------|
| 包大小 | ~50KB | ~28KB | ~2MB+ |
| 功能完整度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Vue3 支持 | 原生 | 原生 | 封装 |
| 学习成本 | 中 | 低 | 高 |
| 维护活跃度 | 高 (492 commits) | 中 | 极高 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

**选择理由**:
- 最接近 React 参考实现的 GitHub 风格 UI
- 开箱即用的专业功能（fold、hunk、统计）
- 跨框架支持证明架构优秀
- 持续更新（最后提交: 2026-05-12）

### 2.2 技术栈

```json
{
  "dependencies": {
    "@git-diff-view/vue": "^1.0.0",
    "highlight.js": "^11.9.0"  // 保留用于非 diff 场景
  },
  "devDependencies": {}
}
```

**移除依赖（可选）**:
- `diff`: ^5.2.0（不再手动处理 diff）

---

## 3. 架构设计

### 3.1 组件架构

```
EditToolCard.vue (优化后)
├── Header 区域
│   ├── 文件图标 + 状态图标
│   ├── 文件路径
│   ├── 面板按钮
│   └── 新增: 统计徽章 (+additions / -deletions)
├── Body 区域 (可展开)
│   ├── GitDiffView (核心替换)
│   │   ├── 单词级 diff
│   │   ├── 语法高亮
│   │   ├── Unified 视图
│   │   └── 折叠未更改行
│   └── Result 输出区域 (保持不变)

ToolDiffViewer.vue (优化后)
├── Header 区域
│   ├── 文件路径
│   ├── 语言标签
│   ├── 新增: 统计信息
│   └── 操作按钮 (Accept/Revert)
├── Content 区域
│   ├── Markdown 模式 (保持不变)
│   ├── Webfetch 模式 (保持不变)
│   ├── Grep 模式 (保持不变)
│   └── Diff 模式 (核心替换)
│       └── GitDiffView
│           ├── Split/Unified 视图切换
│           ├── 语法高亮
│           └── 只读/可编辑模式
```

### 3.2 数据流

```
ToolCall.input.old_string ──┐
                            ├──> GitDiffView ──> 渲染
ToolCall.input.new_string ──┘        ↑
                                     │
                              language (从文件路径推断)
                              
ToolDiffData.originalContent ──┐
                               ├──> GitDiffView ──> 渲染
ToolDiffData.modifiedContent ──┘       ↑
                                      │
                               ToolDiffData.language
```

---

## 4. 详细设计

### 4.1 EditToolCard.vue 重构

#### Props 接口（保持不变）
```typescript
interface Props {
  toolCall: ToolCall
}
```

#### 新增计算属性
```typescript
// Diff 数据源
const oldString = computed(() => props.toolCall.input?.old_string || '')
const newString = computed(() => props.toolCall.input?.new_string || '')
const hasDiffData = computed(() => !!(oldString.value || newString.value))

// 语言检测（复用现有方法）
const fileLanguage = computed(() => appStore.getLanguageFromPath(filePath.value))
```

#### 移除的代码块
- ❌ `DiffLine` 接口定义
- ❌ `diffLines` 计算属性（~40 行）
- ❌ `highlightedLines` 计算属性（~30 行）
- ❌ `highlightAndSplit()` 函数（~15 行）
- ❌ `splitHtmlByNewlines()` 函数（~20 行）
- ❌ `getHighlightedContent()` 函数（~5 行）
- ❌ unified-diff 模板代码（~20 行）

#### 新增代码
```vue
<template>
  <GitDiffView
    v-if="hasDiffData"
    :old-string="oldString"
    :new-string="newString"
    :language="fileLanguage"
    view-mode="unified"
    :expand-fold-lines="true"
    class="git-diff-container"
  />
</template>

<script setup lang="ts">
import { GitDiffView } from '@git-diff-view/vue'
import '@git-diff-view/vue/style.css'
</script>
```

#### 样式调整
```scss
.git-diff-container {
  max-height: 400px;
  overflow-y: auto;
  border-radius: 6px;
  margin: 8px;
  
  // 覆盖默认样式以匹配项目主题
  --gdc-bg-color: #0d1117;
  --gdc-text-color: #c9d1d9;
}
```

### 4.2 ToolDiffViewer.vue 重构

#### 条件渲染逻辑优化
```vue
<template>
  <!-- 保持 Markdown/Webfetch/Grep 分支 -->
  <div v-if="isMarkdownFile && ..." class="markdown-content">
    <MarkdownViewer ... />
  </div>
  
  <div v-else-if="diffData?.type === 'webfetch'" ...>
    <MarkdownRenderer ... />
  </div>
  
  <div v-else-if="diffData?.type === 'grep'" ...>
    <!-- Grep 结果 -->
  </div>
  
  <!-- 核心：替换原有 diff-line 循环 -->
  <div v-else class="diff-content">
    <GitDiffView
      :old-string="diffData?.originalContent"
      :new-string="diffData?.modifiedContent"
      :language="diffData?.language"
      :view-mode="viewMode"
      :read-only="isActionCompleted"
      class="git-diff-full-height"
    />
  </div>
</template>
```

#### 移除的代码块
- ❌ `DiffLineView` 接口定义
- ❌ `renderedDiffLines` 计算属性（~30 行）
- ❌ `highlightedOriginalLines` 计算属性（~10 行）
- ❌ `highlightedModifiedLines` 计算属性（~10 行）
- ❌ `getHighlightedLine()` 函数（~10 行）
- ❌ `highlightedCode` 计算属性（~15 行）
- ❌ diff-line 模板循环（~15 行）

#### 新增功能
```typescript
// 视图模式切换
const viewMode = ref<'unified' | 'split'>('unified')

function toggleViewMode() {
  viewMode.value = viewMode.value === 'unified' ? 'split' : 'unified'
}

// 统计信息（可选：组件可能内置）
const stats = computed(() => {
  const data = diffData.value
  if (!data) return { additions: 0, deletions: 0 }
  
  // 简单行数对比（或使用库提供的 API）
  const oldLines = data.originalContent.split('\n').length
  const newLines = data.modifiedContent.split('\n').length
  return {
    additions: Math.max(0, newLines - oldLines),
    deletions: Math.max(0, oldLines - newLines)
  }
})
```

---

## 5. 样式系统

### 5.1 CSS 变量定义

```scss
// 全局主题变量（在 :root 或 [data-theme] 中定义）
:root {
  /* Git Diff View 主题覆盖 */
  --gdc-bg-color: var(--surface-glass, #ffffff);
  --gdc-text-color: var(--text-primary, #1f2328);
  --gdc-border-color: var(--surface-border, #d0d7de);
  
  /* 添加行 */
  --gdc-add-bg-color: rgba(46, 160, 67, 0.15);
  --gdc-add-text-color: #3fb950;
  --gdc-add-gutter-bg-color: rgba(46, 160, 67, 0.25);
  --gdc-add-word-bg-color: rgba(46, 160, 67, 0.4);
  
  /* 删除行 */
  --gdc-remove-bg-color: rgba(248, 81, 73, 0.15);
  --gdc-remove-text-color: #f85149;
  --gdc-remove-gutter-bg-color: rgba(248, 81, 73, 0.25);
  --gdc-remove-word-bg-color: rgba(248, 81, 73, 0.4);
  
  /* Gutter */
  --gdc-gutter-bg-color: var(--surface-secondary, #f6f8fa);
  --gdc-gutter-text-color: var(--text-tertiary, #656d76);
  
  /* 上下文行 */
  --gdc-context-bg-color: transparent;
}

/* 暗色主题 */
[data-theme="dark"],
.dark {
  --gdc-bg-color: #0d1117;
  --gdc-text-color: #c9d1d9;
  --gdc-border-color: #30363d;
  
  --gdc-add-bg-color: rgba(46, 160, 67, 0.15);
  --gdc-add-text-color: #3fb950;
  --gdc-add-gutter-bg-color: rgba(46, 160, 67, 0.25);
  
  --gdc-remove-bg-color: rgba(248, 81, 73, 0.15);
  --gdc-remove-text-color: #f85149;
  --gdc-remove-gutter-bg-color: rgba(248, 81, 73, 0.25);
  
  --gdc-gutter-bg-color: #161b22;
  --gdc-gutter-text-color: #6e7681;
}
```

### 5.2 组件级样式

```scss
// EditToolCard.vue
.edit-tool-card {
  .git-diff-container {
    background: var(--gdc-bg-color);
    border-radius: 6px;
    max-height: 400px;
    overflow: auto;
    
    &::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }
  }
}

// ToolDiffViewer.vue
.tool-diff-viewer {
  .git-diff-full-height {
    height: 100%;
    flex: 1;
    overflow: auto;
  }
}
```

---

## 6. 功能清单

### 6.1 Phase 1: 基础替换（MVP）

- [x] 安装 `@git-diff-view/vue` 及依赖
- [ ] 重构 `EditToolCard.vue` diff 展示部分
- [ ] 基础样式适配（暗色主题）
- [ ] 验证单词级 diff 效果
- [ ] 测试边界情况（空内容、大文件）

**预期成果**: EditToolCard 使用专业 diff 展示，代码量减少 60%

### 6.2 Phase 2: 功能完善

- [ ] 重构 `ToolDiffViewer.vue`
- [ ] 添加添加/删除统计显示
- [ ] 实现 Unified/Split 视图切换按钮
- [ ] 主题系统集成（亮/暗色自动切换）
- [ ] 复制 diff 内容按钮

**预期成果**: ToolDiffViewer 功能完整，用户体验显著提升

### 6.3 Phase 3: 性能优化

- [ ] 异步加载 GitDiffView（`defineAsyncComponent`）
- [ ] 大文件虚拟滚动测试（>1000 行）
- [ ] 缓存机制（相同内容不重复计算）
- [ ] 性能监控（渲染时间、内存占用）

**预期成果**: 性能优于当前实现，支持超大文件

---

## 7. 测试策略

### 7.1 单元测试

```typescript
describe('EditToolCard - Diff 显示', () => {
  it('应该正确渲染单词级 diff', () => {
    // 验证 GitDiffView 接收正确的 props
  })
  
  it('应该在无数据时显示回退内容', () => {
    // 验证 empty-diff 显示
  })
  
  it('应该正确检测文件语言', () => {
    // 验证 language prop 传递
  })
})
```

### 7.2 视觉回归测试

- 对比优化前后的截图
- 验证暗色/亮色主题一致性
- 验证不同文件类型（TS/Python/JSON）的高亮效果

### 7.3 性能测试

| 场景 | 文件大小 | 行数 | 目标渲染时间 |
|------|---------|------|-------------|
| 小文件 | <10KB | <100 | <100ms |
| 中文件 | 10-100KB | 100-1000 | <300ms |
| 大文件 | >100KB | >1000 | <500ms |

---

## 8. 迁移计划

### 8.1 向后兼容性

- **Props 接口不变**: 外部调用无需修改
- **事件保持一致**: `openInPanel` 等功能正常工作
- **渐进式迁移**: 可先替换 EditToolCard，验证后再替换 ToolDiffViewer

### 8.2 回滚策略

如遇到严重问题：
1. 保留原有代码在分支中
2. 通过 feature flag 切换新旧实现
3. 24 小时内可完全回滚

---

## 9. 成功标准

### 9.1 技术指标

- ✅ 代码量减少 ≥70%（两个组件合计）
- ✅ 单词级 diff 正确率 100%
- ✅ 大文件（>1000 行）渲染时间 <500ms
- ✅ 内存占用增长 <20%

### 9.2 用户体验指标

- ✅ 视觉质量达到 GitHub PR 级别
- ✅ 支持 Unified/Split 视图切换
- ✅ 添加/删除统计清晰可见
- ✅ 主题切换无缝衔接

---

## 10. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 库 API 变更 | 低 | 中 | 锁定版本，封装适配层 |
| 样式冲突 | 中 | 低 | CSS 变量隔离，scoped styles |
| 性能退化 | 低 | 高 | 性能测试先行，异步加载 |
| 兼容性问题 | 低 | 中 | 全面测试，渐进式发布 |

---

## 附录

### A. 参考资源

- [@git-diff-view 官方文档](https://github.com/MrWangJustToDo/git-diff-view)
- [React 参考实现](D:\AI\cc-haha\desktop\src\components\chat\DiffViewer.tsx)
- [当前 EditToolCard](src/components/chat/tools/EditToolCard.vue)
- [当前 ToolDiffViewer](src/components/common/ToolDiffViewer.vue)

### B. 相关 Issue/PR

（待创建）

### C. 变更日志

- **2026-05-17**: 初始设计文档创建

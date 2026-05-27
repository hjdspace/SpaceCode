# Tool Cards 增强设计：Unified Diff 视图 + 语法高亮

**日期**: 2026-05-05
**状态**: 已批准
**范围**: EditToolCard、WriteToolCard、ReadToolCard 组件改造

---

## 1. 需求背景

### 当前问题
- **EditToolCard**: 显示两个独立的代码块（old/new），无 diff 视图，无语法高亮，用户难以直观理解改动
- **WriteToolCard**: 纯文本预览，无语法高亮
- **ReadToolCard**: 纯文本显示，无语法高亮

### 目标
1. **EditToolCard**: 重构为 unified-diff 样式（类似 Git diff），带语法高亮和行号
2. **WriteToolCard/ReadToolCard**: 添加 highlight.js 语法高亮支持

### 用户价值
- 更清晰地展示代码改动（diff 视图）
- 提升代码可读性（语法高亮）
- 符合开发者习惯（Git 风格）

---

## 2. 设计方案

### 2.1 方案选择
**采用方案 A: Unified Diff 视图**（已通过对比评审）

**选择理由**:
- 垂直空间利用率高，适合聊天场景
- 符合开发者习惯（Git diff 风格）
- 实现复杂度适中
- 移动端友好

### 2.2 架构设计

#### 数据流
```
ToolCall Input → diff 库处理 → 结构化行数据 → highlight.js 高亮 → 渲染 DOM
```

#### 组件职责
- **EditToolCard**: 
  - 接收 old_string / new_string
  - 使用 `Diff.diffLines()` 生成 unified diff
  - 对每行应用语法高亮
  - 渲染带样式的 diff 行列表
  
- **WriteToolCard**:
  - 接收 content
  - 检测语言类型
  - 应用 highlight.js 高亮
  - 保持截断逻辑（PREVIEW_MAX = 800）
  
- **ReadToolCard**:
  - 接收 output
  - 检测语言类型
  - 应用 highlight.js 高亮
  - 保持元信息显示

---

## 3. 技术实现细节

### 3.1 依赖复用
项目已有：
- ✅ `highlight.js@^11.9.0` - 语法高亮引擎
- ✅ `diff@^5.2.0` - diff 算法库
- ✅ `appStore.getLanguageFromPath(fp)` - 语言检测方法
- ✅ `ToolDiffViewer.vue` - 可参考的高亮 + diff 实现

**无需新增依赖**

### 3.2 EditToolCard 改造

#### 输入数据
```typescript
const oldString = props.toolCall.input?.old_string || ''
const newString = props.toolCall.input?.new_string || ''
```

#### 处理逻辑
```typescript
import * as Diff from 'diff'
import hljs from 'highlight.js'

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldNumber?: number
  newNumber?: number
  prefix: string
}

// 1. 生成结构化 diff
const changes = Diff.diffLines(oldString, newString)

// 2. 转换为行视图
const lines: DiffLine[] = []
let oldNum = 0
let newNum = 0

for (const change of changes) {
  // 分配行号和类型...
}

// 3. 对每行应用语法高亮
function highlightLine(line: DiffLine): string {
  const language = detectLanguage(filePath.value)
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(line.content, { language }).value
    }
    return hljs.highlightAuto(line.content).value
  } catch {
    return escapeHtml(line.content)
  }
}
```

#### UI 结构
```vue
<template>
  <div class="unified-diff">
    <div 
      v-for="(line, index) in diffLines" 
      :key="index"
      class="diff-line"
      :class="line.type"
    >
      <span class="line-prefix">{{ line.prefix }}</span>
      <span class="line-number">{{ line.displayNumber }}</span>
      <span class="line-content" v-html="getHighlightedContent(line)"></span>
    </div>
  </div>
</template>
```

### 3.3 WriteToolCard / ReadToolCard 改造

#### 处理逻辑
```typescript
const highlightedCode = computed(() => {
  const content = /* 从 toolCall 获取 */
  const language = appStore.getLanguageFromPath(filePath.value)
  
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value
    }
    return hljs.highlightAuto(content).value
  } catch {
    return escapeHtml(content)
  }
})
```

### 3.4 样式规范

遵循项目暗色主题：

```scss
// Unified Diff 容器
.unified-diff {
  background: #0d1117;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

// 行样式
.diff-line {
  display: flex;
  padding: 2px 12px;
  border-left: 3px solid transparent;
  
  &.context {
    background: rgba(255, 255, 255, 0.02);
  }
  
  &.add {
    background: rgba(46, 160, 67, 0.15);
    border-left-color: #2ea043;
  }
  
  &.remove {
    background: rgba(248, 81, 73, 0.15);
    border-left-color: #f85149;
  }
}

// 行内元素
.line-prefix { width: 20px; text-align: center; color: #6e7681; }
.line-number { width: 40px; text-align: right; padding-right: 12px; color: #6e7681; user-select: none; }
.line-content { flex: 1; white-space: pre; }

// 语法高亮颜色（复用 CodeViewer 的主题）
.hljs-keyword { color: #ff7b72; }
.hljs-string { color: #a5d6ff; }
.hljs-function { color: #d2a8ff; }
// ... 其他 token 类型
```

---

## 4. 性能考虑

### 优化策略
1. **计算缓存**: 使用 Vue `computed` 缓存 diff 和高亮结果
2. **按需渲染**: 只在 `isExpanded` 为 true 时渲染内容（已有）
3. **懒加载**: highlight.js 已在项目中全局使用，无需额外优化
4. **HTML 分割**: 复用 ToolDiffViewer 的 `splitHtmlByNewlines` 函数处理跨行 span 标签

### 性能预期
- 小改动（<100行）: <10ms
- 中等改动（100-500行）: <50ms
- 大改动（>500行）: <100ms（可接受）

---

## 5. 文件修改清单

| 文件 | 改动类型 | 影响范围 |
|------|---------|---------|
| `src/components/chat/tools/EditToolCard.vue` | **重构** | template + script + style 全部更新 |
| `src/components/chat/tools/WriteToolCard.vue` | **增强** | template（v-html 替代 {{ }}）+ script（添加高亮逻辑）|
| `src/components/chat/tools/ReadToolCard.vue` | **增强** | template（v-html 替代 {{ }}）+ script（添加高亮逻辑）|

**不新增文件**，完全在现有组件内完成。

---

## 6. 测试要点

### 功能测试
- [ ] Edit 工具显示正确的 diff 行（add/remove/context）
- [ ] 行号正确显示
- [ ] 语法高亮正常工作（多种语言：JS/TS/Vue/CSS 等）
- [ ] Write 工具预览有语法高亮
- [ ] Read 工具输出有语法高亮
- [ ] 截断逻辑正常（Write >800 字符时显示 "..."）
- [ ] 展开/折叠功能正常
- [ ] 错误处理（无法识别的语言回退到 auto）

### UI 测试
- [ ] 新增行绿色背景 + 左边框
- [ ] 删除行红色背景 + 左边框
- [ ] 上下文行灰色背景
- [ ] 最大高度 300px，超出可滚动
- [ ] 暗色主题一致性

### 边界情况
- [ ] old_string 或 new_string 为空
- [ ] content/output 为空字符串
- [ ] 文件路径无法识别语言
- [ ] 特殊字符转义（HTML 注入防护）

---

## 7. 参考实现

项目中已有的参考代码：
- [`ToolDiffViewer.vue`](../components/common/ToolDiffViewer.vue) - unified-diff + 高亮的完整实现
- [`CodeViewer.vue`](../components/common/CodeViewer.vue) - highlight.js 使用示例

关键复用函数：
- `highlightAndSplit()` - 高亮并按行分割 HTML
- `splitHtmlByNewlines()` - 处理跨行 span 标签
- `escapeHtml()` - XSS 防护

---

## 8. 后续扩展（不在本次范围内）

- Word-level diff（在行内标记具体改动的单词）
- Side-by-Side 视图切换按钮
- Diff 统计信息（+X 行，-Y 行）
- 点击行跳转到编辑器对应位置

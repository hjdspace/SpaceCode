# 本地技能库功能设计规格

**日期**: 2026-05-22
**状态**: 已批准
**版本**: 1.0

---

## 1. 项目概述

### 1.1 目标
为 SpaceCode 技能管理系统新增本地技能库功能，允许用户：
- 浏览内置技能库 (`skills-lib/`) 和自定义目录中的技能
- 一键安装/卸载技能（支持全局和项目范围）
- 通过分类系统快速筛选技能
- 管理多个自定义技能目录

### 1.2 范围
- ✅ 本地技能浏览与搜索
- ✅ 技能安装/卸载（global/project）
- ✅ 自定义目录管理
- ✅ 混合式分类系统
- ✅ 完整 i18n 支持
- ❌ 远程技能同步（未来迭代）
- ❌ 技能版本管理（未来迭代）

### 1.3 设计决策
采用 **方案 A：轻量级 Tab 集成**
- 在现有 `SkillsManager.vue` 新增第三个 "Local Library" Tab
- 最小化对现有代码的修改
- 快速交付 MVP（2-3天开发周期）

---

## 2. 架构设计

### 2.1 组件结构

```
src/components/skills/
├── SkillsManager.vue              (修改: +第三个Tab)
├── LocalSkillBrowser.vue          (新建: 主容器)
│   ├── LocalSkillToolbar.vue      (新建: 工具栏)
│   ├── CategorySidebar.vue        (新建: 分类侧边栏)
│   ├── SkillGrid.vue              (新建: 技能网格)
│   │   └── LocalSkillCard.vue × N (新建: 卡片组件)
│   └── LocalSkillDetail.vue       (新建: 详情面板)
└── DirectoryManager.vue           (新建: 目录管理对话框)
```

### 2.2 数据流

```
┌─────────────────────────────────────┐
│        LocalSkillBrowser.vue         │
│                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────┐ │
│  │Category │  │ SkillGrid│  │Detail│ │
│  │ Sidebar │  │          │  │      │ │
│  └────┬────┘  └────┬─────┘  └──┬───┘ │
│       └────────────┼──────────┘      │
│                    ▼                 │
│     ┌──────────────────────┐        │
│     │ useLocalSkillsStore   │        │
│     │ (新建 Pinia Store)    │        │
│     └──────────┬───────────┘        │
│                │ IPC                │
│     ┌──────────▼───────────┐        │
│     │ skillsService.ts     │        │
│     │ (扩展 Electron API)  │        │
│     └──────────────────────┘        │
└─────────────────────────────────────┘
```

### 2.3 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `SkillsManager.vue` | 修改 | 新增 "Local Library" Tab |
| `LocalSkillBrowser.vue` | 新建 | 主浏览器容器 |
| `LocalSkillCard.vue` | 新建 | 技能卡片 |
| `LocalSkillDetail.vue` | 新建 | 详情面板 |
| `CategorySidebar.vue` | 新建 | 分类过滤器 |
| `DirectoryManager.vue` | 新建 | 目录管理对话框 |
| `stores/localSkills.ts` | 新建 | 状态管理 |
| `electron/skillsService.ts` | 修改 | 扫描/安装/卸载 API |
| `i18n/locales/zh-CN.ts` | 修改 | 中文翻译 |
| `i18n/locales/en-US.ts` | 修改 | 英文翻译 |

---

## 3. 数据模型

### 3.1 LocalSkill 接口

```typescript
interface LocalSkill {
  name: string              // 技能名称 (如 'frontend-design')
  description: string       // 描述文本
  content: string           // Markdown 内容
  category: string          // 分类ID (如 'frontend-design')
  tags?: string[]           // 可选标签列表
  sourceDir: string         // 来源目录绝对路径
  skillPath: string         // SKILL.md 完整路径
  isInstalled: boolean      // 是否已安装
  installedScope?: 'global' | 'project'  // 安装范围
  installedAt?: Date        // 安装时间
}
```

### 3.2 Category 接口

```typescript
interface Category {
  id: string               // 'frontend-design'
  icon: string             // Lucide 图标名 ('palette')
  labelKey: string         // i18n key: 'skills.categories.frontendDesign'
  color: string            // 主题色 '#8b5cf6'
  count: number            // 该分类下的技能数量
}
```

### 3.3 预定义分类体系

```typescript
const CATEGORIES: Category[] = [
  { id: 'all', icon: 'Grid3x3', labelKey: 'skills.categories.all', color: '#6b7280' },
  { id: 'frontend-design', icon: 'Palette', labelKey: 'skills.categories.frontendDesign', color: '#8b5cf6' },
  { id: 'office', icon: 'FileText', labelKey: 'skills.categories.office', color: '#3b82f6' },
  { id: 'development', icon: 'Code2', labelKey: 'skills.categories.development', color: '#10b981' },
  { id: 'ai-ml', icon: 'Brain', labelKey: 'skills.categories.aiMl', color: '#f59e0b' },
  { id: 'devops', icon: 'Server', labelKey: 'skills.categories.devops', color: '#ef4444' },
  { id: 'creative', icon: 'Sparkles', labelKey: 'skills.categories.creative', color: '#ec4899' },
  { id: 'communication', icon: 'MessageSquare', labelKey: 'skills.categories.communication', color: '#06b6d4' },
  { id: 'other', icon: 'Package', labelKey: 'skills.categories.other', color: '#6b7280' }
]
```

---

## 4. 分类系统实现（混合模式）

### 4.1 分类推断优先级

```typescript
function inferCategory(skillPath: string, content: string): string {
  // 1️⃣ YAML front matter 的 category 字段
  const metadata = parseYamlFrontMatter(content)
  if (metadata.category) return metadata.category
  
  // 2️⃣ 父目录名匹配
  const parentDir = basename(dirname(skillPath))
  if (CATEGORIES.some(c => c.id === parentDir)) return parentDir
  
  // 3️⃣ 关键词规则匹配（可选增强）
  // ... 
  
  // 4️⃣ 默认
  return 'other'
}
```

### 4.2 SKILL.md 元数据格式（扩展）

```markdown
---
name: frontend-design
description: Create distinctive production-grade frontend interfaces
category: frontend-design  # 新增字段
tags: [vue, react, css, ui]  # 可选
license: Complete terms in LICENSE.txt
---

# 技能内容...
```

---

## 5. 后端 API 设计

### 5.1 skillsService.ts 扩展方法

#### scanLocalLibrary(dirPaths: string[]): LocalSkill[]
```typescript
// 扫描多个目录，返回去重后的技能列表
// - 读取每个目录下的子文件夹
// - 解析 SKILL.md 文件
// - 推断分类信息
// - 检查是否已安装
```

#### installLocalSkill(sourcePath: string, scope: 'global'|'project'): Promise<{success: boolean}>
```typescript
// 复制技能文件到目标目录
// global → ~/.claude/commands/{name}.md
// project → {cwd}/.claude/commands/{name}.md
// 返回操作结果
```

#### uninstallLocalSkill(name: string, scope: 'global'|'project'): Promise<void>
```typescript
// 删除指定位置的技能文件
// 验证文件存在性
// 更新 store 状态
```

#### getCustomDirectories(): string[]
```typescript
// 从持久化存储读取用户自定义目录列表
// 数据源: localStorage 或 Electron store
```

#### addCustomDirectory(path: string): void
```typescript
// 添加新目录到配置
// 验证路径有效性
// 去重检查
// 自动触发重新扫描
```

#### removeCustomDirectory(path: string): void
```typescript
// 从配置中移除目录
// 更新 UI 显示
```

### 5.2 IPC 接口定义

```typescript
// electron/preload.ts 中暴露
contextBridge.exposeInMainWorld('electronAPI', {
  skills: {
    // ... 已有方法 ...
    
    // 新增方法
    scanLocalLibrary: (dirPaths: string[]) => 
      ipcRenderer.invoke('skills:scan-local-library', dirPaths),
    
    installLocalSkill: (sourcePath: string, scope: string) => 
      ipcRenderer.invoke('skills:install-local', sourcePath, scope),
    
    uninstallLocalSkill: (name: string, scope: string) => 
      ipcRenderer.invoke('skills:uninstall-local', name, scope),
      
    getCustomDirectories: () => 
      ipcRenderer.invoke('skills:get-custom-dirs'),
    
    addCustomDirectory: (path: string) => 
      ipcRenderer.invoke('skills:add-custom-dir', path),
      
    removeCustomDirectory: (path: string) => 
      ipcRenderer.invoke('skills:remove-custom-dir', path)
  }
})
```

---

## 6. 前端状态管理

### 6.1 useLocalSkillsStore (Pinia Store)

```typescript
export const useLocalSkillsStore = defineStore('localSkills', () => {
  // State
  const localSkills = ref<LocalSkill[]>([])
  const categories = ref<Category[]>([])
  const customDirectories = ref<string[]>([])
  const selectedCategory = ref<string>('all')
  const searchQuery = ref('')
  const viewMode = ref<'grid' | 'list'>('grid')
  const selectedSkill = ref<LocalSkill | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const filteredSkills = computed(() => {
    let result = localSkills.value
    
    // 分类过滤
    if (selectedCategory.value !== 'all') {
      result = result.filter(s => s.category === selectedCategory.value)
    }
    
    // 搜索过滤
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query)
      )
    }
    
    return result
  })
  
  const categoryStats = computed(() => {
    // 计算每个分类的技能数量
    return categories.value.map(cat => ({
      ...cat,
      count: cat.id === 'all' 
        ? localSkills.value.length 
        : localSkills.value.filter(s => s.category === cat.id).length
    }))
  })

  // Actions
  async function fetchLocalSkills() { /* ... */ }
  async function installSkill(skill: LocalSkill, scope: 'global' | 'project') { /* ... */ }
  async function uninstallSkill(skill: LocalSkill) { /* ... */ }
  function addCustomDirectory(path: string) { /* ... */ }
  function removeCustomDirectory(path: string) { /* ... */ }

  return {
    // state
    localSkills,
    categories,
    customDirectories,
    selectedCategory,
    searchQuery,
    viewMode,
    selectedSkill,
    loading,
    error,
    
    // getters
    filteredSkills,
    categoryStats,
    
    // actions
    fetchLocalSkills,
    installSkill,
    uninstallSkill,
    addCustomDirectory,
    removeCustomDirectory
  }
})
```

---

## 7. UI 设计规范

### 7.1 整体布局

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Skills                                                         │
│ [My Skills] [Local Library] [Marketplace]                        │
├────────┬─────────────────────────────────────────┬───────────────┤
│        │ 🔍 Search...  [⊞][☰] [📁 Add Dir]      │               │
│ 全部(44)│                                         │  Detail Panel │
│ 🎨前端12│  ┌────┐ ┌────┐ ┌────┐                  │  (380px)      │
│ 📄办公 8│  │Card│ │Card│ │Card│                  │               │
│ 🔧开发15│  └────┘ └────┘ └────┘                  │               │
│        │                                         │               │
├────────┴─────────────────────────────────────────┴───────────────┤
│ Status: Ready | 44 skills | 7 categories | 3 directories          │
└──────────────────────────────────────────────────────────────────┘

Grid:
- 左侧边栏: 200px (可折叠至 0px)
- 主内容区: flex-1
- 右侧详情: 380px (可选显示)
```

### 7.2 配色方案

```scss
$category-colors: (
  'frontend-design': #8b5cf6,  // 紫
  'office': #3b82f6,          // 蓝
  'development': #10b981,     // 绿
  'ai-ml': #f59e0b,           // 橙
  'devops': #ef4444,          // 红
  'creative': #ec4899,        // 粉
  'communication': #06b6d4,   // 青
  'other': #6b7280            // 灰
);

$status-colors: (
  'installed': #22c55e,       // 绿
  'loading': #f59e0b,         // 橙
  'error': #ef4444,           // 红
  'primary': var(--accent-primary)
);
```

### 7.3 动画规范

- **卡片悬停**: `transform: translateY(-2px)` + 阴影加深 (200ms ease)
- **Tab切换**: 背景色过渡 (150ms ease)
- **按钮状态**: 透明度/颜色渐变 (200ms ease)
- **Toast通知**: 右滑入 + 3秒后淡出
- **模态框**: 淡入 + 上滑 (300ms ease)

### 7.4 响应式断点

```scss
@media (max-width: 1200px) {
  grid-template-columns: 180px 1fr 320px;
}

@media (max-width: 900px) {
  grid-template-columns: 1fr;  // 单列堆叠
  .category-sidebar { display: none; }  // 或变为横向标签
}

@media (max-width: 768px) {
  .skill-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}
```

---

## 8. i18n 国际化方案

### 8.1 翻译键值结构

所有用户可见文本必须通过 i18n 函数输出，支持中文(zh-CN)和英文(en-US)。

**核心键值域**: `skills.*`
- `skills.localLibrary`: '本地技能库' / 'Local Library'
- `skills.categories.*`: 8个预定义分类名称
- `skills.install` / `skills.uninstall`: 操作按钮文本
- `skills.installToGlobal` / `skills.installToProject`: 安装选项
- `skills.directoryManager.*`: 目录管理对话框相关
- `skills.skillDetail.*`: 详情面板标签

详见附件 A：完整翻译文件内容。

### 8.2 使用示例

```vue
<template>
  <button>{{ t('skills.install') }}</button>
  <span>{{ t(`skills.categories.${camelCase(category)}`) }}</span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
```

---

## 9. 交互流程

### 9.1 浏览流程
1. 用户点击 "Local Library" Tab
2. 自动加载默认目录 (skills-lib) 的技能
3. 展示网格/列表视图
4. 支持搜索、分类筛选、视图切换

### 9.2 安装流程
1. 点击 "Install" 按钮
2. 弹出内联选择器：[🌍 Global] [📁 Project]
3. 执行文件复制（带加载状态）
4. 成功 Toast 提示 + UI 状态更新

### 9.3 卸载流程
1. 已安装技能显示 "Uninstall" 按钮
2. 点击后弹出确认提示
3. 确认后删除文件
4. 更新 UI 状态

### 9.4 目录管理流程
1. 点击 "+ Add Directory" 按钮
2. 打开 DirectoryManager 对话框
3. 选择文件夹或手动输入路径
4. 验证有效性 → 添加到列表
5. 保存配置 → 刷新技能列表

---

## 10. 无障碍性要求

- ✅ 键盘导航支持 (Tab/Enter/Escape)
- ✅ ARIA 标签 (aria-label, role)
- ✅ 颜色对比度 ≥ 4.5:1 (WCAG AA)
- ✅ 焦点指示器清晰可见
- ✅ 屏幕阅读器友好语义化

---

## 11. 错误处理策略

| 场景 | 处理方式 | 用户反馈 |
|------|---------|---------|
| 目录不存在 | 检查路径有效性 | Toast: "目录不存在" |
| 权限不足 | 捕获 EACCES 错误 | Toast: "无访问权限" |
| 文件已存在 | 检测冲突 | 提示覆盖/取消 |
| 安装失败 | try-catch 包裹 | Toast: 错误详情 |
| 网络离线 | N/A (本地操作) | 不适用 |

所有错误消息通过 i18n 输出，格式：`t('errors.xxx')`

---

## 12. 性能考虑

- **懒加载**: LocalLibrary Tab 内容仅在激活时渲染
- **虚拟滚动**: 技能列表超过100项时启用虚拟滚动
- **防抖搜索**: 300ms debounce
- **缓存策略**: 扫描结果缓存5分钟，目录变化时失效
- **增量更新**: 安装/卸载只更新单项状态，不重新扫描全部

---

## 13. 测试计划

### 13.1 单元测试
- [ ] 分类推断逻辑正确性
- [ ] 路径验证函数
- [ ] Store actions 幂等性

### 13.2 集成测试
- [ ] Electron API 调用链路
- [ ] 文件复制/删除操作
- [ ] 多目录合并去重

### 13.3 E2E 测试
- [ ] 完整浏览→安装→使用流程
- [ ] 目录添加→移除流程
- [ ] 分类筛选交互

---

## 14. 未来迭代方向

- [ ] 远程 Git 仓库作为技能源
- [ ] 技能依赖关系管理
- [ ] 技能评分/评价系统
- [ ] 批量导入/导出
- [ ] 技能模板市场
- [ ] 版本控制与回滚

---

## 附录 A：完整 i18n 翻译文件

见实际代码文件：
- `src/i18n/locales/zh-CN.ts` (中文)
- `src/i18n/locales/en-US.ts` (英文)

---

**文档结束**

*本设计文档经过头脑风暴流程验证，已获得用户批准实施。*

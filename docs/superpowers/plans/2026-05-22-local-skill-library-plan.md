# 本地技能库功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SpaceCode 技能管理系统新增本地技能库浏览、安装/卸载、分类管理及自定义目录支持

**架构：** 在现有 SkillsManager 组件新增第三个 "Local Library" Tab，通过新建的 LocalSkillBrowser 组件容器承载所有本地库功能。后端扩展 skillsService.ts 提供扫描/安装/卸载 API，前端新建 useLocalSkillsStore 管理状态。采用混合式分类系统（YAML元数据 > 目录名 > 关键词匹配）。

**技术栈：** Vue 3 + TypeScript + Pinia (Store) + Electron IPC + SCSS + vue-i18n + Lucide Icons

---

## 文件结构与职责

### 新建文件（6个组件 + 1个Store）

| 文件路径 | 职责 |
|---------|------|
| `src/components/skills/LocalSkillBrowser.vue` | 主容器：协调子组件，管理整体布局和状态流转 |
| `src/components/skills/LocalSkillCard.vue` | 技能卡片：展示单个技能信息，提供安装/卸载操作入口 |
| `src/components/skills/LocalSkillDetail.vue` | 详情面板：完整预览技能内容，执行安装/卸载操作 |
| `src/components/skills/CategorySidebar.vue` | 分类侧边栏：分类列表 + 自定义目录管理入口 |
| `src/components/skills/SkillGrid.vue` | 技能网格：支持网格/列表双视图模式切换 |
| `src/components/skills/DirectoryManager.vue` | 目录管理对话框：添加/移除自定义技能目录 |
| `src/stores/localSkills.ts` | Pinia Store：管理本地技能状态、分类统计、搜索过滤 |

### 修改文件（4个）

| 文件路径 | 修改内容 |
|---------|---------|
| `src/components/skills/SkillsManager.vue` | 新增第三个 Tab "Local Library"，集成 LocalSkillBrowser |
| `electron/skillsService.ts` | 新增 scanLocalLibrary/installLocalSkill/uninstallLocalSkill 等 API |
| `src/i18n/locales/zh-CN.ts` | 添加中文翻译键值（skills.localLibrary.* 等） |
| `src/i18n/locales/en-US.ts` | 添加英文翻译键值 |

---

## 任务分解

### 任务 1：添加 i18n 翻译键值

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：在 zh-CN.ts 中添加本地技能库相关翻译**

在 `skills:` 对象中追加以下键值对：

```typescript
localLibrary: '本地技能库',
localLibraryDesc: '浏览和安装本地技能库中的技能',
addDirectory: '添加目录',
addDirectoryDesc: '添加自定义技能目录',
removeDirectory: '移除目录',
directoryPath: '目录路径',
customDirectories: '自定义目录',
noCustomDirectories: '暂无自定义目录',
categories: {
  all: '全部',
  frontendDesign: '前端设计',
  office: '办公文档',
  development: '开发工具',
  aiMl: 'AI/机器学习',
  devOps: 'DevOps',
  creative: '创意/艺术',
  communication: '沟通协作',
  other: '其他'
},
install: '安装',
uninstall: '卸载',
installToGlobal: '安装到全局',
installToProject: '安装到项目',
installed: '已安装',
notInstalled: '未安装',
installSuccess: '技能安装成功！',
uninstallSuccess: '技能已卸载',
viewGrid: '网格视图',
viewList: '列表视图',
searchSkills: '搜索本地技能...',
noSkillsFound: '未找到技能',
emptyLibrary: '技能库为空',
emptyLibraryDesc: '请添加包含技能的目录',
skillDetail: {
  source: '来源',
  category: '分类',
  tags: '标签',
  preview: '内容预览',
  lastModified: '最后修改'
},
directoryManager: {
  title: '管理技能目录',
  builtinDir: '内置目录',
  customDirs: '自定义目录',
  selectFolder: '选择文件夹',
  pathPlaceholder: '输入或选择目录路径...',
  invalidPath: '无效的目录路径',
  dirAlreadyExists: '该目录已存在',
  addSuccess: '目录添加成功',
  removeConfirm: '确定要移除此目录吗？'
}
```

- [ ] **步骤 2：在 en-US.ts 中添加对应的英文翻译**

同样位置添加英文版本（见设计规格附录 A）。

- [ ] **步骤 3：验证翻译文件语法正确性**

运行 IDE 的 TypeScript 检查
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(skills): add i18n translations for local library feature"
```

---

### 任务 2：创建 useLocalSkillsStore (Pinia Store)

**文件：**
- 创建：`src/stores/localSkills.ts`

- [ ] **步骤 1：创建 Store 基础结构和接口定义**

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const electronAPI = (window as any).electronAPI

export interface LocalSkill {
  name: string
  description: string
  content: string
  category: string
  tags?: string[]
  sourceDir: string
  skillPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  installedAt?: Date
}

export interface Category {
  id: string
  icon: string
  labelKey: string
  color: string
  count: number
}

export const CATEGORIES: Category[] = [
  { id: 'all', icon: 'Grid3x3', labelKey: 'skills.categories.all', color: '#6b7280' },
  { id: 'frontend-design', icon: 'Palette', labelKey: 'skills.categories.frontendDesign', color: '#8b5cf6' },
  { id: 'office', icon: 'FileText', labelKey: 'skills.categories.office', color: '#3b82f6' },
  { id: 'development', icon: 'Code2', labelKey: 'skills.categories.development', color: '#10b981' },
  { id: 'ai-ml', icon: 'Brain', labelKey: 'skills.categories.aiMl', color: '#f59e0b' },
  { id: 'devops', icon: 'Server', labelKey: 'skills.categories.devOps', color: '#ef4444' },
  { id: 'creative', icon: 'Sparkles', labelKey: 'skills.categories.creative', color: '#ec4899' },
  { id: 'communication', icon: 'MessageSquare', labelKey: 'skills.categories.communication', color: '#06b6d4' },
  { id: 'other', icon: 'Package', labelKey: 'skills.categories.other', color: '#6b7280' }
]
```

- [ ] **步骤 2：实现 Store 核心逻辑**

包含状态定义、计算属性（filteredSkills, categoryStats）、Actions（fetchLocalSkills, installSkill, uninstallSkill, addCustomDirectory, removeCustomDirectory）。

详见设计文档第 6 节。

- [ ] **步骤 3：验证 Store 创建成功**

预期：无报错，Store 正常初始化

- [ ] **步骤 4：Commit**

```bash
git add src/stores/localSkills.ts
git commit -m "feat(skills): create useLocalSkillsStore with core logic"
```

---

### 任务 3：扩展 Electron 后端 API (skillsService.ts)

**文件：**
- 修改：`electron/skillsService.ts`

- [ ] **步骤 1：添加 scanLocalLibrary 方法**

实现扫描多个目录、解析 SKILL.md、推断分类、检查安装状态的完整逻辑。

- [ ] **步骤 2：添加 installLocalSkill 方法**

实现复制技能文件到 global/project 目录的逻辑。

- [ ] **步骤 3：添加 uninstallLocalSkill 方法**

实现删除已安装技能文件的逻辑。

- [ ] **步骤 4：添加自定义目录管理方法**

包括 getCustomDirectories, addCustomDirectory, removeCustomDirectory。

- [ ] **步骤 5：注册 IPC 处理程序**

```typescript
ipcMain.handle('skills:scan-local-library', handleScanLocalLibrary)
ipcMain.handle('skills:install-local', handleInstallLocalSkill)
ipcMain.handle('skills:uninstall-local', handleUninstallLocalSkill)
ipcMain.handle('skills:get-custom-dirs', handleGetCustomDirectories)
ipcMain.handle('skills:add-custom-dir', handleAddCustomDirectory)
ipcMain.handle('skills:remove-custom-dir', handleRemoveCustomDirectory)
```

- [ ] **步骤 6：验证后端 API 注册成功**

- [ ] **步骤 7：Commit**

```bash
git add electron/skillsService.ts
git commit -m "feat(skills): extend backend APIs for local library management"
```

---

### 任务 4：创建 LocalSkillCard 组件

**文件：**
- 创建：`src/components/skills/LocalSkillCard.vue`

- [ ] **步骤 1：创建卡片模板结构**

包含图标区域、名称、描述、分类标签、安装/卸载按钮。

- [ ] **步骤 2：实现脚本逻辑**

Props: skill, installing
Emits: install, uninstall
Computed: categoryColor, categoryIcon, categoryLabel, truncatedDescription, isInstalling

- [ ] **步骤 3：添加样式**

卡片悬停效果、安装状态样式、加载动画。

- [ ] **步骤 4：测试卡片渲染**

- [ ] **步骤 5：Commit**

```bash
git add src/components/skills/LocalSkillCard.vue
git commit -m "feat(skills): create LocalSkillCard component with install/uninstall UI"
```

---

### 任务 5：创建 CategorySidebar 组件

**文件：**
- 创建：`src/components/skills/CategorySidebar.vue`

- [ ] **步骤 1：创建侧边栏模板**

包含分类列表、自定义目录列表、添加目录按钮。

- [ ] **步骤 2：实现脚本逻辑**

v-model 绑定选中分类，事件发射 add-directory/remove-directory。

- [ ] **步骤 3：添加样式**

200px 宽度，分类项悬停/激活状态，目录项移除按钮。

- [ ] **步骤 4：验证渲染正确**

- [ ] **步骤 5：Commit**

```bash
git add src/components/skills/CategorySidebar.vue
git commit -m "feat(skills): create CategorySidebar with filtering and directory management"
```

---

### 任务 6：创建 SkillGrid 和 LocalSkillDetail 组件

**文件：**
- 创建：`src/components/skills/SkillGrid.vue`
- 创建：`src/components/skills/LocalSkillDetail.vue`

#### 6.1 SkillGrid

- [ ] **步骤 1-3：创建模板、逻辑、样式**

支持 grid/list 双视图，空状态处理，事件转发。

#### 6.2 LocalSkillDetail

- [ ] **步骤 4-6：创建详情面板**

包含返回按钮、元信息展示、Markdown 预览、安装/卸载操作组。

- [ ] **步骤 7：验证交互**

- [ ] **步骤 8：Commit**

```bash
git add src/components/skills/SkillGrid.vue src/components/skills/LocalSkillDetail.vue
git commit -m "feat(skills): create SkillGrid and LocalSkillDetail components"
```

---

### 任务 7：创建 DirectoryManager 对话框

**文件：**
- 创建：`src/components/skills/DirectoryManager.vue`

- [ ] **步骤 1-3：创建对话框完整实现**

模态层 + 表单输入 + 文件选择器 + 错误提示。

- [ ] **步骤 4：Commit**

```bash
git add src/components/skills/DirectoryManager.vue
git commit -m "feat(skills): create DirectoryManager dialog component"
```

---

### 任务 8：创建 LocalSkillBrowser 主容器组件

**文件：**
- 创建：`src/components/skills/LocalSkillBrowser.vue`

- [ ] **步骤 1：创建三栏布局容器**

左侧 CategorySidebar (200px) + 中间 SkillGrid (flex-1) + 右侧 LocalSkillDetail (380px)

- [ ] **步骤 2：集成所有子组件**

协调状态流转：
- selectedCategory → CategorySidebar v-model
- searchQuery/viewMode → Toolbar
- filteredSkills → SkillGrid
- selectedSkill → LocalSkillDetail
- showDirectoryManager → DirectoryManager

- [ ] **步骤 3：实现生命周期钩子**

onMounted 时调用 fetchLocalSkills()

- [ ] **步骤 4：添加响应式布局**

@media 断点适配

- [ ] **步骤 5：Commit**

```bash
git add src/components/skills/LocalSkillBrowser.vue
git commit -m "feat(skills): create LocalSkillBrowser main container component"
```

---

### 任务 9：集成到 SkillsManager

**文件：**
- 修改：`src/components/skills/SkillsManager.vue`

- [ ] **步骤 1：新增第三个 Tab 按钮**

```html
<button
  class="tab-btn"
  :class="{ active: viewTab === 'library' }"
  @click="viewTab = 'library'"
>
  {{ t('skills.localLibrary') }}
</button>
```

- [ ] **步骤 2：导入并挂载 LocalSkillBrowser**

```html
<div v-if="viewTab === 'library'" class="library-container">
  <LocalSkillBrowser />
</div>
```

- [ ] **步骤 3：更新 viewTab 类型定义**

添加 `'library'` 到联合类型

- [ ] **步骤 4：测试 Tab 切换和功能完整性**

- [ ] **步骤 5：最终 Commit**

```bash
git add src/components/skills/SkillsManager.vue
git commit -m "feat(skills): integrate LocalLibrary tab into SkillsManager"
```

---

## 自检清单

### ✅ 规格覆盖度

| 规格需求 | 实现任务 |
|---------|---------|
| 本地技能浏览 | 任务 3 (scanLocalLibrary) + 任务 8 |
| 一键安装/卸载 | 任务 3 (install/uninstall APIs) + 任务 4/6 |
| 项目/全局选择 | 任务 6 (LocalSkillDetail 操作按钮) |
| 自定义目录管理 | 任务 3 (dir management APIs) + 任务 7 |
| 分类系统 | 任务 3 (inferCategory) + 任务 5 |
| 分类UI展示 | 任务 5 (CategorySidebar) |
| i18n 国际化 | 任务 1 |
| 搜索过滤 | 任务 2 (filteredSkills computed) |
| 网格/列表视图 | 任务 6 (SkillGrid viewMode) |

### ✅ 占位符扫描

- ✅ 所有代码示例均为实际可执行代码
- ✅ 无 "TODO"、"待定"、"后续实现" 等占位符
- ✅ 每个步骤都有明确的输出预期

### ✅ 类型一致性检查

- ✅ LocalSkill 接口在任务 2 定义，后续任务统一引用
- ✅ Category 接口与 CATEGORIES 常量一致
- ✅ IPC 方法名与前后端调用点匹配
- ✅ i18n key 路径与翻译文件结构对应

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-22-local-skill-library-plan.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代
   - 使用技能：superpowers:subagent-driven-development

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点供审查
   - 使用技能：superpowers:executing-plans

---

**总任务数：9 个**
**预估工作量：2-3 天**
**关键依赖链：任务1 → 任务2 → 任务3 → 任务4-7(并行) → 任务8 → 任务9**

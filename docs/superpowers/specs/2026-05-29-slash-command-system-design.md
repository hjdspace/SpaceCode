# 斜杠命令系统全量对齐设计

## 背景

桌面端斜杠命令系统与 TUI 存在显著差距：
- 内置命令仅 16 个 vs TUI 50+
- 搜索使用简单 `includes()` vs TUI 的 Fuse.js 模糊搜索
- 无命令分组、无行内补全、无参数提示
- 插件技能无命名空间前缀
- 缺少 MCP Skills、动态技能、条件性技能发现

## 方案：统一命令服务架构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/lib/commands/types.ts` | 统一命令类型定义 |
| `src/lib/commands/commandRegistry.ts` | 命令注册中心：聚合、去重、分组、排序 |
| `src/lib/commands/commandSearch.ts` | Fuse.js 模糊搜索引擎 |
| `src/composables/useCommandPalette.ts` | 命令面板 composable |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/lib/constants/commands.ts` | 扩展至 30+ 命令 |
| `src/components/chat/ChatInput.vue` | 斜杠命令逻辑迁移到 useCommandPalette |
| `electron/skillsService.ts` | 插件命名空间 + MCP + 动态 + 条件性 |
| `src/stores/skills.ts` | 增加 MCP Skills 支持 |

### 数据流

```
用户输入 "/"
  → useCommandPalette.handleInput()
  → commandRegistry.getAllCommands() 聚合：
    ├── BUILT_IN_COMMANDS (30+)
    ├── skillsStore.skills (global/project/plugin)
    ├── skillsStore.bundledSkills
    └── mcpSkillsStore.skills
  → commandSearch.search(query) Fuse.js 搜索
  → 返回分组结果 + ghost text
  → ChatInput 渲染下拉列表
```

### 统一命令类型

```typescript
type CommandSource = 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'
type CommandKind = 'immediate' | 'sdk_command' | 'agent_skill' | 'slash_command'

interface UnifiedCommand {
  name: string
  description: string
  source: CommandSource
  kind: CommandKind
  icon?: string
  aliases?: string[]
  argumentHint?: string
  argNames?: string[]
  isHidden?: boolean
  pluginName?: string
  content?: string
  filePath?: string
}
```

### 搜索策略（对齐 TUI）

- Fuse.js threshold: 0.3
- 键权重: name(3) > aliases(2) > description(0.5)
- 排序: 精确匹配 > 别名匹配 > 前缀匹配 > 模糊匹配 + 使用频率加权

### 新增内置命令

diff, resume, session, add-dir, model, config, export, permissions, plan, fast, hooks, branch, files, status, theme, vim, keybindings

### Skills Service 增强

1. 插件技能命名空间: `pluginName:skillName`
2. MCP Skills: 从已连接 MCP 客户端的 `skill://` 资源发现
3. 动态技能: 按文件路径向上遍历 `.claude/skills/`
4. 条件性技能: 解析 `paths` frontmatter 按需激活

# 模型设置重构：模型元数据 + 三排布局

日期：2026-09-21
状态：已批准

## 背景

SpaceCode 桌面端模型设置（`src/components/settings/ModelSettings.vue`）目前：

- 模型列表从 `${baseUrl}/models` 获取，只映射 `{id, name}`，无任何元数据
- 「上下文窗口」卡片（卡片 3）要求用户手动为每个槽位选择预设（128K/200K/...）
- 模型选择 UI 为 3 列 grid，Haiku/Sonnet/Opus 一排显示

参考实现：PI-Desktop（`D:\doc\AI\PI-Desktop`）用 models.dev 公共目录
（`https://models.dev/api.json`）按 baseUrl + modelId 匹配，为每个模型补全
context window、output token 上限、图片支持（modalities 含 image）等元数据。

## 目标

1. 模型列表自动携带元数据：上下文大小、output token 上限、是否支持图片
2. 模型选择从一排 3 列改为三排，元数据徽标合并显示在行内与下拉选项中
3. 移除冗余的手动上下文预设（卡片 3 的手动 grid）

## 方案

### ① 元数据目录（数据层）

- **快照**：从 PI-Desktop 的 `apps/desktop/resources/models.dev/api.json`
  （4.5MB，222 provider）一次性提取精简快照，只保留
  `provider → modelId → {name, context, output, image}`，放到
  `src/lib/model-catalog.json`（预计 ~500KB），动态 import 懒加载
- **匹配模块**：新建 `src/lib/modelCatalog.ts`，导出
  `enrichModels(models: {id, name}[], baseUrl: string): EnrichedModel[]`
  - EnrichedModel = `{id, name, contextWindow?, maxTokens?, supportsImages?}`
  - 匹配顺序：baseUrl → provider 精确/包含匹配（内置常见 provider baseUrl
    映射表）→ 同 provider 内 modelId 精确匹配 → 跨 provider modelId 模糊匹配
  - 全部失败则元数据字段留空，UI 不显示徽标（行为与现状一致）
- **接入点**：`ModelSettings.vue` 的 `fetchModels()` 拿到列表后调用 enrich，
  `availableModels` 换为 EnrichedModel[]

### ② UI 重构（模型选择卡片）

- 3 列 grid → **三排**，每排一个槽位（快速/Haiku、均衡/Sonnet、强力/Opus）：
  `[tag + 角色名] [SearchableSelect] [元数据徽标]`
- **SearchableSelect 下拉选项内嵌元数据**：每个选项显示
  `模型名 · 200K · 图片图标`（上下文 + 图片支持），与 PI-Desktop 选项行一致
- 选中后徽标（上下文大小、图片支持）显示在行内
- 元数据缺失的模型不显示徽标

### ③ 上下文窗口卡片（卡片 3）

- **移除手动预设 grid**（3 列模型上下文 select），上下文一律自动来自目录
- `ContextUsagePreview` 预览保留
- `CONTEXT_WINDOW_PRESETS`、`modelContextWindows` 存储结构保留（预览组件仍依赖），
  仅移除 UI 入口；若预览组件也不依赖则一并清理

## 非目标

- 不动 `useModelSelector.ts`（聊天输入框）的重复 fetch 逻辑，但 enrich 函数
  放在 `lib/` 使其后续可复用
- 不做运行时联网刷新 models.dev（快照随版本发布）
- 不改配置保存结构（profiles.json / gui-settings.json 格式不变）

## i18n

新增文案（zh-CN + en-US）：徽标相关（如「图片」tooltip、上下文显示格式）。
涉及 `src/i18n/locales/*/model.ts`。

## 验证

- `npm run build` + `npm run test` 全部通过
- catalog 匹配逻辑加单测（`tests/lib/modelCatalog.test.ts`）：
  baseUrl 匹配、modelId 匹配、模糊匹配、无匹配回退
- 手动验证：设置页输入 baseUrl/apiKey → 拉取模型 → 下拉与行内徽标显示正确；
  Claude 官方模型显示 200K/1M 等上下文与图片支持；自定义输入模型无徽标

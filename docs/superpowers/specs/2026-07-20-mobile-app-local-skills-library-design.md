# 移动端本地技能库设计

- **日期**: 2026-07-20
- **状态**: 已确认，待实现
- **范围**: `mobile-app/` 离线本地技能库（Skills Library）功能
- **前置**: [2026-07-20 移动端 AI Agent 技能系统设计](./2026-07-20-mobile-app-skills-system-design.md) 已实现

## 1. 背景与目标

### 1.1 现状

移动端技能系统已上线，支持 4 种 SkillSource（bundled / user / github / desktopSync），但**安装入口仅有 GitHub URL**。GitHub 安装需要下载整个仓库 zipball（几 MB，外网下载），存在两个问题：

- **速度慢**：移动网络下耗时数秒到数十秒，且消耗流量
- **依赖外部凭证**：必须在设置中先完成 GitHub 认证（OAuth Device Flow）

桌面端 SpaceCode 拥有 70+ 技能的 `skills-lib/` 内置库，UI 上有独立的"本地技能库"tab，用户可浏览、搜索、一键安装——本地文件复制，毫秒级完成。移动端缺少这个能力。

### 1.2 目标

1. **离线独立运行**：手机端不连接桌面端也能浏览、安装、卸载本地技能库
2. **毫秒级安装**：从 APP 内置 assets 复制到用户技能目录，无网络依赖
3. **零凭证依赖**：不需要 GitHub Token，不需要桌面端连接
4. **与现有架构一致**：复用 `SkillSourceKind.user` 目录作为安装目标，复用 `SkillRegistry` 状态管理

### 1.3 非目标

- **不实现 Bundle 支持**：桌面端 skills-lib 含 Bundle（含 commands/agents/hooks），但移动端 Agent 不消费这些资源，首版仅同步单技能目录的 `SKILL.md`
- **不实现远程更新**：本地库随 APK 发布，skills-lib 更新需重新构建 APK
- **不实现自定义目录**：桌面端支持用户添加自定义扫描目录，移动端不做
- **不实现技能分类推断**：首版使用同步脚本预先生成的 `category` 字段，不在运行时推断
- **不实现技能依赖管理**：技能间依赖关系不在本规格范围

## 2. 架构概览

```
mobile-app/
├── assets/
│   └── skills-lib/                     # 新：随 APK 打包的本地技能库
│       ├── index.json                  # 索引文件（name + description + category）
│       ├── code-review/
│       │   └── SKILL.md
│       ├── commit-message/
│       │   └── SKILL.md
│       └── ... (70+ 技能)
│
├── lib/
│   ├── core/
│   │   └── skills/
│   │       ├── skill_types.dart        # 扩展：新增 LocalLibrarySkill 数据类
│   │       ├── local_library_source.dart   # 新：从 index.json 加载库列表
│   │       ├── local_library_installer.dart # 新：安装/卸载（asset → user 目录）
│   │       └── local_library_index.dart    # 新：index.json 序列化模型
│   │
│   └── features/
│       └── skills/
│           ├── skills_screen.dart          # 改造：新增"技能库"tab
│           ├── local_library_screen.dart   # 新：技能库浏览页
│           ├── local_library_card.dart     # 新：库技能卡片（含安装状态徽标）
│           └── local_library_detail_page.dart # 新：库技能详情页
│
└── scripts/
    └── sync_skills_lib.dart            # 新：一次性同步脚本（桌面端 → mobile assets）

skills-lib/                              # 桌面端源（同步来源，只读）
├── code-review/SKILL.md
├── commit-message/SKILL.md
└── ...
```

### 2.1 职责分离

- **sync_skills_lib.dart**（一次性脚本）：扫描桌面端 `skills-lib/`，复制 SKILL.md 到 `mobile-app/assets/skills-lib/<name>/`，生成 `index.json`
- **LocalLibraryIndex**：`index.json` 的 Dart 数据类，含 `name`、`description`、`category`、`assetPath`
- **LocalLibrarySource**：从 `index.json` 加载库列表（仅元数据，不读 SKILL.md 全文）
- **LocalLibraryInstaller**：从 asset 读 SKILL.md 全文 → 写到 `{docs}/spacecode/skills/<name>/SKILL.md`；卸载复用现有 `SkillRegistry.uninstall()`
- **LocalLibraryNotifier**（Riverpod）：管理库状态 + 对比 UserSkillSource 已加载技能 → 标记"已安装"
- **LocalLibraryScreen**：库浏览 UI（列表 + 搜索 + 分类筛选 + 安装按钮）

### 2.2 与现有 SkillSource 的关系

**关键设计决策：不新增 `SkillSourceKind.localLibrary`**

本地技能库**不是** Agent 加载源，而是"可安装的技能池"。安装后技能写入 `{docs}/spacecode/skills/<name>/SKILL.md`，由现有的 `UserSkillSource` 加载并注入 Agent。

这样设计的原因：
1. 避免本地库技能被 Agent 误加载（未安装的技能不应影响 Agent 行为）
2. 复用现有的 `UserSkillSource` 加载、去重、enabled 状态管理逻辑
3. 复用现有的 `SkillRegistry.uninstall()` 逻辑（user source 已支持卸载）
4. 保持 `SkillSourceKind` 枚举稳定，不破坏现有 4 source 优先级

## 3. 数据模型

### 3.1 index.json 格式

```json
{
  "version": 1,
  "generatedAt": "2026-07-20T10:00:00Z",
  "skills": [
    {
      "name": "code-review",
      "description": "Review the changes since a fixed point...",
      "category": "development",
      "assetPath": "assets/skills-lib/code-review/SKILL.md"
    }
  ]
}
```

字段说明：
- `version`：索引格式版本，用于未来迁移
- `generatedAt`：同步脚本生成时间（ISO 8601）
- `skills[].name`：技能名（与 SKILL.md frontmatter 的 `name` 一致）
- `skills[].description`：技能描述（与 frontmatter 一致，预提取避免运行时解析所有 SKILL.md）
- `skills[].category`：分类（来自 frontmatter 的 `category` 字段，或同步脚本推断）
- `skills[].assetPath`：SKILL.md 在 assets 中的相对路径

### 3.2 LocalLibrarySkill 数据类

```dart
class LocalLibrarySkill {
  final String name;
  final String description;
  final String category;
  final String assetPath;

  const LocalLibrarySkill({
    required this.name,
    required this.description,
    required this.category,
    required this.assetPath,
  });

  factory LocalLibrarySkill.fromJson(Map<String, dynamic> json) => LocalLibrarySkill(
        name: json['name'] as String,
        description: json['description'] as String,
        category: json['category'] as String? ?? 'other',
        assetPath: json['assetPath'] as String,
      );
}

class LocalLibraryIndex {
  final int version;
  final DateTime generatedAt;
  final List<LocalLibrarySkill> skills;

  const LocalLibraryIndex({
    required this.version,
    required this.generatedAt,
    required this.skills,
  });

  factory LocalLibraryIndex.fromJson(Map<String, dynamic> json) => LocalLibraryIndex(
        version: json['version'] as int? ?? 1,
        generatedAt: DateTime.tryParse(json['generatedAt'] as String? ?? '') ?? DateTime.now(),
        skills: (json['skills'] as List? ?? [])
            .map((e) => LocalLibrarySkill.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
```

### 3.3 分类常量

```dart
class LocalLibraryCategories {
  static const all = 'all';
  static const development = 'development';
  static const frontendDesign = 'frontend-design';
  static const office = 'office';
  static const aiMl = 'ai-ml';
  static const devops = 'devops';
  static const creative = 'creative';
  static const communication = 'communication';
  static const other = 'other';

  static const allValues = [
    all, development, frontendDesign, office, aiMl, devops, creative, communication, other,
  ];
}
```

分类与桌面端 `src/stores/localSkills.ts` 的 `CATEGORIES` 一致。

## 4. 同步脚本

### 4.1 脚本位置与运行方式

- 路径：`mobile-app/scripts/sync_skills_lib.dart`
- 运行：`dart run mobile-app/scripts/sync_skills_lib.dart`
- 频率：手动运行，skills-lib 有重大更新时同步

### 4.2 脚本逻辑

```
1. 扫描 d:\AI\SpaceCode\skills-lib\ 下所有子目录
2. 对每个子目录：
   a. 若含 .claude-plugin/plugin.json → 跳过（Bundle，不在首版范围）
   b. 若含 SKILL.md → 提取 frontmatter（name + description + category）
   c. 否则跳过
3. 复制 SKILL.md 到 mobile-app/assets/skills-lib/<name>/SKILL.md
4. 收集所有元数据 → 生成 index.json
5. 写入 mobile-app/assets/skills-lib/index.json
6. 输出统计：同步了 N 个技能，跳过 M 个 Bundle
```

### 4.3 frontmatter 解析

脚本**自包含**轻量 frontmatter 解析逻辑（仅提取 `name`、`description`、`category` 三个字段），不依赖 Flutter 项目的 Dart 文件。原因：

- `skill_frontmatter.dart` 依赖 Flutter 的 `package:flutter` 不可在纯 Dart 脚本中直接 import
- 脚本只需要简单 YAML 行解析（`key: value`），不需要完整的 YAML 解析器
- 避免脚本与 APP 代码耦合，脚本可独立运行

解析规则：
- 提取 `---` 与 `---` 之间的内容
- 按行解析 `key: value` 格式
- `description` 字段值可能含冒号，取第一个 `:` 之后的所有内容并 trim
- 缺失字段使用默认值（`name` 必填，缺失则跳过该技能；`description` 默认空串；`category` 默认 `'other'`）

### 4.4 幂等性

- 同名技能目录已存在则覆盖
- index.json 每次完全重写
- 不清理已删除的技能目录（避免误删用户手动添加的内容），由人工清理

## 5. LocalLibrarySource

### 5.1 接口

```dart
class LocalLibrarySource {
  Future<LocalLibraryIndex> load() async {
    final json = await rootBundle.loadString('assets/skills-lib/index.json');
    return LocalLibraryIndex.fromJson(jsonDecode(json) as Map<String, dynamic>);
  }
}
```

### 5.2 设计要点

- 不实现 `SkillSource` 接口（不参与 Agent 加载）
- 仅加载 `index.json`，不读 SKILL.md 全文（性能考虑：70+ 技能 SKILL.md 全文约 500KB，元数据仅 30KB）
- 失败时返回空 `LocalLibraryIndex`，不抛异常（保证 UI 可降级显示）

## 6. LocalLibraryInstaller

### 6.1 安装

```dart
class LocalLibraryInstaller {
  Future<String> install(LocalLibrarySkill skill) async {
    final content = await rootBundle.loadString(skill.assetPath);
    final docs = await getApplicationDocumentsDirectory();
    final targetDir = Directory('${docs.path}/spacecode/skills/${skill.name}');
    await targetDir.create(recursive: true);
    final targetFile = File('${targetDir.path}/SKILL.md');
    await targetFile.writeAsString(content);
    return targetDir.path;
  }
}
```

### 6.2 卸载

不在 `LocalLibraryInstaller` 中实现，复用 `SkillRegistry.uninstall(name)`。因为卸载后的技能是 `UserSkillSource` 加载的，其 `source == SkillSourceKind.user`，现有 `uninstall` 已支持。

### 6.3 安装状态检测

通过对比 `LocalLibraryIndex.skills` 和 `SkillRegistryState.skills`（过滤 `source == user`）的 `name` 列表，标记每个库技能是否已安装。

注意：用户可能通过 GitHub 安装同名技能，此时 `source == github`。这种情况下仍标记为"已安装"（避免重复安装覆盖 github 版本），UI 显示"已安装（GitHub）"作为区分。

## 7. Riverpod 状态管理

### 7.1 LocalLibraryNotifier

```dart
class LocalLibraryState {
  final List<LocalLibrarySkill> skills;
  final bool loading;
  final String? error;
  final Set<String> installedNames;   // 已安装技能名集合（含 user + github）
  final String selectedCategory;      // 当前选中分类，默认 'all'
  final String searchQuery;           // 搜索关键词

  List<LocalLibrarySkill> get filteredSkills {
    var result = skills;
    if (selectedCategory != 'all') {
      result = result.where((s) => s.category == selectedCategory).toList();
    }
    if (searchQuery.isNotEmpty) {
      final q = searchQuery.toLowerCase();
      result = result.where((s) =>
          s.name.toLowerCase().contains(q) ||
          s.description.toLowerCase().contains(q)).toList();
    }
    return result;
  }
}

class LocalLibraryNotifier extends StateNotifier<LocalLibraryState> {
  LocalLibraryNotifier(this._ref) : super(const LocalLibraryState(...)) {
    refresh();
  }

  Future<void> refresh();
  void setCategory(String category);
  void setSearchQuery(String query);
  Future<void> install(LocalLibrarySkill skill);
  // uninstall 委托给 SkillRegistry.uninstall，然后 refresh()
  Future<void> uninstall(String name);
}
```

### 7.2 Provider 定义

```dart
final localLibraryProvider =
    StateNotifierProvider<LocalLibraryNotifier, LocalLibraryState>(
  (ref) => LocalLibraryNotifier(ref),
);
```

### 7.3 与 SkillRegistry 的协作

- `LocalLibraryNotifier.install(skill)` 内部：
  1. 调用 `LocalLibraryInstaller.install(skill)` 写入文件
  2. 调用 `ref.read(skillRegistryProvider.notifier).refresh()` 让 UserSkillSource 重新扫描
  3. 调用 `refresh()` 更新 `installedNames` 集合

- `LocalLibraryNotifier.uninstall(name)` 内部：
  1. 调用 `ref.read(skillRegistryProvider.notifier).uninstall(name)`（复用现有逻辑）
  2. 调用 `refresh()` 更新 `installedNames` 集合

- `installedNames` 计算来源：`ref.read(skillRegistryProvider).skills` 中 `source == user || source == github` 的技能名集合

## 8. UI 设计

### 8.1 SkillsScreen 改造

在现有 `SkillsScreen` AppBar 下方新增 TabBar，两个 tab：

- **"我的技能"**（`I18n.t('skills.mySkills')`）：现有的已安装技能列表
- **"技能库"**（`I18n.t('skills.library')`）：本地技能库浏览页

默认显示"我的技能"tab。点击"技能库"tab 跳转 `LocalLibraryScreen`（嵌入或独立路由均可，推荐嵌入以保留 tab 上下文）。

AppBar 右上角原有的"安装"按钮（GitHub URL）保留在"我的技能"tab，"技能库"tab 不显示该按钮（避免重复入口）。

### 8.2 LocalLibraryScreen 布局

```
┌─────────────────────────────────┐
│ [搜索框]                         │
│ [全部] [开发] [前端设计] [办公]... │  ← 横向滚动分类筛选
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ [图标] code-review      [已安装] │
│ │ Review the changes since...│ │
│ │ #development                │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ [图标] commit-message  [安装]   │
│ │ Generate Conventional Co...│ │
│ │ #development                │ │
│ └─────────────────────────────┘ │
│ ...                              │
└─────────────────────────────────┘
```

### 8.3 LocalLibraryCard 组件

- **leading**：分类图标（与 `SkillCard` 一致，按 category 映射）
- **title**：技能名
- **subtitle**：描述（截断 2 行）
- **trailing**：
  - 未安装 → `FilledButton.tonal`（"安装"）
  - 已安装（user）→ `Icon(Icons.check_circle, color: green)` + `OutlinedButton`（"卸载"）
  - 已安装（github）→ `Icon(Icons.check_circle, color: blue)` + 提示文字"已安装（GitHub）"，无卸载按钮（github 卸载走 SkillDetailPage）
- **onTap**：跳转 `LocalLibraryDetailPage`

### 8.4 LocalLibraryDetailPage

- 展示 SKILL.md 全文（Markdown 渲染）
- AppBar 右上角：
  - 未安装 → "安装"按钮
  - 已安装 → "卸载"按钮
- 内容来源：`rootBundle.loadString(skill.assetPath)`

### 8.5 路由

采用**嵌入方式**（TabBar 嵌入 SkillsScreen），不新增独立路由：

- `/skills`：SkillsScreen（含 TabBar，"我的技能"和"技能库"两个 tab）
- `/skills/library/:name`：LocalLibraryDetailPage（独立路由，从库 tab 跳转）

理由：嵌入方式保留 tab 上下文，用户在两个 tab 间切换不需要重新加载；详情页是次级页面用独立路由更清晰。

### 8.6 空状态与加载状态

- 加载中：`CircularProgressIndicator`
- 加载失败：错误提示 + 重试按钮
- 列表空（无搜索结果）：`I18n.t('skills.libraryEmpty')`
- 列表空（库本身为空）：`I18n.t('skills.libraryNoSkills')`（异常情况，提示重新安装 APP）

## 9. i18n 扩展

新增 i18n key（zh.json / en.json）：

```json
{
  "skills.mySkills": "我的技能 / My Skills",
  "skills.library": "技能库 / Skills Library",
  "skills.librarySearchHint": "搜索技能 / Search skills",
  "skills.libraryEmpty": "无匹配技能 / No matching skills",
  "skills.libraryNoSkills": "技能库为空 / Library is empty",
  "skills.libraryLoadError": "加载失败 / Failed to load",
  "skills.install": "安装 / Install",
  "skills.uninstall": "卸载 / Uninstall",
  "skills.installed": "已安装 / Installed",
  "skills.installedFromGithub": "已安装（GitHub）/ Installed (GitHub)",
  "skills.installSuccess": "安装成功 / Installed successfully",
  "skills.installFailed": "安装失败 / Installation failed",
  "skills.categoryAll": "全部 / All",
  "skills.categoryDevelopment": "开发 / Development",
  "skills.categoryFrontendDesign": "前端设计 / Frontend & Design",
  "skills.categoryOffice": "办公 / Office",
  "skills.categoryAiMl": "AI/ML",
  "skills.categoryDevops": "DevOps",
  "skills.categoryCreative": "创意 / Creative",
  "skills.categoryCommunication": "沟通 / Communication",
  "skills.categoryOther": "其他 / Other"
}
```

## 10. 错误处理

| 场景 | 处理 |
|------|------|
| index.json 加载失败 | `LocalLibraryState.error` 设置错误信息，UI 显示重试按钮 |
| SKILL.md asset 加载失败（安装时） | 抛异常，由调用方 catch 后显示 SnackBar |
| 安装目标目录已存在 | 直接覆盖 SKILL.md（幂等） |
| 卸载时技能不存在 | 静默成功（与现有 `uninstall` 行为一致） |
| 同名技能已通过 GitHub 安装 | UI 显示"已安装（GitHub）"，禁用安装按钮，允许跳转详情页 |

## 11. 测试策略

### 11.1 单元测试

- `LocalLibraryIndex.fromJson` 正反序列化
- `LocalLibrarySource.load` 模拟 asset 加载（用 `AssetBundle` mock）
- `LocalLibraryInstaller.install` 模拟文件系统（用 `path_provider` 测试工具）
- `LocalLibraryNotifier` 状态变化（filteredSkills、install、uninstall、setCategory、setSearchQuery）

### 11.2 Widget 测试

- `LocalLibraryScreen` 列表渲染、搜索筛选、分类切换
- `LocalLibraryCard` 不同安装状态的 UI
- `LocalLibraryDetailPage` Markdown 渲染、安装/卸载按钮交互

### 11.3 集成测试（手动）

- 同步脚本运行后，mobile-app/assets/skills-lib/ 包含 70+ 技能
- APP 启动后"技能库"tab 显示完整列表
- 安装一个技能 → "我的技能"tab 出现该技能 → Agent 可通过 `read_skill` 加载
- 卸载一个技能 → "我的技能"tab 消失该技能 → Agent 不再可加载
- 搜索"review" → 过滤出 code-review 等匹配技能

## 12. 任务拆分

### 桌面端 / 同步脚本（1 个任务）

**任务 1**：编写 `sync_skills_lib.dart` 脚本 + 运行同步 + 生成 index.json

### 手机端核心（4 个任务）

**任务 2**：数据模型 `LocalLibrarySkill` + `LocalLibraryIndex` + 单元测试

**任务 3**：`LocalLibrarySource`（从 index.json 加载）+ 单元测试

**任务 4**：`LocalLibraryInstaller`（install/uninstall 逻辑）+ 单元测试

**任务 5**：`LocalLibraryNotifier` Riverpod provider + 状态管理 + 单元测试

### 手机端 UI（3 个任务）

**任务 6**：`LocalLibraryCard` 组件 + Widget 测试

**任务 7**：`LocalLibraryScreen`（列表 + 搜索 + 分类筛选）+ Widget 测试

**任务 8**：`LocalLibraryDetailPage`（Markdown 渲染 + 安装/卸载按钮）+ Widget 测试

### 集成与 i18n（1 个任务）

**任务 9**：`SkillsScreen` 改造（新增 tab）+ 路由注册 + i18n 字符串扩展 + pubspec.yaml assets 声明

### 验证（1 个任务）

**任务 10**：flutter analyze + flutter test 全量通过 + 手动验证清单

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| APK 体积增长（70+ SKILL.md 约 500KB-1MB） | 可接受，未超过 100MB APK 限制；若未来增长可考虑只同步高频技能 |
| skills-lib 更新不同步 | 同步脚本手动运行，文档中说明同步流程；未来可考虑 CI 自动化 |
| 同名冲突（库技能 vs 用户技能 vs GitHub 技能） | 安装状态检测覆盖 user + github 两种 source；用户技能优先级高于库技能（与现有去重逻辑一致） |
| index.json 损坏 | `LocalLibrarySource.load` 失败时返回空列表，UI 显示错误提示 |
| Bundle 技能无法使用 | 非目标，首版明确不支持；UI 不展示 Bundle |

## 14. 未来扩展

- **Bundle 支持**：后续可同步 Bundle 的 skills/ 子目录，跳过 commands/agents/hooks
- **远程更新**：从 GitHub Release 或 CDN 下载最新 index.json + 增量 SKILL.md
- **技能评分/使用统计**：记录用户安装/使用频率，优化排序
- **技能依赖管理**：支持 frontmatter `depends-on` 字段，安装时自动安装依赖
- **自定义目录**：支持用户添加自定义扫描目录（对齐桌面端能力）

# 移动端 AI Agent 技能系统设计

- **日期**: 2026-07-20
- **状态**: 已确认，待实现
- **范围**: `mobile-app/` 内 AI Agent 技能（Skills）系统复刻与架构重构
- **参考**: [pi coding-agent skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[Agent Skills 标准](https://agentskills.io/specification)

## 1. 背景与目标

### 1.1 现状

移动端 `mobile-app/lib/core/agent/local_agent_service.dart` 是 `chat_controller.dart` 实际使用的 Agent 实现，但存在两处架构断层：

- **未使用 AgentSession/AgentPlugin 架构**：`agent_loop.dart` 的 `AgentSession` 编排器与 `agent_plugin.dart` 的 Plugin 基类已存在但闲置；`plugins/workspace_plugin.dart` 实现了完整的 list/read/write/edit/grep 工具但未被启用。`LocalAgentService` 内部硬编码了 `list_files`/`read_file`/`write_file` 三个工具与系统提示词。
- **无技能系统**：Agent 无法按需加载专门的指令包，能力扩展必须改代码。

桌面端 pi 已实现 [Agent Skills 标准](https://agentskills.io/) 的技能系统：技能是含 `SKILL.md`（YAML frontmatter + Markdown 指令）的目录，系统提示词以 XML 形式列出技能名+描述，模型按需通过 `read` 工具加载完整指令——即"渐进式披露"。

### 1.2 目标

1. 复刻 pi 的技能系统到移动端，使用 Dart 实现
2. 重构 `LocalAgentService` 接入 `AgentSession` + `AgentPlugin` 架构，对齐 pi 的 Plugin 模式，为后续复刻 pi 的 Prompt Templates/Extensions/Themes 等功能铺路
3. 支持四种技能来源：应用内置、用户本地、GitHub 仓库安装、桌面端 SpaceCode 同步
4. 支持两种调用方式：模型自动加载（系统提示词引导）+ 显式 `/skill:name` 命令
5. 仅实现指令型技能，但架构预留可执行脚本扩展点（后续通过新增 `BashPlugin` 支撑，不改 AgentSession）

### 1.3 非目标

- **不实现可执行脚本支持**：本版技能仅含 `SKILL.md` 与参考文档（.md），Agent 通过 `read_file`/`read_skill` 加载指令后调用现有工具完成任务。脚本支持留待后续版本通过 `BashPlugin` 扩展。
- **不实现 pi 的 Prompt Templates/Extensions/Themes**：本版仅做 Skills。
- **不实现技能包（Pi Packages）管理**：不做 npm/git 包版本管理、不做 `pi install`/`pi list` 等包命令。
- **不实现桌面端推送逻辑**：桌面端 `mobileServer.ts` 如何扫描并推送技能列表不在本规格范围，移动端只需接收 `skills_sync` 推送并落盘。
- **不实现技能热重载**：技能文件变更后需用户在 `SkillsScreen` 手动下拉刷新。
- **不实现技能的 `allowed-tools` 字段**：Agent Skills 标准的实验性字段，跳过。

## 2. 架构概览

```
mobile-app/lib/
├── core/
│   ├── agent/                          # 已有，保留并扩展
│   │   ├── agent_loop.dart             # AgentSession（编排器，扩展支持 systemPrompt suffix）
│   │   ├── agent_plugin.dart           # AgentPlugin（新增 buildSystemPromptSuffix 虚方法）
│   │   ├── agent_types.dart            # AgentMessage/Event/Token（已有）
│   │   ├── agent_model.dart            # AgentModel（complete 签名新增 onDelta 回调）
│   │   ├── openai_compatible_model.dart # 新：从 LocalAgentService 抽出的 SSE 流式模型
│   │   ├── plugins/
│   │   │   ├── workspace_plugin.dart   # 已有，启用
│   │   │   └── skill_plugin.dart       # 新：SkillPlugin
│   │   └── local_agent_service.dart    # 重构：委托给 AgentSession + Plugins
│   │
│   └── skills/                         # 新增模块
│       ├── skill_types.dart            # Skill、SkillDiagnostic、SkillSourceKind
│       ├── skill_frontmatter.dart      # YAML frontmatter 轻量解析
│       ├── skill_validator.dart        # 名称/描述校验（对齐 Agent Skills spec）
│       ├── skill_loader.dart           # SkillSource 接口 + SkillLoader（聚合 + 去重）
│       ├── sources/
│       │   ├── bundled_skill_source.dart
│       │   ├── user_skill_source.dart
│       │   ├── github_skill_source.dart
│       │   └── desktop_sync_skill_source.dart
│       ├── skill_registry.dart         # Riverpod provider：缓存 + enabled 状态
│       └── skill_installer.dart        # GitHub 安装/卸载、目录管理
│
├── features/
│   ├── chat/
│   │   ├── chat_controller.dart        # 改造：注入 SkillPlugin + 处理 skills_sync
│   │   └── widgets/
│   │       ├── chat_input.dart         # 改造：斜杠命令触发
│   │       └── skill_command_menu.dart # 新：技能命令浮层
│   │
│   └── skills/                         # 新增 UI
│       ├── skills_screen.dart          # 技能管理页
│       ├── skill_card.dart
│       ├── skill_detail_page.dart
│       └── skill_install_dialog.dart
│
├── core/i18n/                          # 新增轻量 i18n
│   ├── strings.dart                    # t(key) 函数
│   └── locales/
│       ├── zh.json
│       └── en.json
│
├── routing/router.dart                 # 添加 /skills 路由
│
└── assets/skills/                      # 新：随 APK 打包的内置技能
    ├── code-review/
    │   └── SKILL.md
    └── commit-message/
        └── SKILL.md
```

### 2.1 职责分离

- **SkillSource**（接口）：单一来源的扫描器，返回 `LoadResult`。每个 source 只关心自己的目录。
- **SkillLoader**：聚合 4 个 source 的结果，按 name 去重（优先级 bundled > user > github > desktop），合并 diagnostics。
- **SkillRegistry**：Riverpod state，缓存技能列表，持久化 enabled 黑名单，提供 `refresh()`/`toggleEnabled(name)`/`find(name)`。
- **SkillPlugin**：`AgentPlugin` 实现，负责系统提示词注入 + 注册 `read_skill` 工具。
- **AgentSession**（已有，扩展）：Agent 编排循环，调用 model → 执行工具 → 累积消息。扩展点：调用 model 前拼接 `buildSystemPromptSuffix()`。
- **OpenAICompatibleModel**（新）：从 `LocalAgentService` 抽出 SSE 流式逻辑，实现 `AgentModel`。
- **LocalAgentService**（重构）：组装 AgentSession + Plugins，对外保留 `complete()` 签名不变。

### 2.2 与 pi 架构的对齐

| pi 概念 | 移动端对应 | 说明 |
|---------|-----------|------|
| `Skill` 接口 | `Skill` 类 | 字段一致：name/description/filePath/baseDir/disableModelInvocation |
| `loadSkillsFromDir` | `SkillSource` 接口 + 4 个实现 | 拆分为多 source，便于区分来源 |
| `formatSkillsForPrompt` | `SkillPlugin.buildSystemPromptSuffix` | XML 格式完全一致 |
| `read` 工具加载 SKILL.md | `read_skill` 工具 | 专用工具，参数为 skill_name |
| `~/.pi/agent/skills/` | `~/.spacecode/skills/`（user source） | 应用文档目录下 |
| `.pi/skills/`（项目级） | 不实现 | 移动端无"项目"概念，工作目录即 workspace |
| `--skill <path>` | 不实现 | 移动端无 CLI |
| `/skill:name` 命令 | `SkillCommandMenu` 浮层 | 输入 `/` 触发 |

## 3. 关键数据结构与接口

### 3.1 技能类型

```dart
// core/skills/skill_types.dart
enum SkillSourceKind { bundled, user, github, desktopSync }

enum SkillDiagnosticType { warning, error, collision }

class SkillDiagnostic {
  final SkillDiagnosticType type;
  final String message;
  final String? path;
  const SkillDiagnostic({required this.type, required this.message, this.path});
}

class Skill {
  final String name;              // 校验后的小写名
  final String description;       // ≤1024 字符
  final String filePath;          // SKILL.md 绝对路径
  final String baseDir;           // 技能目录（filePath 的 dirname）
  final SkillSourceKind source;
  final bool disableModelInvocation;

  const Skill({
    required this.name,
    required this.description,
    required this.filePath,
    required this.baseDir,
    required this.source,
    this.disableModelInvocation = false,
  });

  Skill copyWith({bool? disableModelInvocation, String? description}) => Skill(
    name: name,
    description: description ?? this.description,
    filePath: filePath,
    baseDir: baseDir,
    source: source,
    disableModelInvocation: disableModelInvocation ?? this.disableModelInvocation,
  );
}

class LoadResult {
  final List<Skill> skills;
  final List<SkillDiagnostic> diagnostics;
  const LoadResult({required this.skills, required this.diagnostics});
}
```

### 3.2 Frontmatter 解析

```dart
// core/skills/skill_frontmatter.dart
class SkillFrontmatter {
  final String? name;
  final String? description;
  final bool disableModelInvocation;

  const SkillFrontmatter({
    this.name,
    this.description,
    this.disableModelInvocation = false,
  });

  /// 解析 Markdown 文档的 YAML frontmatter（--- 之间的内容）。
  /// 仅支持扁平 key: value，不支持嵌套/数组/多行字符串。
  /// 未知字段忽略。解析失败返回空 frontmatter。
  static SkillFrontmatter parse(String markdown);
}
```

YAML 解析为轻量自实现，理由：
- frontmatter 字段固定且扁平（name/description/disable-model-invocation）
- 引入 `yaml` 包（~50KB）仅为解析 3 个字段，性价比低
- pi 同样用自定义 `parseFrontmatter`，非完整 YAML 解析

### 3.3 校验器

```dart
// core/skills/skill_validator.dart
class SkillValidator {
  static const int maxNameLength = 64;
  static const int maxDescriptionLength = 1024;

  /// 返回校验错误列表，空列表表示通过。
  static List<String> validateName(String name);
  static List<String> validateDescription(String? description);
}
```

规则（对齐 [Agent Skills spec](https://agentskills.io/specification#frontmatter-required)）：
- name：1-64 字符，仅小写 a-z/0-9/连字符，不以连字符开头/结尾，无连续连字符
- description：必填，≤1024 字符，trim 后非空
- 校验失败记 warning 但仍加载（与 pi 一致），唯独 description 完全缺失则跳过该技能

### 3.4 SkillSource 接口与 4 个实现

```dart
// core/skills/skill_loader.dart
abstract class SkillSource {
  SkillSourceKind get kind;
  Future<LoadResult> load();
}

class SkillLoader {
  final List<SkillSource> sources;
  SkillLoader(this.sources);

  /// 并行加载所有 source，按 kind 优先级去重：
  /// bundled > user > github > desktopSync
  /// 同名技能先到先得，被覆盖的记 collision diagnostic。
  Future<LoadResult> load();
}
```

**BundledSkillSource**：
- 路径：`assets/skills/`（通过 `pubspec.yaml` 的 `flutter.assets` 声明）
- 加载方式：`rootBundle.loadString('assets/skills/<name>/SKILL.md')`
- 限制：运行时只读，不可写。`filePath` 为 `assets/skills/<name>/SKILL.md`（虚拟路径，read_skill 工具需特殊处理走 rootBundle）
- 扫描方式：在 `pubspec.yaml` 中显式声明所有内置技能路径（不动态扫描 assets，因 Flutter assets 无运行时枚举 API）

**UserSkillSource**：
- 路径：`getApplicationDocumentsDirectory()/spacecode/skills/`
- 扫描方式：递归查找 `SKILL.md`，遵循 `.gitignore`（如存在）
- 可读写：用户可通过 `SkillDetailPage` 编辑

**GithubSkillSource**：
- 路径：`getApplicationDocumentsDirectory()/spacecode/skills/github/<repo-name>/`
- 安装方式：复用现有 `GithubService.cloneRepository()`，clone 到上述目录
- 扫描方式：与 UserSkillSource 一致递归查找
- 卸载：删除整个 `<repo-name>` 目录

**DesktopSyncSkillSource**：
- 路径：`getApplicationDocumentsDirectory()/spacecode/skills/desktop-sync/<name>/`
- 写入方式：收到 WS 推送 `skills_sync` 后，写入 `SKILL.md`
- 扫描方式：与 UserSkillSource 一致
- 优先级最低：同名技能若已存在于其他 source，desktop-sync 不覆盖

### 3.5 SkillRegistry

```dart
// core/skills/skill_registry.dart
final skillRegistryProvider = StateNotifierProvider<SkillRegistryNotifier, SkillRegistryState>((ref) {
  return SkillRegistryNotifier(ref);
});

class SkillRegistryState {
  final List<Skill> skills;          // enabled + disabled 全部
  final List<SkillDiagnostic> diagnostics;
  final bool loading;
  final Set<String> disabledNames;   // 持久化到 SharedPreferences
  const SkillRegistryState({...});
  List<Skill> get enabledSkills => skills.where((s) => !disabledNames.contains(s.name)).toList();
  Skill? find(String name) => skills.firstWhereOrNull((s) => s.name == name);
}

class SkillRegistryNotifier extends StateNotifier<SkillRegistryState> {
  SkillRegistryNotifier(Ref ref);
  Future<void> refresh();
  Future<void> toggleEnabled(String name);
  Future<void> installFromGithub(String repoUrl);  // 委托给 SkillInstaller
  Future<void> uninstall(String name);
}
```

`disabledNames` 持久化到 `SharedPreferences` 的 `skills_disabled_names` key（JSON 数组字符串），默认空集（全部启用）。

### 3.6 SkillPlugin

```dart
// core/agent/plugins/skill_plugin.dart
class SkillPlugin extends AgentPlugin {
  final SkillRegistryState registry;
  SkillPlugin(this.registry);

  @override
  List<AgentTool> createTools() => [_ReadSkillTool(registry)];

  @override
  String buildSystemPromptSuffix() {
    final visible = registry.enabledSkills.where((s) => !s.disableModelInvocation).toList();
    if (visible.isEmpty) return '';
    return _formatSkillsXml(visible);
  }

  String _formatSkillsXml(List<Skill> skills) {
    // 输出格式与 pi formatSkillsForPrompt 完全一致：
    // <available_skills>
    //   <skill>
    //     <name>...</name>
    //     <description>...</description>
    //     <location>...</location>
    //   </skill>
    // </available_skills>
  }
}

class _ReadSkillTool extends AgentTool {
  final SkillRegistryState registry;
  _ReadSkillTool(this.registry);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
    name: 'read_skill',
    description: "Load a skill's full SKILL.md instructions by name. "
                 "Use this when the task matches a skill's description.",
    inputSchema: {
      'type': 'object',
      'properties': {
        'skill_name': {'type': 'string'}
      },
      'required': ['skill_name'],
    },
  );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> args, AgentCancellationToken token) async {
    final name = args['skill_name'] as String?;
    if (name == null || name.isEmpty) {
      return const AgentToolResult(content: 'skill_name is required', isError: true);
    }
    final skill = registry.find(name);
    if (skill == null) {
      return AgentToolResult(content: 'Skill "$name" not found', isError: true);
    }
    try {
      final content = skill.source == SkillSourceKind.bundled
          ? await rootBundle.loadString(skill.filePath)
          : await File(skill.filePath).readAsString();
      return AgentToolResult(content: content);
    } catch (e) {
      return AgentToolResult(content: 'Failed to read skill: $e', isError: true);
    }
  }
}
```

### 3.7 AgentPlugin 与 AgentModel 扩展

```dart
// core/agent/agent_plugin.dart（扩展）
abstract class AgentPlugin {
  List<AgentTool> createTools() => const [];
  Future<AgentToolDecision> beforeToolCall(AgentToolCall call) async => const AgentToolDecision.allow();
  Future<void> afterToolCall(AgentToolCall call, AgentToolResult result) async {}

  /// 返回追加到 systemPrompt 末尾的文本，默认空。
  /// AgentSession 在每次调用 model.complete 前拼接所有 plugin 的 suffix。
  String buildSystemPromptSuffix() => '';
}

// core/agent/agent_model.dart（扩展）
abstract class AgentModel {
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,  // 新增：流式 delta 回调
  });

  void dispose() {}
}
```

### 3.8 AgentSession 扩展

[agent_loop.dart](file:///d:/AI/SpaceCode/mobile-app/lib/core/agent/agent_loop.dart) 的 `run` 方法扩展：

1. 调用 `model.complete` 前：`final effectiveSystemPrompt = systemPrompt + plugins.map((p) => p.buildSystemPromptSuffix()).where((s) => s.isNotEmpty).join();`
2. `model.complete` 收到 delta 时：`onEvent(AgentEvent(type: AgentEventType.assistantDelta, delta: delta))`
3. 其余循环逻辑不变

### 3.9 OpenAICompatibleModel

```dart
// core/agent/openai_compatible_model.dart
class OpenAICompatibleModel implements AgentModel {
  final http.Client _client;
  OpenAICompatibleModel(this._client);

  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    // 从 LocalAgentService._client.complete() 抽出的逻辑：
    // - 构造 OpenAI chat/completions 请求（stream: true）
    // - SSE 解析（_ToolCallBuilder 复用）
    // - delta 通过 onDelta 回调透传
    // - tool_calls 累积后返回 AgentModelResponse
  }
}
```

### 3.10 LocalAgentService 重构

```dart
// core/agent/local_agent_service.dart（重构后）
class LocalAgentService {
  final http.Client _client;
  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  Future<String> complete({
    required String sessionId,
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    required AgentCancellationToken cancellationToken,
    required void Function(AgentEvent) onEvent,
    SkillRegistryState? skillRegistry,  // 新增：从 chat_controller 注入
  }) async {
    if (config.apiKey.trim().isEmpty) throw StateError('请先在设置中配置 API Key');
    if (config.model.trim().isEmpty) throw StateError('请先在设置中配置模型');

    final modelConfig = AgentModelConfig(apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model);
    final model = OpenAICompatibleModel(_client);

    final plugins = <AgentPlugin>[
      if (workspace?.localPath != null) WorkspacePlugin(workspace!.localPath!),
      if (skillRegistry != null) SkillPlugin(skillRegistry),
    ];

    final session = AgentSession(
      model: model,
      systemPrompt: _buildBaseSystemPrompt(workspace?.promptContext),
      plugins: plugins,
      initialMessages: history,
    );

    final result = await session.run(
      prompt,
      config: modelConfig,
      cancellationToken: cancellationToken,
      onEvent: onEvent,
    );
    return result.text;
  }

  String _buildBaseSystemPrompt(String? context) {
    // 复用现有 _buildSystemPrompt 的 base 部分（不含工具说明，工具由 Plugin 注册）
  }

  // 保留 listModels / dispose 不变
}
```

## 4. 数据流

### 4.1 技能加载流

1. App 启动时 `SkillRegistryNotifier` 构造触发 `refresh()`
2. `SkillLoader.load()` 并行调用 4 个 `SkillSource.load()`
3. 每个 source 扫描各自目录，解析 frontmatter，校验 name/description
4. `SkillLoader` 按 kind 优先级去重，合并 diagnostics
5. `SkillRegistryNotifier` 从 SharedPreferences 读取 `disabledNames`，组合为 `SkillRegistryState`
6. 状态变化触发依赖该 provider 的 Widget 重建

### 4.2 Agent 执行流

1. 用户发送消息 → `ChatNotifier.sendMessage` → `_runLocalAgent`
2. `_runLocalAgent` 读取 `skillRegistryProvider`，传入 `LocalAgentService.complete()`
3. `LocalAgentService` 构造 `AgentSession`，注入 `[WorkspacePlugin, SkillPlugin]`
4. `AgentSession.run`：
   - 拼接 `systemPrompt + SkillPlugin.buildSystemPromptSuffix()`
   - 调用 `OpenAICompatibleModel.complete`，delta 通过 `onEvent(AgentEventType.assistantDelta)` 透传
   - 若 response 有 tool_calls：执行工具（可能调用 `read_skill` 加载技能内容）
   - 工具结果回传，进入下一轮
5. 最终 `result.text` 写入 ChatMessage

### 4.3 斜杠命令流

1. 用户在 `ChatInput` 输入 `/`
2. `_ChatInputState._controller.addListener` 检测到 `/` 前缀且不含空格，显示 `SkillCommandMenu` OverlayEntry
3. 菜单数据源：内置命令（`/new`、`/settings`）+ `skillRegistryProvider.skills.map((s) => '/skill:${s.name}')`
4. 菜单按当前输入文本前缀过滤（如 `/cod` 匹配 `/skill:code-review`）
5. 用户上下键选择 + Enter，或点击列表项：**选中后不直接发送**，而是把输入框内容替换为 `/skill:<name> `（末尾带空格），光标定位到空格后，关闭菜单，等待用户继续输入任务描述
6. 用户继续输入任务描述并按发送按钮（或 Enter）后，`ChatNotifier.sendMessage` 收到完整文本 `/skill:code-review 帮我审查 src/`
7. `ChatNotifier.sendMessage` 检测 `/skill:` 前缀，解析出 skill_name 与后续任务文本，拼装为：
   ```
   Load skill '<name>' and follow its instructions for the following task:

   <用户在命令后输入的文本>
   ```
   作为 prompt 传给 `LocalAgentService.complete()`。若用户未输入任务描述（仅 `/skill:name`），则只发送 `Load skill '<name>' and follow its instructions.`

### 4.4 桌面同步流

1. 桌面端通过 WS 推送 `{type: 'skills_sync', data: {skills: [{name, description, content}]}}`
2. `ConnectionNotifier` 解析为 `MobilePush(type: PushType.skillsSync, data: ...)`
3. `ChatNotifier._handleSkillsSync`：
   - 遍历 skills，写入 `~/.spacecode/skills/desktop-sync/<name>/SKILL.md`
   - 调用 `ref.read(skillRegistryProvider.notifier).refresh()`
4. 桌面断连不清空 desktop-sync 目录（保留上次同步内容）

### 4.5 GitHub 安装流

1. `SkillsScreen` 点击"安装"按钮 → `SkillInstallDialog` 输入 URL
2. URL 解析支持：`github.com/user/repo`、`https://github.com/user/repo`、`user/repo`
3. 调用 `SkillInstaller.installFromGithub(url)`：
   - 复用 `GithubService.cloneRepository()` clone 到 `~/.spacecode/skills/github/<repo-name>/`
   - 触发 `SkillRegistryNotifier.refresh()`
4. 失败时 Toast 提示，不写入 registry

## 5. UI 设计

### 5.1 SkillsScreen

- 路由：`/skills`
- 入口：设置页 + 聊天输入框斜杠菜单的"管理技能"项
- 布局：ListView，每项 `SkillCard`
- 顶部 AppBar：标题 + 右上角"安装"按钮
- 下拉刷新：触发 `SkillRegistryNotifier.refresh()`
- 空状态：引导用户安装或访问桌面端同步

### 5.2 SkillCard

- 主标题：`skill.name`
- 副标题：`skill.description`（最多 2 行，省略号）
- 左侧图标：按 source 区分（bundled: 盾牌、user: 用户、github: GitHub 图标、desktop-sync: 同步图标）
- 右侧开关：`enabled` 状态，切换调用 `toggleEnabled`
- 点击：进入 `SkillDetailPage`

### 5.3 SkillDetailPage

- 只读展示 `SKILL.md` 全文（用现有 `MarkdownRenderer` 组件）
- bundled：无操作按钮
- user/github：右上角"编辑"按钮，跳转编辑模式（TextField + 保存）
- 底部"删除"按钮（bundled 不可删除）：user 直接删文件，github 调用 `uninstall` 删目录

### 5.4 SkillInstallDialog

- TextField 输入 GitHub URL
- 提示文案："支持 github.com/user/repo 或 user/repo 格式"
- 确认后调用 `installFromGithub`，loading 状态显示 CircularProgressIndicator

### 5.5 SkillCommandMenu

- 触发条件：`ChatInput` 的 `TextEditingController.text` 以 `/` 开头且不含空格
- 位置：聊天输入框上方 OverlayEntry
- 内容：过滤匹配前缀的命令列表（内置 + 技能）
- 交互：上下键选择、Enter 确认、Esc 关闭、点击选中
- 选中后：替换输入框为命令文本，光标定位到末尾等待用户继续输入任务描述

## 6. 内置技能（assets/skills/）

MVP 提供 2 个示例技能，验证系统可用性：

### 6.1 code-review

```markdown
---
name: code-review
description: 审查代码变更，识别 bug、安全漏洞、性能问题与可维护性风险。当用户请求代码审查、review、code review 时使用。
---

# 代码审查

## 审查步骤
1. 使用 list_files/grep_files 定位目标代码
2. 使用 read_file 读取相关文件
3. 按以下维度审查：
   - 正确性：逻辑错误、边界条件、异常处理
   - 安全性：注入、越权、敏感信息泄漏
   - 性能：时间/空间复杂度、N+1 查询、不必要的拷贝
   - 可维护性：命名、职责划分、注释完整性
4. 按严重程度分级输出：必须修复 / 建议修改 / 仅供参考
```

### 6.2 commit-message

```markdown
---
name: commit-message
description: 生成符合 Conventional Commits 规范的中文提交信息。当用户请求生成 commit message、提交信息时使用。
---

# 提交信息生成

## 规范
- 格式：`<type>(<scope>): <subject>`
- type：feat / fix / docs / style / refactor / test / chore
- scope：可选，影响的模块
- subject：简明描述，不超过 50 字符，不以句号结尾

## 步骤
1. 使用 `git diff` 或读取变更文件
2. 识别变更类型与影响范围
3. 生成提交信息
```

## 7. 协议扩展

### 7.1 新增 PushType

```dart
// core/protocol/protocol.dart
enum PushType {
  // ... 已有
  skillsSync('skills_sync');  // 新增
}
```

### 7.2 skills_sync 推送数据格式

```json
{
  "type": "skills_sync",
  "data": {
    "skills": [
      {
        "name": "code-review",
        "description": "...",
        "content": "---\nname: code-review\n..."
      }
    ]
  }
}
```

桌面端实现（`mobileServer.ts` 扫描桌面端 skills 目录并推送）不在本规格范围。

## 8. 国际化

新增 `core/i18n/` 轻量方案：

```dart
// core/i18n/strings.dart
class I18n {
  static Locale _locale = Locale.zh;
  static Map<String, String> _strings = {};

  static void init(Locale locale);
  static String t(String key, [Map<String, String>? args]);
}

// 用法
I18n.t('skills.installDialogTitle')
```

`locales/zh.json` 与 `locales/en.json` 包含所有新增 UI 文案。

**语言选择决策**：在 `MobileConfig` 新增 `appLocale` 字段（`'zh'` / `'en'`，默认 `'zh'`），持久化到 SharedPreferences 的 `mobile_app_locale` key。设置页新增语言切换入口。理由：与 MobileConfig 现有模式一致（apiKey/baseUrl/model/githubToken 都存在这里），避免引入独立 provider 增加复杂度。

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| 单个技能 SKILL.md 解析失败 | 跳过该技能，记 warning diagnostic，不中断其他技能加载 |
| 技能 name 校验失败 | 仍加载（与 pi 一致），记 warning |
| 技能 description 完全缺失 | 跳过该技能（与 pi 一致） |
| 同名技能冲突 | 按优先级保留先到者，记 collision diagnostic |
| GitHub clone 失败 | Toast 提示错误，不写入 registry |
| 桌面同步写入失败 | 记日志，跳过该技能，继续处理其他 |
| `read_skill` 工具找不到技能 | 返回 `AgentToolResult(isError: true, content: 'Skill not found')` |
| bundled 技能 assets 读取失败 | 返回 `AgentToolResult(isError: true)` |
| AgentSession 工具执行异常 | 现有逻辑：捕获异常返回 `AgentToolResult(isError: true, content: 'Tool <name> failed: $error')` |

## 10. 测试策略

TDD：先写测试再实现。测试文件位于 `mobile-app/test/`。

| 测试文件 | 覆盖范围 |
|---------|---------|
| `test/skill_validator_test.dart` | 名称规则（长度、字符、连字符）、描述规则（必填、长度） |
| `test/skill_frontmatter_test.dart` | 标准 frontmatter 解析、缺字段、未知字段忽略、无 frontmatter 的纯 Markdown |
| `test/skill_loader_test.dart` | 4 source 并行加载、去重优先级、diagnostics 聚合、空目录 |
| `test/skill_registry_test.dart` | enabled/disabled 切换、持久化、refresh |
| `test/skill_plugin_test.dart` | 系统提示词 XML 格式、disableModelInvocation 过滤、read_skill 工具 |
| `test/openai_compatible_model_test.dart` | 已有，调整为新接口（onDelta 回调） |
| `test/local_agent_service_test.dart` | 已有，验证重构后行为不变（含/不含技能注入） |
| `test/skill_command_menu_test.dart` | `/` 触发、前缀过滤、选择后插入 |
| `test/skill_installer_test.dart` | URL 解析、clone 成功/失败（mock GithubService） |

## 11. 迁移路径

按依赖顺序分 10 步实现，每步独立可测试：

1. **扩展 AgentPlugin + AgentModel 接口**：新增 `buildSystemPromptSuffix()` 虚方法、`complete()` 增加 `onDelta` 参数。`AgentSession.run` 拼接 systemPrompt suffix 并透传 delta 事件。
2. **抽取 OpenAICompatibleModel**：从 `LocalAgentService` 复制 SSE 逻辑到新文件，实现 `AgentModel`。`LocalAgentService` 保留旧代码临时可运行（编译不破）。
3. **实现 skill_types + skill_frontmatter + skill_validator**（含单元测试）
4. **实现 4 个 SkillSource + SkillLoader**（含集成测试）
5. **实现 SkillRegistry + enabled 持久化**
6. **实现 SkillPlugin + _ReadSkillTool**（含测试）
7. **实现 SkillInstaller**（GitHub clone 复用 GithubService）
8. **重构 LocalAgentService**：接入 AgentSession + WorkspacePlugin + SkillPlugin，删除旧的 `_buildTools`/`_runTool`/`_buildSystemPrompt`。验证已有 `local_agent_service_test.dart` 通过。
9. **实现 UI**：SkillsScreen + SkillCard + SkillDetailPage + SkillInstallDialog + SkillCommandMenu + i18n
10. **改造 chat_input + 扩展 protocol + 添加 assets/skills/**：斜杠命令触发、`skills_sync` 推送处理、内置技能打包

## 12. 安全考虑

- **技能内容不可信**：技能是 Markdown 指令，可能引导模型执行任意工具调用。与 pi 一致，安装第三方技能前用户应审查内容。`SkillInstallDialog` 显示警告文案。
- **路径遍历防护**：`WorkspacePlugin.safePath` 已实现，技能内容若引用工作区外路径会被拒绝。
- **GitHub clone 沙箱**：clone 目标限定在 `~/.spacecode/skills/github/` 下，不可指定外部路径。
- **桌面同步内容**：来自已配对的桌面端，信任级别与现有 WS 通信一致。

## 13. 后续扩展点

本版预留以下扩展点，后续可通过新增 Plugin 实现，不改 AgentSession：

- **BashPlugin**：支持技能内 shell 脚本执行（iOS 沙箱需特殊处理，Android 需 Termux 或平台通道）
- **PromptTemplatePlugin**：复刻 pi 的 Prompt Templates（`/name` 展开 Markdown 模板）
- **ExtensionPlugin**：复刻 pi 的 Extensions（TypeScript 模块扩展 Agent 能力）——移动端无 JS runtime，需评估替代方案
- **技能热重载**：监听文件系统事件，自动 refresh registry
- **技能 allowed-tools 字段**：Agent Skills 标准的实验性字段，限定技能可调用的工具白名单

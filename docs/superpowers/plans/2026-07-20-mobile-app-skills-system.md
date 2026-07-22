# 移动端 AI Agent 技能系统 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `mobile-app/` 复刻 pi 的技能（Skills）系统，使用 Dart 实现；同时重构 `LocalAgentService` 接入已有的 `AgentSession` + `AgentPlugin` 架构，对齐 pi 的 Plugin 模式。

**架构：** `SkillPlugin` 作为 `AgentPlugin` 实现注入 `AgentSession`，负责系统提示词 XML 注入与 `read_skill` 工具注册；`SkillLoader` 聚合 4 个 `SkillSource`（bundled/user/github/desktop-sync）；`SkillRegistry` 作为 Riverpod state 持有技能列表与 enabled 黑名单；`OpenAiCompatibleModel`（已存在）扩展流式 + onDelta 回调；`LocalAgentService` 重构为组装 AgentSession + Plugins 的薄壳。

**技术栈：** Flutter 3、Dart 3、flutter_riverpod 2.5、path_provider、shared_preferences、http、go_router

**规格：** `docs/superpowers/specs/2026-07-20-mobile-app-skills-system-design.md`

**关键现状（实现前必读）：**
- `lib/core/agent/agent_plugin.dart` 已有 `AgentPlugin` 基类（只有 `createTools`/`beforeToolCall`/`afterToolCall`）
- `lib/core/agent/agent_model.dart` 已有 `AgentModel` 接口（`complete` 无 `onDelta` 参数）
- `lib/core/agent/agent_loop.dart` 已有 `AgentSession`（不拼接 suffix、不透传 delta）
- `lib/core/agent/openai_compatible_model.dart` 已有 `OpenAiCompatibleModel`（**非流式** `stream: false`，类名首字母小写 `i`）
- `lib/core/agent/local_agent_service.dart` 内部有**重复的流式实现**（`stream: true` + `_ToolCallBuilder`），硬编码 3 个工具
- `lib/core/agent/plugins/workspace_plugin.dart` 已有完整 `WorkspacePlugin`（list/read/write/edit/grep）但**未被 LocalAgentService 启用**
- `lib/core/agent/agent_types.dart` 的 `AgentEvent` 已有 `delta` 字段和 `AgentEventType.assistantDelta`
- 测试桩 `test/agent_core_test.dart` 的 `_QueuedModel`/`_BlockingModel` 实现了 `AgentModel.complete`（**不含 onDelta**），扩展接口后需同步更新
- `lib/core/config/mobile_config.dart` 的 `MobileConfig` 含 apiKey/baseUrl/model/githubToken/githubLogin，**无 appLocale**
- `lib/core/protocol/protocol.dart` 的 `PushType` 枚举末尾是 `pong`
- `lib/routing/router.dart` 只有 `/` 和 `/settings` 路由
- `lib/core/github/github_service.dart` 的 `cloneRepository` 签名：`(repository, branch, targetDirectory, abortTrigger?, isCancelled?)`

**关键约束：**
- 类名统一用 `OpenAiCompatibleModel`（小写 i，与现有代码一致），**不要**改为 `OpenAICompatibleModel`
- 保留 `LocalAgentService.complete()` 对外签名不变（含 `sessionId`/`config`/`prompt`/`workspace`/`history`/`cancellationToken`/`onEvent`），新增可选参数 `skillRegistry`
- 不引入 `yaml` 包，frontmatter 自实现轻量解析
- 不引入 `flutter_localizations`，i18n 用自建 `core/i18n/strings.dart`
- 测试用 `flutter_test`，mock 用 `http/testing.dart` 的 `MockClient`/`MockClient.streaming`

**测试运行命令：** `cd mobile-app && flutter test`（单个文件：`flutter test test/skill_validator_test.dart`）

**类型检查命令：** `cd mobile-app && flutter analyze`

---

## 任务 1：扩展 AgentPlugin 与 AgentModel 接口

**文件：**
- 修改：`mobile-app/lib/core/agent/agent_plugin.dart`
- 修改：`mobile-app/lib/core/agent/agent_model.dart`
- 修改：`mobile-app/lib/core/agent/agent_loop.dart`
- 修改：`mobile-app/test/agent_core_test.dart`（更新测试桩签名）
- 测试：`mobile-app/test/agent_session_system_prompt_test.dart`（新建）

- [ ] **步骤 1：编写失败的测试 - AgentSession 拼接 plugin suffix**

创建 `mobile-app/test/agent_session_system_prompt_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_loop.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';

class _SuffixModel extends AgentModel {
  String? capturedSystemPrompt;

  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    capturedSystemPrompt = systemPrompt;
    return const AgentModelResponse(text: 'done');
  }
}

class _SuffixPlugin extends AgentPlugin {
  final String suffix;
  _SuffixPlugin(this.suffix);

  @override
  String buildSystemPromptSuffix() => suffix;
}

void main() {
  test('AgentSession concatenates plugin systemPrompt suffix', () async {
    final model = _SuffixModel();
    final session = AgentSession(
      model: model,
      systemPrompt: 'BASE',
      plugins: [_SuffixPlugin('\nSUFFIX_A')],
    );

    await session.run(
      'hi',
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
    );

    expect(model.capturedSystemPrompt, 'BASE\nSUFFIX_A');
  });

  test('AgentSession forwards onDelta to onEvent', () async {
    final model = _DeltaModel();
    final session = AgentSession(model: model, systemPrompt: 'BASE');
    final deltas = <String>[];

    await session.run(
      'hi',
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      onEvent: (event) {
        if (event.type == AgentEventType.assistantDelta && event.delta != null) {
          deltas.add(event.delta!);
        }
      },
    );

    expect(deltas, ['Hel', 'lo']);
  });
}

class _DeltaModel extends AgentModel {
  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    onDelta?.call('Hel');
    onDelta?.call('lo');
    return const AgentModelResponse(text: 'Hello');
  }
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/agent_session_system_prompt_test.dart`
预期：FAIL，编译错误：`buildSystemPromptSuffix` 方法未定义、`onDelta` 参数未定义。

- [ ] **步骤 3：扩展 AgentPlugin 接口**

修改 `mobile-app/lib/core/agent/agent_plugin.dart` 的 `AgentPlugin` 类，在 `afterToolCall` 之后新增：

```dart
  /// 返回追加到 systemPrompt 末尾的文本，默认空。
  /// AgentSession 在每次调用 model.complete 前拼接所有 plugin 的 suffix。
  String buildSystemPromptSuffix() => '';
```

- [ ] **步骤 4：扩展 AgentModel 接口**

修改 `mobile-app/lib/core/agent/agent_model.dart` 的 `AgentModel.complete`，在 `cancellationToken` 之后新增参数：

```dart
abstract class AgentModel {
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  });

  void dispose() {}
}
```

- [ ] **步骤 5：扩展 AgentSession.run 拼接 suffix + 透传 delta**

修改 `mobile-app/lib/core/agent/agent_loop.dart` 的 `run` 方法。

找到 `final response = await model.complete(` 调用块（第 44-50 行），替换为：

```dart
        final suffix = _tools.plugins
            .map((plugin) => plugin.buildSystemPromptSuffix())
            .where((text) => text.isNotEmpty)
            .join();
        final effectiveSystemPrompt = suffix.isEmpty
            ? systemPrompt
            : '$systemPrompt$suffix';
        final response = await model.complete(
          config: config,
          systemPrompt: effectiveSystemPrompt,
          messages: List<AgentMessage>.from(_messages),
          tools: _tools.definitions,
          cancellationToken: token,
          onDelta: (delta) {
            onEvent?.call(AgentEvent(
              type: AgentEventType.assistantDelta,
              delta: delta,
            ));
          },
        );
```

- [ ] **步骤 6：更新现有测试桩签名**

修改 `mobile-app/test/agent_core_test.dart` 中的 `_QueuedModel` 和 `_BlockingModel`，在 `complete` 方法参数末尾加 `void Function(String delta)? onDelta,`（与步骤 4 的签名一致）。

- [ ] **步骤 7：更新 OpenAiCompatibleModel 签名**

修改 `mobile-app/lib/core/agent/openai_compatible_model.dart` 的 `complete` 方法，在 `cancellationToken` 之后加 `void Function(String delta)? onDelta,` 参数（**暂不使用**，下个任务实现流式）。方法体不变。

- [ ] **步骤 8：运行所有测试验证通过**

运行：`cd mobile-app && flutter test`
预期：PASS（所有现有测试 + 新测试通过）

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 9：Commit**

```bash
cd mobile-app
git add lib/core/agent/agent_plugin.dart lib/core/agent/agent_model.dart lib/core/agent/agent_loop.dart lib/core/agent/openai_compatible_model.dart test/agent_core_test.dart test/agent_session_system_prompt_test.dart
git commit -m "feat(agent): 扩展 AgentPlugin 与 AgentModel 接口支持系统提示词注入与流式 delta"
```

---

## 任务 2：OpenAiCompatibleModel 支持流式 + onDelta

**文件：**
- 修改：`mobile-app/lib/core/agent/openai_compatible_model.dart`
- 测试：`mobile-app/test/openai_compatible_model_test.dart`（已有，扩展）

- [ ] **步骤 1：编写失败的测试 - 流式 onDelta 回调**

在 `mobile-app/test/openai_compatible_model_test.dart` 末尾 `main()` 内追加：

```dart
  test('streams delta content via onDelta callback', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      final chunks = [
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': 'Hel'}}
          ]
        })}\n\n',
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': 'lo'}}
          ]
        })}\n\n',
        'data: [DONE]\n\n',
      ];
      final bytes = <int>[];
      for (final c in chunks) {
        bytes.addAll(utf8.encode(c));
      }
      return http.StreamedResponse(
        Stream.value(bytes),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final model = OpenAiCompatibleModel(client: client);
    final deltas = <String>[];

    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('hi')],
      tools: const [],
      cancellationToken: AgentCancellationToken(),
      onDelta: deltas.add,
    );

    expect(result.text, 'Hello');
    expect(deltas, ['Hel', 'lo']);
  });

  test('parses streamed tool_calls', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      final chunks = [
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {
                'tool_calls': [
                  {
                    'id': 'call-1',
                    'function': {'name': 'read_file', 'arguments': '{"path":"a'}
                  }
                ]
              }
            }
          ]
        })}\n\n',
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {
                'tool_calls': [
                  {'function': {'arguments': '.txt"}'}}
                ]
              }
            }
          ]
        })}\n\n',
        'data: [DONE]\n\n',
      ];
      final bytes = <int>[];
      for (final c in chunks) {
        bytes.addAll(utf8.encode(c));
      }
      return http.StreamedResponse(
        Stream.value(bytes),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final model = OpenAiCompatibleModel(client: client);
    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('hi')],
      tools: const [],
      cancellationToken: AgentCancellationToken(),
    );

    expect(result.toolCalls.length, 1);
    expect(result.toolCalls.first.name, 'read_file');
    expect(result.toolCalls.first.arguments, {'path': 'a.txt'});
  });
```

确保文件顶部已 import：
```dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/openai_compatible_model.dart';
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/openai_compatible_model_test.dart`
预期：FAIL，流式 delta 没有触发、tool_calls 没有累积（因为当前是非流式）。

- [ ] **步骤 3：重写 OpenAiCompatibleModel.complete 支持流式**

完全替换 `mobile-app/lib/core/agent/openai_compatible_model.dart` 中 `complete` 方法的方法体（保留类声明、字段、`_messageToJson`、`_readText`、`_readToolCalls`、`dispose`）：

```dart
  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    cancellationToken.throwIfCancelled();
    final base = config.baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint =
        base.endsWith('/chat/completions') ? base : '$base/chat/completions';
    final useStream = onDelta != null;
    final request = http.AbortableRequest(
      'POST',
      Uri.parse(endpoint),
      abortTrigger: cancellationToken.whenCancelled,
    )
      ..headers.addAll({
        'Authorization': 'Bearer ${config.apiKey}',
        'Content-Type': 'application/json',
        if (useStream) 'Accept': 'text/event-stream',
      })
      ..body = jsonEncode({
        'model': config.model,
        'stream': useStream,
        'messages': [
          {'role': 'system', 'content': systemPrompt},
          ...messages.map(_messageToJson),
        ],
        if (tools.isNotEmpty)
          'tools': tools
              .map((tool) => {
                    'type': 'function',
                    'function': {
                      'name': tool.name,
                      'description': tool.description,
                      'parameters': tool.inputSchema,
                    },
                  })
              .toList(),
      });

    if (!useStream) {
      return _completeNonStream(request, cancellationToken);
    }
    return _completeStream(request, cancellationToken, onDelta);
  }

  Future<AgentModelResponse> _completeNonStream(
    http.AbortableRequest request,
    AgentCancellationToken cancellationToken,
  ) async {
    late http.Response response;
    try {
      final streamed =
          await _client.send(request).timeout(const Duration(seconds: 90));
      response = await http.Response.fromStream(streamed);
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    cancellationToken.throwIfCancelled();

    Object? body;
    try {
      body = jsonDecode(response.body);
    } on FormatException {
      throw StateError('模型返回了无效 JSON（${response.statusCode}）');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body is Map<String, dynamic> ? body['error'] : null;
      final message = error is Map
          ? error['message']
          : body is Map
              ? body['message']
              : null;
      throw StateError(message?.toString() ?? '模型请求失败（${response.statusCode}）');
    }
    if (body is! Map<String, dynamic>) throw StateError('模型返回了无效响应');
    final choices = body['choices'];
    if (choices is! List || choices.isEmpty || choices.first is! Map) {
      throw StateError('模型没有返回内容');
    }
    final message = (choices.first as Map)['message'];
    if (message is! Map<String, dynamic>) throw StateError('模型返回了无效消息');
    return AgentModelResponse(
      text: _readText(message['content']),
      toolCalls: _readToolCalls(message['tool_calls']),
    );
  }

  Future<AgentModelResponse> _completeStream(
    http.AbortableRequest request,
    AgentCancellationToken cancellationToken,
    void Function(String delta) onDelta,
  ) async {
    http.StreamedResponse response;
    try {
      response = await _client
          .send(request)
          .timeout(const Duration(seconds: 90));
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final errorBody = await response.stream.bytesToString();
      String? message;
      try {
        final decoded = jsonDecode(errorBody);
        if (decoded is Map<String, dynamic>) {
          final err = decoded['error'];
          if (err is Map) {
            message = err['message']?.toString();
          } else {
            message = decoded['message']?.toString();
          }
        }
      } catch (_) {
        message = errorBody;
      }
      throw StateError(message?.toString() ?? '模型请求失败（${response.statusCode}）');
    }

    final buffer = StringBuffer();
    final toolCallBuilder = _StreamingToolCallBuilder();
    final lineBuffer = StringBuffer();
    try {
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        cancellationToken.throwIfCancelled();
        lineBuffer.write(chunk);
        final lines = lineBuffer.toString().split('\n');
        lineBuffer.clear();
        if (lines.isNotEmpty && !lines.last.endsWith('\n')) {
          lineBuffer.write(lines.removeLast());
        }
        for (final rawLine in lines) {
          final line = rawLine.trim();
          if (line.isEmpty || !line.startsWith('data:')) continue;
          final data = line.substring(5).trim();
          if (data == '[DONE]') {
            toolCallBuilder.markDone();
            continue;
          }
          try {
            final decoded = jsonDecode(data);
            if (decoded is! Map<String, dynamic>) continue;
            final choices = decoded['choices'];
            if (choices is! List || choices.isEmpty) continue;
            final choice = choices.first;
            if (choice is! Map<String, dynamic>) continue;
            final delta = choice['delta'];
            if (delta is! Map<String, dynamic>) continue;
            final content = delta['content'];
            if (content is String && content.isNotEmpty) {
              buffer.write(content);
              onDelta(content);
            }
            toolCallBuilder.consumeDelta(delta);
          } catch (_) {
            // 忽略解析错误的 chunk
          }
        }
      }
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    toolCallBuilder.markDone();
    return AgentModelResponse(
      text: buffer.toString(),
      toolCalls: toolCallBuilder.buildToolCalls(),
    );
  }
```

在文件末尾（`OpenAiCompatibleModel` 类外面）新增辅助类：

```dart
/// 在 SSE 流中累积 tool_calls 信息（支持多个并发 tool_call）。
class _StreamingToolCallBuilder {
  final Map<int, _StreamingToolCall> _calls = {};
  bool _done = false;

  void consumeDelta(Map<String, dynamic> delta) {
    final toolCalls = delta['tool_calls'];
    if (toolCalls is! List || toolCalls.isEmpty) return;
    for (final tc in toolCalls.whereType<Map<String, dynamic>>()) {
      final index = (tc['index'] as int?) ?? 0;
      final existing = _calls.putIfAbsent(index, () => _StreamingToolCall());
      final id = tc['id'] as String?;
      if (id != null && existing.id.isEmpty) existing.id = id;
      final function = tc['function'];
      if (function is! Map<String, dynamic>) continue;
      final name = function['name'] as String?;
      if (name != null && existing.name.isEmpty) existing.name = name;
      final args = function['arguments'];
      if (args is String) existing.arguments.write(args);
    }
  }

  void markDone() {
    _done = true;
  }

  List<AgentToolCall> buildToolCalls() {
    if (!_done) return const [];
    final sortedKeys = _calls.keys.toList()..sort();
    return sortedKeys.map((index) {
      final call = _calls[index]!;
      Map<String, dynamic> decodedArgs;
      final raw = call.arguments.toString();
      if (raw.isEmpty) {
        decodedArgs = const {};
      } else {
        try {
          final decoded = jsonDecode(raw);
          decodedArgs = decoded is Map
              ? decoded.cast<String, dynamic>()
              : <String, dynamic>{};
        } catch (_) {
          decodedArgs = {'_raw': raw};
        }
      }
      return AgentToolCall(
        id: call.id.isEmpty ? 'tool-${index + 1}' : call.id,
        name: call.name,
        arguments: decodedArgs,
      );
    }).toList();
  }
}

class _StreamingToolCall {
  String id = '';
  String name = '';
  final StringBuffer arguments = StringBuffer();
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/openai_compatible_model_test.dart`
预期：PASS（流式 delta + tool_calls 累积 + 原有非流式测试都通过）

- [ ] **步骤 5：Commit**

```bash
cd mobile-app
git add lib/core/agent/openai_compatible_model.dart test/openai_compatible_model_test.dart
git commit -m "feat(agent): OpenAiCompatibleModel 支持流式 SSE 与 onDelta 回调"
```

---

## 任务 3：实现 skill_types 与 skill_frontmatter

**文件：**
- 创建：`mobile-app/lib/core/skills/skill_types.dart`
- 创建：`mobile-app/lib/core/skills/skill_frontmatter.dart`
- 测试：`mobile-app/test/skill_frontmatter_test.dart`

- [ ] **步骤 1：创建 skill_types.dart**

创建 `mobile-app/lib/core/skills/skill_types.dart`：

```dart
/// 技能系统核心数据类型。

/// 技能来源类型。
///
/// - [bundled]：随 APK/IPA 打包的内置技能（assets/skills/）
/// - [user]：用户在应用文档目录创建的技能（~/.spacecode/skills/）
/// - [github]：从 GitHub 仓库安装的技能（~/.spacecode/skills/github/<repo>/）
/// - [desktopSync]：桌面端 SpaceCode 通过 WS 推送同步的技能
enum SkillSourceKind { bundled, user, github, desktopSync }

/// 诊断类型。
enum SkillDiagnosticType { warning, error, collision }

/// 技能加载诊断信息（非致命错误，用于在 UI 展示加载异常）。
class SkillDiagnostic {
  final SkillDiagnosticType type;
  final String message;
  final String? path;

  const SkillDiagnostic({
    required this.type,
    required this.message,
    this.path,
  });
}

/// 一个已加载的技能。
class Skill {
  /// 校验后的小写名（仅 a-z/0-9/连字符）。
  final String name;

  /// frontmatter 中的 description，trim 后非空，≤1024 字符。
  final String description;

  /// SKILL.md 的绝对路径（bundled 技能为 assets 虚拟路径）。
  final String filePath;

  /// 技能目录（filePath 的 dirname）。
  final String baseDir;

  /// 技能来源。
  final SkillSourceKind source;

  /// frontmatter 的 `disable-model-invocation` 字段。
  /// 为 true 时该技能不进入系统提示词的 available_skills 列表，
  /// 但仍可通过 /skill:name 命令显式调用。
  final bool disableModelInvocation;

  const Skill({
    required this.name,
    required this.description,
    required this.filePath,
    required this.baseDir,
    required this.source,
    this.disableModelInvocation = false,
  });
}

/// SkillSource.load 与 SkillLoader.load 的返回值。
class LoadResult {
  final List<Skill> skills;
  final List<SkillDiagnostic> diagnostics;

  const LoadResult({
    required this.skills,
    required this.diagnostics,
  });

  static const empty = LoadResult(skills: [], diagnostics: []);
}
```

- [ ] **步骤 2：编写失败的测试 - frontmatter 解析**

创建 `mobile-app/test/skill_frontmatter_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_frontmatter.dart';

void main() {
  test('parses standard frontmatter', () {
    const markdown = '''---
name: code-review
description: 审查代码变更。
disable-model-invocation: true
---

# 代码审查
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, 'code-review');
    expect(fm.description, '审查代码变更。');
    expect(fm.disableModelInvocation, true);
  });

  test('returns defaults when frontmatter is missing', () {
    const markdown = '# No frontmatter here';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, isNull);
    expect(fm.description, isNull);
    expect(fm.disableModelInvocation, false);
  });

  test('ignores unknown fields', () {
    const markdown = '''---
name: foo
unknown-field: value
description: bar
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, 'foo');
    expect(fm.description, 'bar');
  });

  test('handles quoted descriptions', () {
    const markdown = '''---
name: foo
description: "A skill: with colon"
---
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.description, 'A skill: with colon');
  });

  test('parses boolean false for disable-model-invocation', () {
    const markdown = '''---
name: foo
disable-model-invocation: false
---
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.disableModelInvocation, false);
  });

  test('returns empty frontmatter when delimiter missing', () {
    const markdown = 'name: foo\ndescription: bar';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, isNull);
    expect(fm.description, isNull);
  });
}
```

- [ ] **步骤 3：运行测试验证失败**

运行：`cd mobile-app && flutter test test/skill_frontmatter_test.dart`
预期：FAIL，`SkillFrontmatter` 类不存在。

- [ ] **步骤 4：实现 SkillFrontmatter**

创建 `mobile-app/lib/core/skills/skill_frontmatter.dart`：

```dart
/// SKILL.md 的 YAML frontmatter 轻量解析器。
///
/// 仅支持扁平 `key: value` 字段，不支持嵌套/数组/多行字符串。
/// 解析失败时返回空 frontmatter（name/description 为 null）。
class SkillFrontmatter {
  /// frontmatter 的 `name` 字段（未校验）。
  final String? name;

  /// frontmatter 的 `description` 字段（未校验，可能含转义）。
  final String? description;

  /// frontmatter 的 `disable-model-invocation` 字段。
  final bool disableModelInvocation;

  const SkillFrontmatter({
    this.name,
    this.description,
    this.disableModelInvocation = false,
  });

  /// 解析 Markdown 文档的 YAML frontmatter（开头 --- ... --- 之间）。
  static SkillFrontmatter parse(String markdown) {
    final lines = markdown.split('\n');
    if (lines.isEmpty || lines.first.trim() != '---') {
      return const SkillFrontmatter();
    }
    String? name;
    String? description;
    bool disableModelInvocation = false;
    for (var i = 1; i < lines.length; i++) {
      final line = lines[i];
      if (line.trim() == '---') break;
      final colon = line.indexOf(':');
      if (colon <= 0) continue;
      final key = line.substring(0, colon).trim();
      var value = line.substring(colon + 1).trim();
      value = _stripQuotes(value);
      switch (key) {
        case 'name':
          name = value.isEmpty ? null : value;
          break;
        case 'description':
          description = value.isEmpty ? null : value;
          break;
        case 'disable-model-invocation':
          disableModelInvocation = value == 'true';
          break;
      }
    }
    return SkillFrontmatter(
      name: name,
      description: description,
      disableModelInvocation: disableModelInvocation,
    );
  }

  static String _stripQuotes(String value) {
    if (value.length >= 2) {
      final first = value[0];
      final last = value[value.length - 1];
      if ((first == '"' && last == '"') || (first == "'" && last == "'")) {
        return value.substring(1, value.length - 1);
      }
    }
    return value;
  }
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_frontmatter_test.dart`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
cd mobile-app
git add lib/core/skills/skill_types.dart lib/core/skills/skill_frontmatter.dart test/skill_frontmatter_test.dart
git commit -m "feat(skills): 实现技能类型与 frontmatter 解析器"
```

---

## 任务 4：实现 skill_validator

**文件：**
- 创建：`mobile-app/lib/core/skills/skill_validator.dart`
- 测试：`mobile-app/test/skill_validator_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/skill_validator_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_validator.dart';

void main() {
  group('validateName', () {
    test('accepts valid lowercase name', () {
      expect(SkillValidator.validateName('code-review'), isEmpty);
      expect(SkillValidator.validateName('commit-message'), isEmpty);
      expect(SkillValidator.validateName('a1b2'), isEmpty);
    });

    test('rejects empty name', () {
      expect(SkillValidator.validateName(''), isNotEmpty);
      expect(SkillValidator.validateName('   '), isNotEmpty);
    });

    test('rejects uppercase letters', () {
      expect(SkillValidator.validateName('CodeReview'), isNotEmpty);
      expect(SkillValidator.validateName('code-Review'), isNotEmpty);
    });

    test('rejects special characters', () {
      expect(SkillValidator.validateName('code_review'), isNotEmpty);
      expect(SkillValidator.validateName('code.review'), isNotEmpty);
      expect(SkillValidator.validateName('code review'), isNotEmpty);
    });

    test('rejects leading/trailing hyphen', () {
      expect(SkillValidator.validateName('-code'), isNotEmpty);
      expect(SkillValidator.validateName('code-'), isNotEmpty);
    });

    test('rejects consecutive hyphens', () {
      expect(SkillValidator.validateName('code--review'), isNotEmpty);
    });

    test('rejects name exceeding 64 chars', () {
      final long = 'a' * 65;
      expect(SkillValidator.validateName(long), isNotEmpty);
    });

    test('accepts name of exactly 64 chars', () {
      final valid = 'a' * 64;
      expect(SkillValidator.validateName(valid), isEmpty);
    });
  });

  group('validateDescription', () {
    test('accepts valid description', () {
      expect(SkillValidator.validateDescription('审查代码'), isEmpty);
      expect(SkillValidator.validateDescription('A skill for code review.'), isEmpty);
    });

    test('rejects null', () {
      expect(SkillValidator.validateDescription(null), isNotEmpty);
    });

    test('rejects empty or whitespace-only', () {
      expect(SkillValidator.validateDescription(''), isNotEmpty);
      expect(SkillValidator.validateDescription('   '), isNotEmpty);
    });

    test('rejects description exceeding 1024 chars', () {
      final long = 'a' * 1025;
      expect(SkillValidator.validateDescription(long), isNotEmpty);
    });

    test('accepts description of exactly 1024 chars', () {
      final valid = 'a' * 1024;
      expect(SkillValidator.validateDescription(valid), isEmpty);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/skill_validator_test.dart`
预期：FAIL，`SkillValidator` 类不存在。

- [ ] **步骤 3：实现 SkillValidator**

创建 `mobile-app/lib/core/skills/skill_validator.dart`：

```dart
import 'skill_types.dart';

/// 技能名称与描述校验器，规则对齐 Agent Skills spec。
class SkillValidator {
  static const int maxNameLength = 64;
  static const int maxDescriptionLength = 1024;

  static final _namePattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');

  /// 返回校验错误列表，空列表表示通过。
  static List<String> validateName(String name) {
    final errors = <String>[];
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      errors.add('name 不能为空');
      return errors;
    }
    if (trimmed.length > maxNameLength) {
      errors.add('name 长度不能超过 $maxNameLength 字符');
    }
    if (!_namePattern.hasMatch(trimmed)) {
      errors.add('name 只能包含小写字母、数字、连字符，不能以连字符开头/结尾，不能有连续连字符');
    }
    return errors;
  }

  /// 返回校验错误列表，空列表表示通过。
  static List<String> validateDescription(String? description) {
    final errors = <String>[];
    if (description == null) {
      errors.add('description 不能为空');
      return errors;
    }
    final trimmed = description.trim();
    if (trimmed.isEmpty) {
      errors.add('description 不能为空');
      return errors;
    }
    if (description.length > maxDescriptionLength) {
      errors.add('description 长度不能超过 $maxDescriptionLength 字符');
    }
    return errors;
  }

  /// 综合校验：返回 (isValid, errors)。
  /// description 完全缺失（null）视为致命错误，调用方应跳过该技能。
  static ({bool skip, List<String> errors}) validate({
    required String name,
    required String? description,
  }) {
    final nameErrors = validateName(name);
    final descErrors = validateDescription(description);
    final allErrors = [...nameErrors, ...descErrors];
    return (skip: description == null, errors: allErrors);
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_validator_test.dart`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd mobile-app
git add lib/core/skills/skill_validator.dart test/skill_validator_test.dart
git commit -m "feat(skills): 实现技能名称与描述校验器"
```

---

## 任务 5：实现 SkillSource 接口 + 4 个实现 + SkillLoader

**文件：**
- 创建：`mobile-app/lib/core/skills/skill_loader.dart`
- 创建：`mobile-app/lib/core/skills/sources/bundled_skill_source.dart`
- 创建：`mobile-app/lib/core/skills/sources/user_skill_source.dart`
- 创建：`mobile-app/lib/core/skills/sources/github_skill_source.dart`
- 创建：`mobile-app/lib/core/skills/sources/desktop_sync_skill_source.dart`
- 测试：`mobile-app/test/skill_loader_test.dart`

- [ ] **步骤 1：创建 skill_loader.dart（含 SkillSource 接口 + SkillLoader）**

创建 `mobile-app/lib/core/skills/skill_loader.dart`：

```dart
import 'skill_types.dart';

/// 单一技能来源的扫描器接口。
abstract class SkillSource {
  /// 来源类型。
  SkillSourceKind get kind;

  /// 扫描该来源下所有可用技能。
  ///
  /// 返回 [LoadResult] 包含扫描到的技能列表与诊断信息。
  /// 单个技能加载失败应记 diagnostic，不抛异常中断整体扫描。
  Future<LoadResult> load();
}

/// 聚合多个 [SkillSource] 的加载结果。
class SkillLoader {
  /// 按优先级排序的来源列表（高优先级在前）。
  ///
  /// 默认顺序：bundled > user > github > desktopSync。
  /// 同名技能先到先得，被覆盖的记 collision diagnostic。
  final List<SkillSource> sources;

  SkillLoader(this.sources);

  /// 并行加载所有 source，按 sources 列表顺序去重。
  Future<LoadResult> load() async {
    final results = await Future.wait(sources.map((s) => s.load()));
    final skillsByName = <String, Skill>{};
    final diagnostics = <SkillDiagnostic>[];

    for (var i = 0; i < sources.length; i++) {
      final source = sources[i];
      final result = results[i];
      diagnostics.addAll(result.diagnostics);
      for (final skill in result.skills) {
        if (skillsByName.containsKey(skill.name)) {
          final existing = skillsByName[skill.name]!;
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.collision,
            message:
                '技能 ${skill.name} 在 ${skill.source.name} 与 ${existing.source.name} 中都存在，保留 ${existing.source.name}',
            path: skill.filePath,
          ));
          continue;
        }
        skillsByName[skill.name] = skill;
      }
    }

    return LoadResult(
      skills: skillsByName.values.toList(growable: false),
      diagnostics: diagnostics,
    );
  }
}
```

- [ ] **步骤 2：创建 _FilesystemSkillSource 共享扫描逻辑**

由于 user/github/desktopSync 三个 source 都需要递归扫描目录下的 SKILL.md，先创建一个共享 mixin。

创建 `mobile-app/lib/core/skills/sources/filesystem_skill_source.dart`：

```dart
import 'dart:io';

import '../skill_frontmatter.dart';
import '../skill_loader.dart';
import '../skill_types.dart';
import '../skill_validator.dart';

/// 文件系统技能来源的共享扫描逻辑。
///
/// user/github/desktopSync 三个 source 共用此 mixin。
mixin FilesystemSkillSource on SkillSource {
  /// 扫描 [rootDirectory] 下所有名为 SKILL.md 的文件（递归）。
  ///
  /// 遵循 .gitignore（若存在）中的 SKILL.md 路径排除规则——本版简化为：
  /// 遇到 node_modules、.git 目录直接跳过。
  Future<LoadResult> scanDirectory(Directory rootDirectory) async {
    if (!await rootDirectory.exists()) {
      return LoadResult.empty;
    }
    final skills = <Skill>[];
    final diagnostics = <SkillDiagnostic>[];
    try {
      await for (final entity in rootDirectory.list(
        recursive: true,
        followLinks: false,
      )) {
        if (entity is! File) continue;
        if (entity.path.split(Platform.pathSeparator).any(_isIgnoredSegment)) {
          continue;
        }
        if (_basename(entity.path) != 'SKILL.md') continue;
        final skill = await _loadSkillFile(entity, kind);
        if (skill != null) {
          skills.add(skill);
        } else {
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.warning,
            message: 'SKILL.md 解析失败或 description 缺失',
            path: entity.path,
          ));
        }
      }
    } catch (error) {
      diagnostics.add(SkillDiagnostic(
        type: SkillDiagnosticType.error,
        message: '扫描目录失败：$error',
        path: rootDirectory.path,
      ));
    }
    return LoadResult(skills: skills, diagnostics: diagnostics);
  }

  Future<Skill?> _loadSkillFile(
    File file,
    SkillSourceKind source,
  ) async {
    try {
      final content = await file.readAsString();
      final frontmatter = SkillFrontmatter.parse(content);
      final name = frontmatter.name ?? '';
      final description = frontmatter.description;
      final validation = SkillValidator.validate(
        name: name,
        description: description,
      );
      if (validation.skip) {
        return null;
      }
      if (validation.errors.isNotEmpty) {
        // 校验失败仍加载（与 pi 一致），由调用方根据 diagnostics 决定是否提示
      }
      return Skill(
        name: name.trim(),
        description: description!.trim(),
        filePath: file.path,
        baseDir: file.parent.path,
        source: source,
        disableModelInvocation: frontmatter.disableModelInvocation,
      );
    } catch (_) {
      return null;
    }
  }

  bool _isIgnoredSegment(String segment) {
    return segment == 'node_modules' || segment == '.git';
  }

  String _basename(String path) {
    final segments = path.split(Platform.pathSeparator);
    return segments.isEmpty ? '' : segments.last;
  }
}
```

- [ ] **步骤 3：创建 BundledSkillSource**

创建 `mobile-app/lib/core/skills/sources/bundled_skill_source.dart`：

```dart
import 'package:flutter/services.dart';

import '../skill_frontmatter.dart';
import '../skill_loader.dart';
import '../skill_types.dart';
import '../skill_validator.dart';

/// 随 APK/IPA 打包的内置技能来源。
///
/// 通过 `pubspec.yaml` 的 `flutter.assets` 声明技能路径，
/// 运行时用 [rootBundle] 读取。bundled 技能只读、不可写。
class BundledSkillSource implements SkillSource {
  /// 内置技能的 asset 路径列表（如 `['assets/skills/code-review/SKILL.md']`）。
  final List<String> assetPaths;

  const BundledSkillSource(this.assetPaths);

  @override
  SkillSourceKind get kind => SkillSourceKind.bundled;

  @override
  Future<LoadResult> load() async {
    final skills = <Skill>[];
    final diagnostics = <SkillDiagnostic>[];
    for (final path in assetPaths) {
      try {
        final content = await rootBundle.loadString(path);
        final frontmatter = SkillFrontmatter.parse(content);
        final name = frontmatter.name ?? '';
        final description = frontmatter.description;
        if (description == null) {
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.warning,
            message: '内置技能 $path 的 description 缺失，已跳过',
            path: path,
          ));
          continue;
        }
        SkillValidator.validate(name: name, description: description);
        skills.add(Skill(
          name: name.trim(),
          description: description.trim(),
          filePath: path,
          baseDir: path.substring(0, path.lastIndexOf('/')),
          source: SkillSourceKind.bundled,
          disableModelInvocation: frontmatter.disableModelInvocation,
        ));
      } catch (error) {
        diagnostics.add(SkillDiagnostic(
          type: SkillDiagnosticType.error,
          message: '加载内置技能 $path 失败：$error',
          path: path,
        ));
      }
    }
    return LoadResult(skills: skills, diagnostics: diagnostics);
  }
}
```

- [ ] **步骤 4：创建 UserSkillSource**

创建 `mobile-app/lib/core/skills/sources/user_skill_source.dart`：

```dart
import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 用户本地创建的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/`
class UserSkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  UserSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.user;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
```

- [ ] **步骤 5：创建 GithubSkillSource**

创建 `mobile-app/lib/core/skills/sources/github_skill_source.dart`：

```dart
import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 从 GitHub 仓库安装的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/github/`
/// 每个安装的仓库作为子目录，扫描其中的所有 SKILL.md。
class GithubSkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  GithubSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.github;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
```

- [ ] **步骤 6：创建 DesktopSyncSkillSource**

创建 `mobile-app/lib/core/skills/sources/desktop_sync_skill_source.dart`：

```dart
import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 桌面端 SpaceCode 通过 WS 推送同步的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/desktop-sync/`
class DesktopSyncSkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  DesktopSyncSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.desktopSync;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
```

- [ ] **步骤 7：编写 SkillLoader 测试**

创建 `mobile-app/test/skill_loader_test.dart`：

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_loader.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';
import 'package:spacecode_mobile/core/skills/sources/user_skill_source.dart';

void main() {
  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('skill-loader-test-');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<File> _writeSkill(String relativePath, String content) async {
    final file = File('${tempDir.path}/$relativePath');
    await file.parent.create(recursive: true);
    await file.writeAsString(content);
    return file;
  }

  test('UserSkillSource loads skills from filesystem', () async {
    await _writeSkill('code-review/SKILL.md', '''---
name: code-review
description: 审查代码
---

# 内容
''');
    await _writeSkill('commit-message/SKILL.md', '''---
name: commit-message
description: 生成提交信息
---

# 内容
''');

    final source = UserSkillSource(tempDir);
    final result = await source.load();

    expect(result.skills.length, 2);
    expect(result.skills.map((s) => s.name).toSet(),
        {'code-review', 'commit-message'});
    expect(result.skills.every((s) => s.source == SkillSourceKind.user), true);
  });

  test('skips SKILL.md without description', () async {
    await _writeSkill('no-desc/SKILL.md', '''---
name: no-desc
---

# 内容
''');

    final source = UserSkillSource(tempDir);
    final result = await source.load();

    expect(result.skills, isEmpty);
    expect(result.diagnostics, isNotEmpty);
  });

  test('SkillLoader dedupes by priority', () async {
    final highDir =
        await Directory.systemTemp.createTemp('skill-loader-high-');
    final lowDir = await Directory.systemTemp.createTemp('skill-loader-low-');
    try {
      await File('${highDir.path}/SKILL.md').writeAsString('''---
name: dup-skill
description: 高优先级
---
''');
      await File('${lowDir.path}/SKILL.md').writeAsString('''---
name: dup-skill
description: 低优先级
---
''');

      final high = _StubSource(SkillSourceKind.bundled, [
        Skill(
          name: 'dup-skill',
          description: '高优先级',
          filePath: '${highDir.path}/SKILL.md',
          baseDir: highDir.path,
          source: SkillSourceKind.bundled,
        ),
      ]);
      final low = _StubSource(SkillSourceKind.desktopSync, [
        Skill(
          name: 'dup-skill',
          description: '低优先级',
          filePath: '${lowDir.path}/SKILL.md',
          baseDir: lowDir.path,
          source: SkillSourceKind.desktopSync,
        ),
      ]);
      final loader = SkillLoader([high, low]);
      final result = await loader.load();

      expect(result.skills.length, 1);
      expect(result.skills.first.description, '高优先级');
      expect(
        result.diagnostics.any((d) => d.type == SkillDiagnosticType.collision),
        true,
      );
    } finally {
      await highDir.delete(recursive: true);
      await lowDir.delete(recursive: true);
    }
  });

  test('empty directory returns empty result', () async {
    final source = UserSkillSource(tempDir);
    final result = await source.load();
    expect(result.skills, isEmpty);
    expect(result.diagnostics, isEmpty);
  });
}

class _StubSource implements SkillSource {
  @override
  final SkillSourceKind kind;
  final List<Skill> skills;

  _StubSource(this.kind, this.skills);

  @override
  Future<LoadResult> load() async =>
      LoadResult(skills: skills, diagnostics: const []);
}
```

- [ ] **步骤 8：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_loader_test.dart`
预期：PASS

- [ ] **步骤 9：Commit**

```bash
cd mobile-app
git add lib/core/skills/skill_loader.dart lib/core/skills/sources/ test/skill_loader_test.dart
git commit -m "feat(skills): 实现 4 个 SkillSource 与去重加载器"
```

---

## 任务 6：实现 SkillRegistry（Riverpod provider）+ enabled 持久化

**文件：**
- 创建：`mobile-app/lib/core/skills/skill_registry.dart`
- 测试：`mobile-app/test/skill_registry_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/skill_registry_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';

void main() {
  final skillA = Skill(
    name: 'a',
    description: 'A',
    filePath: '/tmp/a/SKILL.md',
    baseDir: '/tmp/a',
    source: SkillSourceKind.user,
  );
  final skillB = Skill(
    name: 'b',
    description: 'B',
    filePath: '/tmp/b/SKILL.md',
    baseDir: '/tmp/b',
    source: SkillSourceKind.bundled,
  );

  test('initial state has all skills enabled', () {
    final state = SkillRegistryState(
      skills: [skillA, skillB],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    expect(state.enabledSkills.length, 2);
    expect(state.find('a')?.name, 'a');
    expect(state.find('missing'), isNull);
  });

  test('toggle moves names in/out of disabledNames', () {
    var state = SkillRegistryState(
      skills: [skillA, skillB],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    state = state.toggle('a');
    expect(state.disabledNames, {'a'});
    expect(state.enabledSkills.length, 1);
    expect(state.enabledSkills.first.name, 'b');
    state = state.toggle('a');
    expect(state.disabledNames, isEmpty);
    expect(state.enabledSkills.length, 2);
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/skill_registry_test.dart`
预期：FAIL，`SkillRegistryState` 不存在。

- [ ] **步骤 3：实现 SkillRegistry**

创建 `mobile-app/lib/core/skills/skill_registry.dart`：

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/bundled_skills.dart';
import 'skill_loader.dart';
import 'skill_types.dart';
import 'sources/bundled_skill_source.dart';
import 'sources/desktop_sync_skill_source.dart';
import 'sources/github_skill_source.dart';
import 'sources/user_skill_source.dart';

/// 技能注册表的不可变状态。
class SkillRegistryState {
  /// 所有已加载技能（含已禁用的）。
  final List<Skill> skills;

  /// 加载诊断信息。
  final List<SkillDiagnostic> diagnostics;

  /// 是否正在加载。
  final bool loading;

  /// 禁用的技能名集合（持久化到 SharedPreferences）。
  final Set<String> disabledNames;

  const SkillRegistryState({
    required this.skills,
    required this.diagnostics,
    required this.loading,
    required this.disabledNames,
  });

  static const empty = SkillRegistryState(
    skills: [],
    diagnostics: [],
    loading: false,
    disabledNames: {},
  );

  /// 仅 enabled 技能。
  List<Skill> get enabledSkills =>
      skills.where((s) => !disabledNames.contains(s.name)).toList();

  /// 按名查找技能（无论是否禁用）。
  Skill? find(String name) {
    for (final skill in skills) {
      if (skill.name == name) return skill;
    }
    return null;
  }

  /// 切换某技能的启用状态，返回新状态。
  SkillRegistryState toggle(String name) {
    final next = Set<String>.from(disabledNames);
    if (next.contains(name)) {
      next.remove(name);
    } else {
      next.add(name);
    }
    return SkillRegistryState(
      skills: skills,
      diagnostics: diagnostics,
      loading: loading,
      disabledNames: next,
    );
  }
}

/// 技能注册表的 Riverpod notifier。
class SkillRegistryNotifier extends StateNotifier<SkillRegistryState> {
  static const _disabledKey = 'skills_disabled_names';

  final Ref _ref;
  SkillLoader? _loader;
  SharedPreferences? _prefs;

  SkillRegistryNotifier(this._ref) : super(SkillRegistryState.empty) {
    refresh();
  }

  /// 重新扫描所有来源并刷新状态。
  Future<void> refresh() async {
    state = SkillRegistryState(
      skills: state.skills,
      diagnostics: state.diagnostics,
      loading: true,
      disabledNames: state.disabledNames,
    );
    try {
      _loader ??= await _buildLoader();
      _prefs ??= await SharedPreferences.getInstance();
      final result = await _loader!.load();
      final disabled = _loadDisabled();
      state = SkillRegistryState(
        skills: result.skills,
        diagnostics: result.diagnostics,
        loading: false,
        disabledNames: disabled,
      );
    } catch (error) {
      state = SkillRegistryState(
        skills: state.skills,
        diagnostics: [
          ...state.diagnostics,
          SkillDiagnostic(
            type: SkillDiagnosticType.error,
            message: '刷新技能列表失败：$error',
          ),
        ],
        loading: false,
        disabledNames: state.disabledNames,
      );
    }
  }

  /// 切换某技能的启用状态并持久化。
  Future<void> toggleEnabled(String name) async {
    _prefs ??= await SharedPreferences.getInstance();
    state = state.toggle(name);
    await _prefs!.setStringList(_disabledKey, state.disabledNames.toList());
  }

  /// 安装 GitHub 仓库技能。委托给 SkillInstaller。
  Future<void> installFromGithub(String repoUrl) async {
    _loader ??= await _buildLoader();
    final installer = SkillInstaller(loader: _loader!);
    await installer.installFromGithub(repoUrl);
    await refresh();
  }

  /// 卸载技能（仅支持 user/github 来源）。
  Future<void> uninstall(String name) async {
    final skill = state.find(name);
    if (skill == null) return;
    if (skill.source != SkillSourceKind.user &&
        skill.source != SkillSourceKind.github) {
      return;
    }
    final dir = Directory(skill.baseDir);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
    await refresh();
  }

  Future<SkillLoader> _buildLoader() async {
    final docs = await getApplicationDocumentsDirectory();
    final skillsRoot = Directory('${docs.path}/spacecode/skills');
    return SkillLoader([
      BundledSkillSource(bundledSkillAssetPaths),
      UserSkillSource(Directory('${skillsRoot.path}')),
      GithubSkillSource(Directory('${skillsRoot.path}/github')),
      DesktopSyncSkillSource(Directory('${skillsRoot.path}/desktop-sync')),
    ]);
  }

  Set<String> _loadDisabled() {
    final list = _prefs?.getStringList(_disabledKey) ?? const [];
    return list.toSet();
  }
}

/// 全局技能注册表 provider。
final skillRegistryProvider =
    StateNotifierProvider<SkillRegistryNotifier, SkillRegistryState>(
  (ref) => SkillRegistryNotifier(ref),
);
```

注意：`import '../config/bundled_skills.dart'` 与 `SkillInstaller` 引用将在后续任务创建。本任务先创建桩文件让代码编译通过。

- [ ] **步骤 4：创建桩文件让代码编译通过**

创建 `mobile-app/lib/core/config/bundled_skills.dart`：

```dart
/// 随 APK/IPA 打包的内置技能 asset 路径列表。
///
/// 与 pubspec.yaml 的 flutter.assets 声明保持一致。
const List<String> bundledSkillAssetPaths = [
  'assets/skills/code-review/SKILL.md',
  'assets/skills/commit-message/SKILL.md',
];
```

注意：此列表在任务 13 添加 assets/skills/ 后才真正有效；在此之前 `BundledSkillSource.load()` 会失败但记 diagnostic，不影响其他 source。

创建 `mobile-app/lib/core/skills/skill_installer.dart` 的最小桩：

```dart
import 'dart:io';

import 'skill_loader.dart';

/// 从 GitHub 安装技能的安装器。
///
/// 本桩在任务 8 完成；此处仅为编译通过。
class SkillInstaller {
  final SkillLoader loader;

  SkillInstaller({required this.loader});

  Future<void> installFromGithub(String repoUrl) async {
    throw UnimplementedError('installFromGithub 待任务 8 实现');
  }
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_registry_test.dart`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
cd mobile-app
git add lib/core/skills/skill_registry.dart lib/core/skills/skill_installer.dart lib/core/config/bundled_skills.dart test/skill_registry_test.dart
git commit -m "feat(skills): 实现 SkillRegistry Riverpod provider 与 enabled 持久化"
```

---

## 任务 7：实现 SkillPlugin + _ReadSkillTool

**文件：**
- 创建：`mobile-app/lib/core/agent/plugins/skill_plugin.dart`
- 测试：`mobile-app/test/skill_plugin_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/skill_plugin_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/skill_plugin.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';

void main() {
  final skillA = Skill(
    name: 'code-review',
    description: '审查代码',
    filePath: '/tmp/does-not-exist/SKILL.md',
    baseDir: '/tmp/does-not-exist',
    source: SkillSourceKind.user,
  );

  test('buildSystemPromptSuffix returns empty when no skills', () {
    final plugin = SkillPlugin(const SkillRegistryState.empty);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('buildSystemPromptSuffix formats skills as XML', () {
    final state = SkillRegistryState(
      skills: [skillA],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    final plugin = SkillPlugin(state);
    final suffix = plugin.buildSystemPromptSuffix();

    expect(suffix, contains('<available_skills>'));
    expect(suffix, contains('</available_skills>'));
    expect(suffix, contains('<name>code-review</name>'));
    expect(suffix, contains('<description>审查代码</description>'));
    expect(suffix, contains('<location>/tmp/does-not-exist/SKILL.md</location>'));
  });

  test('buildSystemPromptSuffix excludes disabled skills', () {
    final state = SkillRegistryState(
      skills: [skillA],
      diagnostics: const [],
      loading: false,
      disabledNames: const {'code-review'},
    );
    final plugin = SkillPlugin(state);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('buildSystemPromptSuffix excludes disableModelInvocation skills', () {
    final skill = Skill(
      name: 'hidden',
      description: '隐藏技能',
      filePath: '/tmp/x/SKILL.md',
      baseDir: '/tmp/x',
      source: SkillSourceKind.user,
      disableModelInvocation: true,
    );
    final state = SkillRegistryState(
      skills: [skill],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    final plugin = SkillPlugin(state);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('read_skill tool returns error for unknown skill', () async {
    final state = SkillRegistryState(
      skills: [skillA],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    final plugin = SkillPlugin(state);
    final tools = plugin.createTools();
    final readSkill = tools.firstWhere(
      (t) => t.definition.name == 'read_skill',
    );
    final result = await readSkill.execute(
      {'skill_name': 'missing'},
      AgentCancellationToken(),
    );
    expect(result.isError, true);
    expect(result.content, contains('not found'));
  });

  test('read_skill tool reads file content', () async {
    // 通过 FilesystemSkillSource 的实际文件读取需要文件系统；
    // 此处用一个虚拟 Skill（filePath 指向临时文件）验证读取逻辑。
    final tmpFile = await _createTempSkillFile('content-here');
    final skill = Skill(
      name: 'temp',
      description: 'temp',
      filePath: tmpFile.path,
      baseDir: tmpFile.parent.path,
      source: SkillSourceKind.user,
    );
    final state = SkillRegistryState(
      skills: [skill],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    final plugin = SkillPlugin(state);
    final tools = plugin.createTools();
    final readSkill = tools.firstWhere(
      (t) => t.definition.name == 'read_skill',
    );
    final result = await readSkill.execute(
      {'skill_name': 'temp'},
      AgentCancellationToken(),
    );
    expect(result.isError, false);
    expect(result.content, 'content-here');
    await tmpFile.delete();
  });
}

Future<File> _createTempSkillFile(String content) async {
  final dir = await Directory.systemTemp.createTemp('skill-plugin-test-');
  final file = File('${dir.path}/SKILL.md');
  await file.writeAsString(content);
  return file;
}
```

注意顶部需 import：
```dart
import 'dart:io';
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/skill_plugin_test.dart`
预期：FAIL，`SkillPlugin` 类不存在。

- [ ] **步骤 3：实现 SkillPlugin**

创建 `mobile-app/lib/core/agent/plugins/skill_plugin.dart`：

```dart
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;

import '../agent_plugin.dart';
import '../agent_types.dart';
import '../../skills/skill_registry.dart';
import '../../skills/skill_types.dart';

/// 把技能能力注入 AgentSession 的插件。
///
/// 职责：
/// - 在系统提示词末尾追加 <available_skills> XML 列出可用技能
/// - 注册 `read_skill` 工具，让模型按需加载 SKILL.md 全文
class SkillPlugin extends AgentPlugin {
  final SkillRegistryState registry;

  SkillPlugin(this.registry);

  @override
  List<AgentTool> createTools() => [_ReadSkillTool(registry)];

  @override
  String buildSystemPromptSuffix() {
    final visible = registry.enabledSkills
        .where((s) => !s.disableModelInvocation)
        .toList();
    if (visible.isEmpty) return '';
    return _formatSkillsXml(visible);
  }

  String _formatSkillsXml(List<Skill> skills) {
    final buffer = StringBuffer('\n<available_skills>\n');
    for (final skill in skills) {
      buffer.write('  <skill>\n');
      buffer.write('    <name>${_escapeXml(skill.name)}</name>\n');
      buffer.write(
          '    <description>${_escapeXml(skill.description)}</description>\n');
      buffer.write('    <location>${_escapeXml(skill.filePath)}</location>\n');
      buffer.write('  </skill>\n');
    }
    buffer.write('</available_skills>\n');
    buffer.write(
        '\nUse the read_skill tool to load a skill\'s full instructions '
        'when the task matches its description.\n');
    return buffer.toString();
  }

  String _escapeXml(String text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
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
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final name = arguments['skill_name'] as String?;
    if (name == null || name.isEmpty) {
      return const AgentToolResult(
        content: 'skill_name is required',
        isError: true,
      );
    }
    final skill = registry.find(name);
    if (skill == null) {
      return AgentToolResult(
        content: 'Skill "$name" not found',
        isError: true,
      );
    }
    try {
      final content = skill.source == SkillSourceKind.bundled
          ? await rootBundle.loadString(skill.filePath)
          : await File(skill.filePath).readAsString();
      return AgentToolResult(content: content);
    } catch (error) {
      return AgentToolResult(
        content: 'Failed to read skill: $error',
        isError: true,
      );
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_plugin_test.dart`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd mobile-app
git add lib/core/agent/plugins/skill_plugin.dart test/skill_plugin_test.dart
git commit -m "feat(skills): 实现 SkillPlugin 与 read_skill 工具"
```

---

## 任务 8：实现 SkillInstaller

**文件：**
- 修改：`mobile-app/lib/core/skills/skill_installer.dart`
- 测试：`mobile-app/test/skill_installer_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/skill_installer_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_installer.dart';

void main() {
  group('parseGithubUrl', () {
    test('parses full https URL', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses github.com/user/repo', () {
      final parsed = SkillInstaller.parseGithubUrl('github.com/user/repo');
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses user/repo shorthand', () {
      final parsed = SkillInstaller.parseGithubUrl('user/repo');
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('parses URL with .git suffix', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo.git',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });

    test('returns null for invalid URL', () {
      expect(SkillInstaller.parseGithubUrl('not-a-url'), isNull);
      expect(SkillInstaller.parseGithubUrl('https://example.com/foo'), isNull);
      expect(SkillInstaller.parseGithubUrl('user'), isNull);
    });

    test('parses URL with trailing path', () {
      final parsed = SkillInstaller.parseGithubUrl(
        'https://github.com/user/repo/tree/main',
      );
      expect(parsed?.owner, 'user');
      expect(parsed?.name, 'repo');
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/skill_installer_test.dart`
预期：FAIL，`parseGithubUrl` 未实现。

- [ ] **步骤 3：实现 SkillInstaller**

完全替换 `mobile-app/lib/core/skills/skill_installer.dart`：

```dart
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../config/mobile_config.dart';
import '../github/github_service.dart';
import 'skill_loader.dart';

/// 从 GitHub 仓库安装技能的安装器。
class SkillInstaller {
  /// 解析后的 GitHub 仓库坐标。
  final String owner;
  final String name;

  const SkillInstaller._({required this.owner, required this.name});

  /// 解析 GitHub URL，失败返回 null。
  ///
  /// 支持以下格式：
  /// - `https://github.com/user/repo`
  /// - `https://github.com/user/repo.git`
  /// - `https://github.com/user/repo/tree/main`
  /// - `github.com/user/repo`
  /// - `user/repo`
  static _ParsedRepo? parseGithubUrl(String input) {
    var trimmed = input.trim();
    if (trimmed.isEmpty) return null;
    if (trimmed.startsWith('https://')) {
      trimmed = trimmed.substring('https://'.length);
    } else if (trimmed.startsWith('http://')) {
      trimmed = trimmed.substring('http://'.length);
    }
    if (trimmed.startsWith('github.com/')) {
      trimmed = trimmed.substring('github.com/'.length);
    } else if (trimmed.contains('/') && !trimmed.contains('.')) {
      // user/repo 简写
    } else if (!trimmed.startsWith('@')) {
      return null;
    }
    final segments = trimmed.split('/').where((s) => s.isNotEmpty).toList();
    if (segments.length < 2) return null;
    final owner = segments[0];
    var name = segments[1];
    if (name.endsWith('.git')) {
      name = name.substring(0, name.length - 4);
    }
    if (owner.isEmpty || name.isEmpty) return null;
    return _ParsedRepo(owner: owner, name: name);
  }

  final SkillLoader? loader;
  final http.Client? client;

  SkillInstaller({this.loader, this.client});

  /// 安装 GitHub 仓库到 `~/.spacecode/skills/github/<owner>-<name>/`。
  ///
  /// 使用 [GithubService.cloneRepository] 拉取仓库 zipball。
  /// 需要用户已完成 GitHub 认证（[MobileConfig.githubToken] 非空）。
  Future<String> installFromGithub(
    String repoUrl, {
    required String githubToken,
    String branch = 'main',
  }) async {
    final parsed = parseGithubUrl(repoUrl);
    if (parsed == null) {
      throw StateError('无法解析 GitHub URL：$repoUrl');
    }
    if (githubToken.trim().isEmpty) {
      throw StateError('请先在设置中完成 GitHub 认证');
    }
    final docs = await getApplicationDocumentsDirectory();
    final targetDir = Directory(
      '${docs.path}/spacecode/skills/github/${parsed.owner}-${parsed.name}',
    );
    if (await targetDir.exists()) {
      await targetDir.delete(recursive: true);
    }
    final github = GithubService(
      token: githubToken,
      client: client,
    );
    final cancellation = AgentCancellationToken();
    try {
      await github.cloneRepository(
        repository: '${parsed.owner}/${parsed.name}',
        branch: branch,
        targetDirectory: targetDir.path,
        abortTrigger: cancellation.whenCancelled,
        isCancelled: () => cancellation.isCancelled,
      );
    } finally {
      github.dispose();
    }
    return targetDir.path;
  }

  /// 删除已安装的技能目录。
  Future<void> uninstall(String directoryPath) async {
    final dir = Directory(directoryPath);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  }
}

class _ParsedRepo {
  final String owner;
  final String name;

  const _ParsedRepo({required this.owner, required this.name});
}
```

注意：需要补 import：
```dart
import 'package:http/http.dart' as http;
import 'agent_types.dart';
```

`AgentCancellationToken` 来自 `agent_types.dart`。`GithubService` 已有，但需要 import。

补充完整 import 块：
```dart
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../agent/agent_types.dart';
import '../config/mobile_config.dart';
import '../github/github_service.dart';
import 'skill_loader.dart';
```

注意 `mobile_config.dart` 此处实际未使用，可删除该 import。

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/skill_installer_test.dart`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd mobile-app
git add lib/core/skills/skill_installer.dart test/skill_installer_test.dart
git commit -m "feat(skills): 实现 SkillInstaller 与 GitHub URL 解析"
```

---

## 任务 9：重构 LocalAgentService 接入 AgentSession + Plugins

**文件：**
- 修改：`mobile-app/lib/core/agent/local_agent_service.dart`
- 修改：`mobile-app/lib/features/chat/chat_controller.dart`（注入 SkillPlugin）
- 修改：`mobile-app/test/local_agent_service_test.dart`（适配新签名）

- [ ] **步骤 1：编写/调整 LocalAgentService 测试**

修改 `mobile-app/test/local_agent_service_test.dart`，在已有测试基础上增加一个"技能注入系统提示词"的测试：

```dart
  test('injects skill registry into system prompt when provided', () async {
    late Map<String, dynamic> requestBody;
    final client = MockClient.streaming((request, bodyStream) async {
      final bodyBytes = await bodyStream.toBytes();
      requestBody = jsonDecode(utf8.decode(bodyBytes)) as Map<String, dynamic>;
      return http.StreamedResponse(
        Stream.value(utf8.encode('data: [DONE]\n\n')),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final service = LocalAgentService(client: client);
    final skillState = SkillRegistryState(
      skills: [
        Skill(
          name: 'code-review',
          description: '审查代码',
          filePath: '/tmp/x/SKILL.md',
          baseDir: '/tmp/x',
          source: SkillSourceKind.user,
        ),
      ],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );

    await service.complete(
      sessionId: 's',
      config: const MobileConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      prompt: 'hi',
      cancellationToken: AgentCancellationToken(),
      onEvent: (_) {},
      skillRegistry: skillState,
    );

    final messages = requestBody['messages'] as List;
    final systemContent = messages.first['content'] as String;
    expect(systemContent, contains('<available_skills>'));
    expect(systemContent, contains('code-review'));
  });
```

确保顶部 import 包含：
```dart
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/local_agent_service_test.dart`
预期：FAIL，`skillRegistry` 参数未定义。

- [ ] **步骤 3：重构 LocalAgentService**

完全替换 `mobile-app/lib/core/agent/local_agent_service.dart`：

```dart
import 'dart:async';

import 'package:http/http.dart' as http;

import '../config/mobile_config.dart';
import '../skills/skill_registry.dart';
import '../workspace/workspace_target.dart';
import 'agent_loop.dart';
import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'openai_compatible_model.dart';
import 'plugins/skill_plugin.dart';
import 'plugins/workspace_plugin.dart';

class LocalAgentService {
  final http.Client _client;

  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  /// 完成一次 Agent 调用，保留原签名兼容 chat_controller。
  ///
  /// 内部构造 [AgentSession] + Plugins，委托给 [OpenAiCompatibleModel]。
  /// 文本 delta 通过 [onEvent] 实时推送（`AgentEventType.assistantDelta`），
  /// 完整文本作为返回值返回。
  Future<String> complete({
    required String sessionId,
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    required AgentCancellationToken cancellationToken,
    required void Function(AgentEvent) onEvent,
    SkillRegistryState? skillRegistry,
  }) async {
    if (config.apiKey.trim().isEmpty) {
      throw StateError('请先在设置中配置 API Key');
    }
    if (config.model.trim().isEmpty) {
      throw StateError('请先在设置中配置模型');
    }

    final model = OpenAiCompatibleModel(client: _client);
    final plugins = <AgentPlugin>[
      if (workspace?.localPath != null) WorkspacePlugin(workspace!.localPath!),
      if (skillRegistry != null && skillRegistry.skills.isNotEmpty)
        SkillPlugin(skillRegistry),
    ];

    final session = AgentSession(
      model: model,
      systemPrompt: _buildBaseSystemPrompt(workspace?.promptContext),
      plugins: plugins,
      initialMessages: history,
      maxTurns: 8,
    );

    final result = await session.run(
      prompt,
      config: AgentModelConfig(
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      ),
      cancellationToken: cancellationToken,
      onEvent: onEvent,
    );
    return result.text;
  }

  /// 兼容 chat_controller 调用：实际取消由 cancellationToken 控制。
  void abort(String sessionId) {
    // no-op
  }

  /// 重置 session 状态（noop，cancellationToken 由调用方管理）。
  void resetSession(String sessionId) {
    // no-op
  }

  /// 从 API 获取可用模型列表（OpenAI 兼容 /models 接口）。
  Future<List<String>> listModels({
    required String baseUrl,
    required String apiKey,
  }) async {
    if (apiKey.trim().isEmpty) throw StateError('请先配置 API Key');
    if (baseUrl.trim().isEmpty) throw StateError('请先配置 Base URL');

    final base = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint = base.endsWith('/models') ? base : '$base/models';
    final request = http.Request('GET', Uri.parse(endpoint))
      ..headers.addAll({
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      });
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 30));
    final body = await response.stream.bytesToString();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String? message;
      try {
        final decoded = jsonDecode(body);
        if (decoded is Map<String, dynamic>) {
          final err = decoded['error'];
          message = err is Map
              ? err['message']?.toString()
              : decoded['message']?.toString();
        }
      } catch (_) {
        message = body;
      }
      throw StateError(message ?? '获取模型列表失败（${response.statusCode}）');
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map<String, dynamic>) return const [];
    final data = decoded['data'];
    if (data is! List) return const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((m) => m['id'] as String?)
        .where((id) => id != null && id.isNotEmpty)
        .cast<String>()
        .toList();
  }

  String _buildBaseSystemPrompt(String? context) {
    const base = 'You are SpaceCode Mobile Agent, a professional coding assistant. '
        'Help the user complete coding tasks efficiently and concisely.\n'
        'IMPORTANT: You are SpaceCode Mobile Agent only. '
        'Never mention other AI products or brands (such as Pi, Claude, ChatGPT, etc.) in your responses. '
        'Never claim to be inspired by any other AI product. '
        'If asked about your identity, respond that you are SpaceCode Mobile Agent.';
    if (context == null) return base;
    return '$base\n\nWork within this workspace context:\n$context\n'
        'Use file tools to inspect and modify files, then summarize the changes.';
  }

  void dispose() => _client.close();
}
```

注意：`listModels` 用到 `jsonDecode`，需在顶部 import `dart:convert`。补充完整 import：

```dart
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
...
```

- [ ] **步骤 4：在 ChatNotifier 注入 SkillRegistry**

修改 `mobile-app/lib/features/chat/chat_controller.dart` 的 `_runLocalAgent` 方法。

找到调用 `_localAgent.complete(...)` 的地方（第 325-333 行），在 `history:` 之后新增 `skillRegistry:` 参数：

```dart
      var answer = await _localAgent.complete(
        sessionId: sessionId,
        config: config,
        prompt: content,
        workspace: workspace,
        history: _buildLocalAgentHistory(sessionId, content),
        cancellationToken: token,
        onEvent: (event) => _handleLocalAgentEvent(sessionId, event),
        skillRegistry: _ref.read(skillRegistryProvider),
      );
```

在文件顶部 import 区新增：
```dart
import '../../core/skills/skill_registry.dart';
```

- [ ] **步骤 5：在 ChatNotifier 处理 /skill:name 命令解析**

修改 `mobile-app/lib/features/chat/chat_controller.dart` 的 `sendMessage` 方法。

在 `sendMessage(String content)` 方法体开头（`final sessionId = ...` 之前）新增命令解析：

```dart
  void sendMessage(String content) {
    final processed = _processSkillCommand(content);
    if (processed == null) return;
    final actualContent = processed;

    final sessionId = state.currentSessionId ?? _uuid.v4();
    // ... 原有逻辑用 actualContent 替换 content
  }

  /// 解析 `/skill:name [task]` 命令为完整 prompt。
  ///
  /// 返回 null 表示输入无效（应忽略）；
  /// 返回原字符串表示非技能命令；
  /// 返回拼装后的字符串表示技能命令已展开。
  String? _processSkillCommand(String content) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return null;
    if (!trimmed.startsWith('/skill:')) return trimmed;
    final rest = trimmed.substring('/skill:'.length);
    final spaceIndex = rest.indexOf(' ');
    final skillName =
        spaceIndex >= 0 ? rest.substring(0, spaceIndex).trim() : rest.trim();
    final taskText =
        spaceIndex >= 0 ? rest.substring(spaceIndex + 1).trim() : '';
    if (skillName.isEmpty) return null;
    if (taskText.isEmpty) {
      return "Load skill '$skillName' and follow its instructions.";
    }
    return "Load skill '$skillName' and follow its instructions for the following task:\n\n$taskText";
  }
```

注意：原 `sendMessage` 方法体后续用到的 `content` 变量需改为 `actualContent`。

- [ ] **步骤 6：运行所有测试验证通过**

运行：`cd mobile-app && flutter test`
预期：PASS（所有现有测试 + 新增技能注入测试）

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 7：Commit**

```bash
cd mobile-app
git add lib/core/agent/local_agent_service.dart lib/features/chat/chat_controller.dart test/local_agent_service_test.dart
git commit -m "refactor(agent): LocalAgentService 接入 AgentSession + SkillPlugin，删除硬编码工具"
```

---

## 任务 10：实现 i18n 轻量方案

**文件：**
- 创建：`mobile-app/lib/core/i18n/strings.dart`
- 创建：`mobile-app/lib/core/i18n/locales/zh.json`
- 创建：`mobile-app/lib/core/i18n/locales/en.json`
- 创建：`mobile-app/test/i18n_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/i18n_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';

void main() {
  test('falls back to key when not initialized', () {
    expect(I18n.t('nonexistent.key'), 'nonexistent.key');
  });

  test('returns zh strings after init with zh locale', () {
    I18n.initForTest(locale: AppLocale.zh, strings: {
      'skills.title': '技能',
    });
    expect(I18n.t('skills.title'), '技能');
  });

  test('returns en strings after init with en locale', () {
    I18n.initForTest(locale: AppLocale.en, strings: {
      'skills.title': 'Skills',
    });
    expect(I18n.t('skills.title'), 'Skills');
  });

  test('supports {placeholder} interpolation', () {
    I18n.initForTest(locale: AppLocale.zh, strings: {
      'skills.installed': '已安装 {name}',
    });
    expect(I18n.t('skills.installed', {'name': 'code-review'}), '已安装 code-review');
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/i18n_test.dart`
预期：FAIL，`I18n` 类不存在。

- [ ] **步骤 3：实现 I18n**

创建 `mobile-app/lib/core/i18n/strings.dart`：

```dart
/// 轻量国际化方案。
///
/// 避免引入 flutter_localizations，自建 key-value 字符串表。
/// 语言选择由 MobileConfig.appLocale 控制（任务 11）。
class I18n {
  static AppLocale _locale = AppLocale.zh;
  static Map<String, String> _strings = const {};

  static AppLocale get locale => _locale;

  /// 初始化：加载指定 locale 的字符串表。
  static void init(AppLocale locale, Map<String, String> strings) {
    _locale = locale;
    _strings = strings;
  }

  /// 测试专用：直接注入字符串表。
  static void initForTest({
    required AppLocale locale,
    required Map<String, String> strings,
  }) {
    init(locale, strings);
  }

  /// 翻译 key，支持 {placeholder} 插值。
  ///
  /// 未找到 key 时返回 key 本身（便于发现遗漏）。
  static String t(String key, [Map<String, String>? args]) {
    var value = _strings[key];
    if (value == null) return key;
    if (args == null || args.isEmpty) return value;
    for (final entry in args.entries) {
      value = value.replaceAll('{${entry.key}}', entry.value);
    }
    return value;
  }
}

enum AppLocale { zh, en }
```

- [ ] **步骤 4：创建 zh.json 与 en.json**

创建 `mobile-app/lib/core/i18n/locales/zh.json`：

```json
{
  "skills.title": "技能",
  "skills.empty": "暂无技能，点击右上角安装或从桌面端同步",
  "skills.install": "安装",
  "skills.installDialogTitle": "从 GitHub 安装技能",
  "skills.installDialogHint": "支持 github.com/user/repo 或 user/repo 格式",
  "skills.installDialogWarning": "第三方技能可能包含任意指令，安装前请审查内容。",
  "skills.installSuccess": "安装成功",
  "skills.installFailed": "安装失败：{error}",
  "skills.uninstall": "卸载",
  "skills.uninstallConfirm": "确定卸载此技能？",
  "skills.edit": "编辑",
  "skills.delete": "删除",
  "skills.enabled": "启用",
  "skills.disabled": "禁用",
  "skills.sourceBundled": "内置",
  "skills.sourceUser": "本地",
  "skills.sourceGithub": "GitHub",
  "skills.sourceDesktop": "同步",
  "skills.commandHint": "输入 / 查看可用命令",
  "skills.commandManage": "管理技能",
  "settings.language": "语言",
  "settings.languageZh": "中文",
  "settings.languageEn": "English"
}
```

创建 `mobile-app/lib/core/i18n/locales/en.json`：

```json
{
  "skills.title": "Skills",
  "skills.empty": "No skills yet. Tap install in the top right or sync from desktop.",
  "skills.install": "Install",
  "skills.installDialogTitle": "Install skill from GitHub",
  "skills.installDialogHint": "Supports github.com/user/repo or user/repo",
  "skills.installDialogWarning": "Third-party skills may contain arbitrary instructions. Review before installing.",
  "skills.installSuccess": "Installed",
  "skills.installFailed": "Install failed: {error}",
  "skills.uninstall": "Uninstall",
  "skills.uninstallConfirm": "Uninstall this skill?",
  "skills.edit": "Edit",
  "skills.delete": "Delete",
  "skills.enabled": "Enabled",
  "skills.disabled": "Disabled",
  "skills.sourceBundled": "Bundled",
  "skills.sourceUser": "Local",
  "skills.sourceGithub": "GitHub",
  "skills.sourceDesktop": "Synced",
  "skills.commandHint": "Type / for commands",
  "skills.commandManage": "Manage skills",
  "settings.language": "Language",
  "settings.languageZh": "中文",
  "settings.languageEn": "English"
}
```

注意：JSON 文件需在 `pubspec.yaml` 的 `flutter.assets` 中声明（任务 13）。

- [ ] **步骤 5：运行测试验证通过**

运行：`cd mobile-app && flutter test test/i18n_test.dart`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
cd mobile-app
git add lib/core/i18n/ test/i18n_test.dart
git commit -m "feat(i18n): 实现轻量国际化方案与 zh/en 字符串表"
```

---

## 任务 11：MobileConfig 新增 appLocale 字段

**文件：**
- 修改：`mobile-app/lib/core/config/mobile_config.dart`

- [ ] **步骤 1：扩展 MobileConfig**

修改 `mobile-app/lib/core/config/mobile_config.dart`。

在 `MobileConfig` 类的字段区新增 `appLocale`（在 `githubLogin` 之后）：

```dart
class MobileConfig {
  final String apiKey;
  final String baseUrl;
  final String model;
  final String githubToken;
  final String githubLogin;
  final String appLocale;  // 'zh' | 'en'，默认 'zh'

  const MobileConfig({
    this.apiKey = '',
    this.baseUrl = 'https://api.openai.com/v1',
    this.model = 'gpt-4o-mini',
    this.githubToken = '',
    this.githubLogin = '',
    this.appLocale = 'zh',
  });

  MobileConfig copyWith({
    String? apiKey,
    String? baseUrl,
    String? model,
    String? githubToken,
    String? githubLogin,
    String? appLocale,
  }) =>
      MobileConfig(
        apiKey: apiKey ?? this.apiKey,
        baseUrl: baseUrl ?? this.baseUrl,
        model: model ?? this.model,
        githubToken: githubToken ?? this.githubToken,
        githubLogin: githubLogin ?? this.githubLogin,
        appLocale: appLocale ?? this.appLocale,
      );
}
```

在 `MobileConfigNotifier` 类中新增 `_appLocale` 常量与读写逻辑：

```dart
  static const _appLocale = 'mobile_app_locale';
```

修改 `load()` 方法，在 `MobileConfig(...)` 构造中加入 `appLocale`：

```dart
    state = MobileConfig(
      apiKey: prefs.getString(_apiKey) ?? '',
      baseUrl: prefs.getString(_baseUrl) ?? 'https://api.openai.com/v1',
      model: prefs.getString(_model) ?? 'gpt-4o-mini',
      githubToken: prefs.getString(_githubToken) ?? '',
      githubLogin: prefs.getString(_githubLogin) ?? '',
      appLocale: prefs.getString(_appLocale) ?? 'zh',
    );
```

在类末尾新增方法：

```dart
  Future<void> saveLocale(String locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_appLocale, locale);
    state = state.copyWith(appLocale: locale);
  }
```

- [ ] **步骤 2：运行测试验证不破坏现有功能**

运行：`cd mobile-app && flutter test`
预期：PASS

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
cd mobile-app
git add lib/core/config/mobile_config.dart
git commit -m "feat(config): MobileConfig 新增 appLocale 字段支持语言切换"
```

---

## 任务 12：实现 SkillsScreen + SkillCard + SkillDetailPage + SkillInstallDialog

**文件：**
- 创建：`mobile-app/lib/features/skills/skills_screen.dart`
- 创建：`mobile-app/lib/features/skills/skill_card.dart`
- 创建：`mobile-app/lib/features/skills/skill_detail_page.dart`
- 创建：`mobile-app/lib/features/skills/skill_install_dialog.dart`
- 修改：`mobile-app/lib/routing/router.dart`

- [ ] **步骤 1：创建 SkillCard**

创建 `mobile-app/lib/features/skills/skill_card.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

class SkillCard extends ConsumerWidget {
  final Skill skill;
  final bool enabled;
  final VoidCallback? onTap;

  const SkillCard({
    super.key,
    required this.skill,
    required this.enabled,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        leading: _sourceIcon(skill.source, theme),
        title: Text(
          skill.name,
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
        subtitle: Text(
          skill.description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
        ),
        trailing: Switch(
          value: enabled,
          onChanged: (_) =>
              ref.read(skillRegistryProvider.notifier).toggleEnabled(skill.name),
        ),
        onTap: onTap,
      ),
    );
  }

  IconData _sourceIcon(SkillSourceKind source, ThemeData theme) {
    switch (source) {
      case SkillSourceKind.bundled:
        return Icons.shield_outlined;
      case SkillSourceKind.user:
        return Icons.person_outline;
      case SkillSourceKind.github:
        return Icons.cloud_download_outlined;
      case SkillSourceKind.desktopSync:
        return Icons.sync_outlined;
    }
  }
}
```

- [ ] **步骤 2：创建 SkillInstallDialog**

创建 `mobile-app/lib/features/skills/skill_install_dialog.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';

class SkillInstallDialog extends ConsumerStatefulWidget {
  const SkillInstallDialog({super.key});

  @override
  ConsumerState<SkillInstallDialog> createState() => _SkillInstallDialogState();
}

class _SkillInstallDialogState extends ConsumerState<SkillInstallDialog> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final url = _controller.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final config = ref.read(mobileConfigProvider);
      await ref
          .read(skillRegistryProvider.notifier)
          .installFromGithub(url);
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString().replaceFirst('Bad state: ', '');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: Text(I18n.t('skills.installDialogTitle')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            I18n.t('skills.installDialogHint'),
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _controller,
            autofocus: true,
            decoration: InputDecoration(
              hintText: 'anthropics/skills',
              border: const OutlineInputBorder(),
              errorText: _error,
            ),
            onSubmitted: (_) => _loading ? null : _submit(),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(Icons.warning_amber_outlined,
                  size: 16, color: theme.colorScheme.error),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  I18n.t('skills.installDialogWarning'),
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _loading
              ? null
              : () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
        ),
        FilledButton(
          onPressed: _loading ? null : _submit,
          child: _loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(I18n.t('skills.install')),
        ),
      ],
    );
  }
}
```

注意：需要 import `mobileConfigProvider`：
```dart
import '../../core/config/mobile_config.dart';
```

- [ ] **步骤 3：创建 SkillDetailPage**

创建 `mobile-app/lib/features/skills/skill_detail_page.dart`：

```dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

class SkillDetailPage extends ConsumerWidget {
  final String skillName;

  const SkillDetailPage({super.key, required this.skillName});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(skillRegistryProvider);
    final skill = state.find(skillName);
    if (skill == null) {
      return Scaffold(
        appBar: AppBar(title: Text(skillName)),
        body: const Center(child: Text('Skill not found')),
      );
    }
    return FutureBuilder<String>(
      future: _loadContent(skill),
      builder: (context, snapshot) {
        return Scaffold(
          appBar: AppBar(
            title: Text(skill.name),
            actions: [
              if (skill.source == SkillSourceKind.user ||
                  skill.source == SkillSourceKind.github)
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: I18n.t('skills.delete'),
                  onPressed: () => _confirmDelete(context, ref, skill),
                ),
            ],
          ),
          body: snapshot.hasData
              ? Markdown(data: snapshot.data!)
              : const Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Future<String> _loadContent(Skill skill) async {
    if (skill.source == SkillSourceKind.bundled) {
      return await rootBundle.loadString(skill.filePath);
    }
    return await File(skill.filePath).readAsString();
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    Skill skill,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(I18n.t('skills.uninstall')),
        content: Text(I18n.t('skills.uninstallConfirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(I18n.t('skills.uninstall')),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await ref.read(skillRegistryProvider.notifier).uninstall(skill.name);
      if (context.mounted) Navigator.of(context).pop();
    }
  }
}
```

注意 import：
```dart
import 'package:flutter/services.dart' show rootBundle;
```

- [ ] **步骤 4：创建 SkillsScreen**

创建 `mobile-app/lib/features/skills/skills_screen.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import 'skill_card.dart';
import 'skill_install_dialog.dart';

class SkillsScreen extends ConsumerWidget {
  const SkillsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(skillRegistryProvider);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(I18n.t('skills.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.download_outlined),
            tooltip: I18n.t('skills.install'),
            onPressed: () => showDialog(
              context: context,
              builder: (_) => const SkillInstallDialog(),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.read(skillRegistryProvider.notifier).refresh(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(skillRegistryProvider.notifier).refresh(),
        child: state.loading && state.skills.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : state.skills.isEmpty
                ? ListView(
                    children: [
                      const SizedBox(height: 120),
                      Center(
                        child: Text(
                          I18n.t('skills.empty'),
                          style: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.5),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    itemCount: state.skills.length,
                    itemBuilder: (context, index) {
                      final skill = state.skills[index];
                      final enabled =
                          !state.disabledNames.contains(skill.name);
                      return SkillCard(
                        skill: skill,
                        enabled: enabled,
                        onTap: () => context.push(
                          '/skills/${skill.name}',
                          extra: skill.name,
                        ),
                      );
                    },
                  ),
      ),
    );
  }
}
```

- [ ] **步骤 5：在路由中注册 /skills**

修改 `mobile-app/lib/routing/router.dart`：

```dart
import 'package:go_router/go_router.dart';
import '../features/chat/chat_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/skills/skill_detail_page.dart';
import '../features/skills/skills_screen.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const ChatScreen(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsScreen(),
    ),
    GoRoute(
      path: '/skills',
      builder: (context, state) => const SkillsScreen(),
    ),
    GoRoute(
      path: '/skills/:name',
      builder: (context, state) =>
          SkillDetailPage(skillName: state.pathParameters['name']!),
    ),
  ],
);
```

- [ ] **步骤 6：运行类型检查验证编译通过**

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 7：Commit**

```bash
cd mobile-app
git add lib/features/skills/ lib/routing/router.dart
git commit -m "feat(skills): 实现技能管理页与详情页 UI"
```

---

## 任务 13：实现 SkillCommandMenu + 改造 chat_input

**文件：**
- 创建：`mobile-app/lib/features/chat/widgets/skill_command_menu.dart`
- 修改：`mobile-app/lib/features/chat/widgets/chat_input.dart`

- [ ] **步骤 1：创建 SkillCommandMenu**

创建 `mobile-app/lib/features/chat/widgets/skill_command_menu.dart`：

```dart
import 'package:flutter/material.dart';

/// 斜杠命令菜单数据项。
class CommandMenuItem {
  final String command;
  final String description;

  const CommandMenuItem({required this.command, required this.description});
}

/// 聊天输入框上方的斜杠命令浮层。
class SkillCommandMenu extends StatelessWidget {
  final List<CommandMenuItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  const SkillCommandMenu({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      elevation: 4,
      borderRadius: BorderRadius.circular(8),
      color: theme.colorScheme.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 240),
        child: ListView.builder(
          shrinkWrap: true,
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            final isSelected = index == selectedIndex;
            return InkWell(
              onTap: () => onSelected(index),
              child: Container(
                color: isSelected
                    ? theme.colorScheme.primary.withValues(alpha: 0.1)
                    : null,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.command,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      item.description,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface
                            .withValues(alpha: 0.6),
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
```

- [ ] **步骤 2：改造 ChatInput 支持斜杠命令**

修改 `mobile-app/lib/features/chat/widgets/chat_input.dart`。

在 `_ChatInputState` 类中新增字段（在 `final _focusNode = FocusNode();` 之后）：

```dart
  OverlayEntry? _commandMenuOverlay;
  int _commandSelectedIndex = 0;
  List<CommandMenuItem> _commandItems = const [];
```

新增 import：
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/skills/skill_registry.dart';
import 'skill_command_menu.dart';
```

在 `dispose` 方法中新增：
```dart
    _hideCommandMenu();
```

在 `initState` 中添加 `_controller.addListener(_onInputChanged);`：

```dart
  @override
  void initState() {
    super.initState();
    _controller.addListener(_onInputChanged);
  }
```

新增方法：

```dart
  void _onInputChanged() {
    final text = _controller.text;
    if (text.startsWith('/') && !text.contains(' ')) {
      _showCommandMenu(text);
    } else {
      _hideCommandMenu();
    }
  }

  void _showCommandMenu(String prefix) {
    final registry = ref.read(skillRegistryProvider);
    final allItems = <CommandMenuItem>[
      CommandMenuItem(
        command: '/new',
        description: '新建会话',
      ),
      CommandMenuItem(
        command: '/settings',
        description: '打开设置',
      ),
      CommandMenuItem(
        command: '/skills',
        description: '管理技能',
      ),
      ...registry.skills.map((s) => CommandMenuItem(
            command: '/skill:${s.name}',
            description: s.description,
          )),
    ];
    final filtered = prefix == '/'
        ? allItems
        : allItems
            .where((item) => item.command.startsWith(prefix))
            .toList();
    if (filtered.isEmpty) {
      _hideCommandMenu();
      return;
    }
    setState(() {
      _commandItems = filtered;
      _commandSelectedIndex = 0;
    });
    if (_commandMenuOverlay == null) {
      _commandMenuOverlay = OverlayEntry(
        builder: (context) => _buildPositionedMenu(),
      );
      Overlay.of(context).insert(_commandMenuOverlay!);
    } else {
      _commandMenuOverlay!.markNeedsBuild();
    }
  }

  Widget _buildPositionedMenu() {
    final renderBox = context.findRenderObject() as RenderBox?;
    final size = renderBox?.size ?? Size.zero;
    return Positioned(
      bottom: size.height + 8,
      left: 12,
      right: 12,
      child: Material(
        color: Colors.transparent,
        child: SkillCommandMenu(
          items: _commandItems,
          selectedIndex: _commandSelectedIndex,
          onSelected: _selectCommand,
        ),
      ),
    );
  }

  void _selectCommand(int index) {
    final item = _commandItems[index];
    _controller.text = '${item.command} ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    _hideCommandMenu();
    _focusNode.requestFocus();
  }

  void _hideCommandMenu() {
    _commandMenuOverlay?.remove();
    _commandMenuOverlay = null;
  }

  bool _handleKeyEvent(FocusKeyEvent event) {
    if (_commandMenuOverlay == null) return false;
    if (event is! KeyDownEvent) return false;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown) {
      setState(() {
        _commandSelectedIndex =
            (_commandSelectedIndex + 1) % _commandItems.length;
      });
      _commandMenuOverlay?.markNeedsBuild();
      return true;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      setState(() {
        _commandSelectedIndex = (_commandSelectedIndex - 1) %
            _commandItems.length;
      });
      _commandMenuOverlay?.markNeedsBuild();
      return true;
    }
    if (key == LogicalKeyboardKey.escape) {
      _hideCommandMenu();
      return true;
    }
    return false;
  }
```

在 `TextField` 的构建中添加 `onSubmitted` 与键盘事件处理。找到 `TextField(` 那一段，加入 `focusNode: _focusNode`（已有），新增 `keyboardEventHandler`：

由于 Flutter 的 TextField 不直接支持 raw key events，最简单的方式是用 `Focus` widget 包裹 `TextField`：

替换 `Container(child: TextField(...))` 区域为：

```dart
                Expanded(
                  child: Container(
                    constraints: const BoxConstraints(maxHeight: 120),
                    child: Focus(
                      onKeyEvent: (node, event) {
                        if (_handleKeyEvent(event)) {
                          return KeyEventResult.handled;
                        }
                        return KeyEventResult.ignored;
                      },
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        maxLines: null,
                        textInputAction: TextInputAction.newline,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 15,
                        ),
                        decoration: InputDecoration(
                          hintText: '输入消息...',
                          hintStyle: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.4),
                          ),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                        onSubmitted: (_) {
                          if (_commandMenuOverlay != null) {
                            _selectCommand(_commandSelectedIndex);
                          } else {
                            _send();
                          }
                        },
                      ),
                    ),
                  ),
                ),
```

注意：保留原有的发送按钮与图标按钮逻辑不变。

- [ ] **步骤 3：运行类型检查验证编译通过**

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 4：Commit**

```bash
cd mobile-app
git add lib/features/chat/widgets/skill_command_menu.dart lib/features/chat/widgets/chat_input.dart
git commit -m "feat(chat): 实现斜杠命令菜单与技能命令补全"
```

---

## 任务 14：扩展 protocol + 处理 skills_sync 推送

**文件：**
- 修改：`mobile-app/lib/core/protocol/protocol.dart`
- 修改：`mobile-app/lib/features/chat/chat_controller.dart`

- [ ] **步骤 1：扩展 PushType 枚举**

修改 `mobile-app/lib/core/protocol/protocol.dart` 的 `PushType` 枚举，在 `pong` 之后新增 `skillsSync`：

```dart
enum PushType {
  connected('connected'),
  streamEvent('stream_event'),
  assistant('assistant'),
  toolUse('tool_use'),
  toolResult('tool_result'),
  permissionRequest('permission_request'),
  result('result'),
  sessionsList('sessions_list'),
  agentsList('agents_list'),
  settingsSync('settings_sync'),
  themeSync('theme_sync'),
  themeChanged('theme_changed'),
  sessionChanged('session_changed'),
  error('error'),
  pong('pong'),
  skillsSync('skills_sync');

  const PushType(this.value);
  final String value;

  static PushType fromString(String value) {
    return PushType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => PushType.error,
    );
  }
}
```

- [ ] **步骤 2：在 ChatNotifier 处理 skills_sync**

修改 `mobile-app/lib/features/chat/chat_controller.dart`。

在 `_handlePush` 方法的 `switch` 中新增 case（在 `default` 之前）：

```dart
      case PushType.skillsSync:
        _handleSkillsSync(push.data);
        break;
```

在类中新增方法：

```dart
  /// 处理桌面端推送的技能同步消息。
  ///
  /// 推送数据格式：
  /// ```
  /// {
  ///   "skills": [
  ///     {"name": "code-review", "description": "...", "content": "---\nname: ..."}
  ///   ]
  /// }
  /// ```
  Future<void> _handleSkillsSync(Map<String, dynamic>? data) async {
    if (data == null) return;
    final skills = data['skills'];
    if (skills is! List) return;
    final docs = await getApplicationDocumentsDirectory();
    final syncDir =
        Directory('${docs.path}/spacecode/skills/desktop-sync');
    await syncDir.create(recursive: true);
    for (final entry in skills.whereType<Map<String, dynamic>>()) {
      final name = entry['name'] as String?;
      final content = entry['content'] as String?;
      if (name == null || name.isEmpty || content == null) continue;
      final skillDir = Directory('${syncDir.path}/$name');
      await skillDir.create(recursive: true);
      await File('${skillDir.path}/SKILL.md').writeAsString(content);
    }
    await _ref.read(skillRegistryProvider.notifier).refresh();
  }
```

在顶部 import 区新增（若尚未有）：
```dart
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../../core/skills/skill_registry.dart';
```

注意：`dart:io` 与 `path_provider` 已经在 chat_controller.dart 顶部 import 过了（见第 1-7 行），无需重复添加。仅添加 `skill_registry.dart` 即可（任务 9 已完成）。

- [ ] **步骤 3：运行类型检查验证编译通过**

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 4：Commit**

```bash
cd mobile-app
git add lib/core/protocol/protocol.dart lib/features/chat/chat_controller.dart
git commit -m "feat(protocol): 新增 skills_sync 推送类型与桌面同步处理"
```

---

## 任务 15：添加 assets/skills/ 内置技能 + pubspec.yaml 声明

**文件：**
- 创建：`mobile-app/assets/skills/code-review/SKILL.md`
- 创建：`mobile-app/assets/skills/commit-message/SKILL.md`
- 修改：`mobile-app/pubspec.yaml`

- [ ] **步骤 1：创建 code-review 技能**

创建 `mobile-app/assets/skills/code-review/SKILL.md`：

```markdown
---
name: code-review
description: 审查代码变更，识别 bug、安全漏洞、性能问题与可维护性风险。当用户请求代码审查、review、code review 时使用。
---

# 代码审查

## 审查步骤

1. 使用 `list_files` 与 `grep_files` 定位目标代码
2. 使用 `read_file` 读取相关文件（必要时用 offset/limit 分段读取）
3. 按以下维度审查：
   - **正确性**：逻辑错误、边界条件、异常处理
   - **安全性**：注入、越权、敏感信息泄漏
   - **性能**：时间/空间复杂度、N+1 查询、不必要的拷贝
   - **可维护性**：命名、职责划分、注释完整性
4. 按严重程度分级输出：
   - **必须修复**：会导致 bug、安全漏洞、数据丢失
   - **建议修改**：影响可读性、性能、可维护性
   - **仅供参考**：风格建议、未来改进方向

## 输出格式

```
## 审查结果

### 必须修复
- [文件:行号] 问题描述与修复建议

### 建议修改
- [文件:行号] 问题描述与修复建议

### 仅供参考
- [文件:行号] 问题描述与修复建议
```
```

- [ ] **步骤 2：创建 commit-message 技能**

创建 `mobile-app/assets/skills/commit-message/SKILL.md`：

```markdown
---
name: commit-message
description: 生成符合 Conventional Commits 规范的中文提交信息。当用户请求生成 commit message、提交信息时使用。
---

# 提交信息生成

## 规范

- 格式：`<type>(<scope>): <subject>`
- type 取值：feat / fix / docs / style / refactor / test / chore
- scope：可选，影响的模块名
- subject：简明描述，不超过 50 字符，不以句号结尾
- body：可选，详细说明变更原因与影响
- footer：可选，标注 BREAKING CHANGE 或关联 issue

## 步骤

1. 使用 `grep_files` 与 `read_file` 查看变更文件
2. 识别变更类型（新功能/修复/重构/文档/测试/构建）
3. 识别影响范围（哪些模块/文件）
4. 生成 1-3 个候选提交信息供用户选择
5. 若有 BREAKING CHANGE，在 footer 显式标注

## 示例

```
feat(skills): 新增技能系统支持 GitHub 安装

- 实现 4 个 SkillSource（bundled/user/github/desktop-sync）
- 重构 LocalAgentService 接入 AgentSession 架构
- 添加斜杠命令菜单与技能管理页
```
```

- [ ] **步骤 3：在 pubspec.yaml 声明 assets**

修改 `mobile-app/pubspec.yaml` 的 `flutter:` 段，在 `uses-material-design: true` 之后新增：

```yaml
flutter:
  uses-material-design: true
  assets:
    - assets/skills/code-review/SKILL.md
    - assets/skills/commit-message/SKILL.md
    - lib/core/i18n/locales/zh.json
    - lib/core/i18n/locales/en.json
```

- [ ] **步骤 4：在 App 启动时初始化 I18n**

找到 `mobile-app/lib/main.dart`，在 `runApp` 之前新增 i18n 初始化。

查看现有 main.dart：[main.dart](file:///d:/AI/SpaceCode/mobile-app/lib/main.dart)。

如果已有 `main()` 函数，在其中加入：

```dart
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/mobile_config.dart';
import 'core/i18n/strings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = await _loadInitialConfig();
  await _initI18n(config.appLocale);
  runApp(const ProviderScope(child: SpacecodeApp()));
}

Future<MobileConfig> _loadInitialConfig() async {
  final prefs = await SharedPreferences.getInstance();
  return MobileConfig(
    apiKey: prefs.getString('mobile_engine_api_key') ?? '',
    baseUrl: prefs.getString('mobile_engine_base_url') ?? 'https://api.openai.com/v1',
    model: prefs.getString('mobile_engine_model') ?? 'gpt-4o-mini',
    githubToken: prefs.getString('mobile_github_token') ?? '',
    githubLogin: prefs.getString('mobile_github_login') ?? '',
    appLocale: prefs.getString('mobile_app_locale') ?? 'zh',
  );
}

Future<void> _initI18n(String localeCode) async {
  final locale = localeCode == 'en' ? AppLocale.en : AppLocale.zh;
  final path = locale == AppLocale.en
      ? 'lib/core/i18n/locales/en.json'
      : 'lib/core/i18n/locales/zh.json';
  try {
    final json = await rootBundle.loadString(path);
    final decoded = jsonDecode(json) as Map<String, dynamic>;
    I18n.init(locale, decoded.map((k, v) => MapEntry(k, v.toString())));
  } catch (_) {
    // 加载失败保持默认（key 本身）
  }
}
```

注意：保留原 main.dart 中的其他初始化逻辑（如 `MobileConfigNotifier` 自动 load）。此处的 `_loadInitialConfig` 仅用于在 runApp 前确定语言。

- [ ] **步骤 5：在 SettingsScreen 添加语言切换入口**

查看 [settings_screen.dart](file:///d:/AI/SpaceCode/mobile-app/lib/features/settings/settings_screen.dart)，找到一个合适位置（如其他设置项附近）添加语言切换 ListTile：

```dart
import '../../core/i18n/strings.dart';

// 在 build 方法内某 ListTile 列表区域追加：
ListTile(
  leading: const Icon(Icons.language),
  title: Text(I18n.t('settings.language')),
  trailing: DropdownButton<String>(
    value: ref.watch(mobileConfigProvider).appLocale,
    items: [
      DropdownMenuItem(
        value: 'zh',
        child: Text(I18n.t('settings.languageZh')),
      ),
      DropdownMenuItem(
        value: 'en',
        child: Text(I18n.t('settings.languageEn')),
      ),
    ],
    onChanged: (value) async {
      if (value == null) return;
      await ref.read(mobileConfigProvider.notifier).saveLocale(value);
      await _initI18n(value);
      // 强制重建以应用新语言
      setState(() {});
    },
  ),
),
```

注意：`_initI18n` 需要从 main.dart 导出，或在 settings 内联实现。最简方案：在 `settings_screen.dart` 内复制一份 `_initI18n` 私有函数。

- [ ] **步骤 6：在 ChatScreen 设置按钮添加 SkillsScreen 入口**

查看 `mobile-app/lib/features/chat/chat_screen.dart`，找到设置按钮（齿轮图标）附近，添加技能按钮：

```dart
IconButton(
  icon: const Icon(Icons.extension_outlined),
  tooltip: I18n.t('skills.title'),
  onPressed: () => context.push('/skills'),
),
```

- [ ] **步骤 7：运行所有测试与类型检查**

运行：`cd mobile-app && flutter test`
预期：PASS

运行：`cd mobile-app && flutter analyze`
预期：无错误

- [ ] **步骤 8：手动验证内置技能加载**

运行：`cd mobile-app && flutter run`
- 进入聊天页 → 点击顶部"技能"图标 → 进入 SkillsScreen
- 预期：看到 `code-review` 与 `commit-message` 两个内置技能
- 点击 `code-review` → 进入详情页 → 看到 SKILL.md 全文
- 返回聊天页 → 输入 `/` → 看到斜杠命令菜单，包含 `/skill:code-review` 与 `/skill:commit-message`
- 选择 `/skill:code-review` → 输入框自动填入 `/skill:code-review `，光标在末尾
- 继续输入"帮我审查 main.dart" → 按发送
- 预期：Agent 收到的 prompt 为 `Load skill 'code-review' and follow its instructions for the following task:\n\n帮我审查 main.dart`

- [ ] **步骤 9：Commit**

```bash
cd mobile-app
git add assets/skills/ pubspec.yaml lib/main.dart lib/features/settings/settings_screen.dart lib/features/chat/chat_screen.dart
git commit -m "feat(skills): 添加内置技能 assets 与 i18n 启动初始化"
```

---

## 自检

**1. 规格覆盖度检查：**

| 规格章节 | 实现任务 | 状态 |
|---------|---------|------|
| 1. 背景与目标 | 全部任务覆盖 | ✓ |
| 2. 架构概览 | 任务 1-15 全部 | ✓ |
| 3.1 技能类型 | 任务 3 | ✓ |
| 3.2 Frontmatter | 任务 3 | ✓ |
| 3.3 校验器 | 任务 4 | ✓ |
| 3.4 SkillSource 接口 + 4 实现 | 任务 5 | ✓ |
| 3.5 SkillRegistry | 任务 6 | ✓ |
| 3.6 SkillPlugin | 任务 7 | ✓ |
| 3.7 AgentPlugin + AgentModel 扩展 | 任务 1 | ✓ |
| 3.8 AgentSession 扩展 | 任务 1 | ✓ |
| 3.9 OpenAiCompatibleModel | 任务 2 | ✓ |
| 3.10 LocalAgentService 重构 | 任务 9 | ✓ |
| 4.1 技能加载流 | 任务 6 + 15 | ✓ |
| 4.2 Agent 执行流 | 任务 9 | ✓ |
| 4.3 斜杠命令流 | 任务 9（命令解析）+ 任务 13（UI） | ✓ |
| 4.4 桌面同步流 | 任务 14 | ✓ |
| 4.5 GitHub 安装流 | 任务 8 + 12 | ✓ |
| 5.1 SkillsScreen | 任务 12 | ✓ |
| 5.2 SkillCard | 任务 12 | ✓ |
| 5.3 SkillDetailPage | 任务 12 | ✓ |
| 5.4 SkillInstallDialog | 任务 12 | ✓ |
| 5.5 SkillCommandMenu | 任务 13 | ✓ |
| 6. 内置技能 | 任务 15 | ✓ |
| 7. 协议扩展 | 任务 14 | ✓ |
| 8. 国际化 | 任务 10 + 11 + 15 | ✓ |
| 9. 错误处理 | 各任务内 | ✓ |
| 10. 测试策略 | 各任务内 TDD | ✓ |
| 11. 迁移路径 | 任务 1-15 按顺序 | ✓ |
| 12. 安全考虑 | 任务 8（clone 沙箱）+ 12（警告文案） | ✓ |
| 13. 后续扩展点 | 非本版范围 | N/A |

**2. 占位符扫描：** 无 TODO、无"待定"、无"类似任务 N"。每个代码步骤都包含完整代码。

**3. 类型一致性：**
- `Skill` 类字段在任务 3 定义后，任务 5/6/7/12 都使用 `name`/`description`/`filePath`/`baseDir`/`source`/`disableModelInvocation` ✓
- `SkillRegistryState` 的 `enabledSkills`/`find`/`disabledNames`/`toggle` 在任务 6 定义后，任务 7/9/12 使用一致 ✓
- `SkillPlugin` 构造函数 `SkillPlugin(SkillRegistryState)` 在任务 7 定义，任务 9 使用一致 ✓
- `AgentModel.complete` 新增 `onDelta` 参数在任务 1 定义，任务 2 实现流式时使用一致 ✓
- `buildSystemPromptSuffix()` 在任务 1 定义为 `AgentPlugin` 方法，任务 7 的 `SkillPlugin` override 一致 ✓
- `LocalAgentService.complete` 新增 `skillRegistry` 参数在任务 9 定义，任务 9 的 chat_controller 调用一致 ✓

**4. 模糊性检查：** 无发现。

计划完整，可执行。

# 移动端 Clone 进度反馈与 Agent Timeline 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 给手机端 GitHub Clone 加真实进度条 + 后台运行 + 设置页可查看；聊天 UI 改为 Agent Timeline 形式按时间顺序渲染 text/toolCall 事件。

**架构：**
- Clone：`GithubService.cloneRepository` 改为 `Stream<CloneProgress>`（HTTP streaming + 解压进度）；新增 `CloneNotifier` 后台 StateNotifier；设置页 `_CloneTaskCard` 监听 state。
- Timeline：新增 `TimelineEvent` 模型 + `TimelineAssembler` 装配器；`ChatMessage` 新增 `timelineEvents` 字段；`MessageBubble` 双路径渲染（timeline / legacy）；`ChatController` 在事件处理中维护 assembler。

**技术栈：** Flutter 3 / Dart 3、Riverpod 2.5、http 1.2（含 `AbortableRequest`/`StreamedResponse`）、archive 3.6、uuid 4.4、flutter_markdown 0.7、`package:http/testing.dart` 的 `MockClient.streaming`。

---

## 文件结构

### 新建文件

| 路径 | 职责 |
|------|------|
| `mobile-app/lib/core/github/clone_progress.dart` | `ClonePhase` 枚举 + `CloneProgress` 数据模型（含 downloadPercent/extractPercent/fromJson/toJson） |
| `mobile-app/lib/core/github/clone_notifier.dart` | `CloneStatus` 枚举 + `CloneState` + `CloneNotifier`（StateNotifier）+ `cloneProvider` + `cloneServiceFactoryProvider` |
| `mobile-app/lib/features/chat/models/timeline_event.dart` | `TimelineEventType`/`TimelineEventStatus` 枚举 + `TimelineEvent` 数据模型 |
| `mobile-app/lib/features/chat/timeline_assembler.dart` | `TimelineAssembler` 装配器（appendTextDelta/addToolCall/completeToolCall/completeTurn） |
| `mobile-app/test/core/github/clone_progress_test.dart` | CloneProgress 单元测试 |
| `mobile-app/test/core/github/clone_notifier_test.dart` | CloneNotifier 状态机测试 |
| `mobile-app/test/core/github/github_service_clone_test.dart` | cloneRepository Stream 改造测试（替代旧 test/github_service_test.dart） |
| `mobile-app/test/features/chat/models/timeline_event_test.dart` | TimelineEvent 单元测试 |
| `mobile-app/test/features/chat/timeline_assembler_test.dart` | TimelineAssembler 装配器测试 |
| `mobile-app/test/features/chat/widgets/message_bubble_timeline_test.dart` | MessageBubble 双路径渲染测试 |

### 修改文件

| 路径 | 修改内容 |
|------|---------|
| `mobile-app/lib/core/github/github_service.dart` | `cloneRepository` 从 `Future<void>` 改为 `Stream<CloneProgress>`；用 `client.send` 拿 `StreamedResponse` 流式读取；解压每 5 个文件 yield 一次进度 |
| `mobile-app/lib/features/chat/models/message.dart` | 新增 `timelineEvents` 字段 + `hasTimeline` getter + 序列化（向后兼容 null） |
| `mobile-app/lib/features/chat/chat_controller.dart` | 引入 `TimelineAssembler`（每 turn 一个）；`_handleStreamEvent`/`_handleAssistant`/`_handleToolUse`/`_handleToolResult`/`_handleResult`/`_handleLocalAgentEvent` 改用 assembler；clone 调用改为消费 Stream |
| `mobile-app/lib/features/chat/widgets/message_bubble.dart` | 双路径渲染：`hasTimeline` 走 `_buildTimeline`（`_TimelineEntry` 装饰），否则走 `_buildLegacy`（原逻辑） |
| `mobile-app/lib/core/skills/skill_installer.dart` | `cloneRepository` 调用改为 `await for` 消费 Stream |
| `mobile-app/lib/features/settings/settings_screen.dart` | `_cloneGithubRepository` 改为调用 `CloneNotifier.startClone`；新增 `_CloneTaskCard` Widget 显示进度/完成/错误 |
| `mobile-app/test/github_service_test.dart` | 删除（被 `test/core/github/github_service_clone_test.dart` 替代） |

---

## 任务 1：CloneProgress 数据模型

**文件：**
- 创建：`mobile-app/lib/core/github/clone_progress.dart`
- 测试：`mobile-app/test/core/github/clone_progress_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/github/clone_progress_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';

void main() {
  group('CloneProgress', () {
    test('downloadPercent returns null when totalBytes is null', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 100,
        totalBytes: null,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, isNull);
    });

    test('downloadPercent returns null when totalBytes is zero', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 100,
        totalBytes: 0,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, isNull);
    });

    test('downloadPercent returns ratio when totalBytes is positive', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 50,
        totalBytes: 200,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, 0.25);
    });

    test('extractPercent returns null when totalFiles is null', () {
      const progress = CloneProgress(
        phase: ClonePhase.extracting,
        receivedBytes: 200,
        totalBytes: 200,
        processedFiles: 5,
        totalFiles: null,
      );
      expect(progress.extractPercent, isNull);
    });

    test('extractPercent returns ratio when totalFiles is positive', () {
      const progress = CloneProgress(
        phase: ClonePhase.extracting,
        receivedBytes: 200,
        totalBytes: 200,
        processedFiles: 3,
        totalFiles: 10,
      );
      expect(progress.extractPercent, 0.3);
    });

    test('toJson/fromJson roundtrip preserves all fields', () {
      const original = CloneProgress(
        phase: ClonePhase.done,
        receivedBytes: 1024,
        totalBytes: 1024,
        processedFiles: 7,
        totalFiles: 7,
        resultPath: '/tmp/repo',
      );
      final decoded = CloneProgress.fromJson(original.toJson());
      expect(decoded.phase, ClonePhase.done);
      expect(decoded.receivedBytes, 1024);
      expect(decoded.totalBytes, 1024);
      expect(decoded.processedFiles, 7);
      expect(decoded.totalFiles, 7);
      expect(decoded.resultPath, '/tmp/repo');
      expect(decoded.errorMessage, isNull);
    });

    test('fromJson handles missing optional fields', () {
      final decoded = CloneProgress.fromJson({
        'phase': 'downloading',
        'receivedBytes': 10,
        'processedFiles': 0,
      });
      expect(decoded.phase, ClonePhase.downloading);
      expect(decoded.receivedBytes, 10);
      expect(decoded.totalBytes, isNull);
      expect(decoded.errorMessage, isNull);
      expect(decoded.resultPath, isNull);
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/github/clone_progress_test.dart`
预期：FAIL，报错 `library 'package:spacecode_mobile/core/github/clone_progress.dart' not found` 或类似。

- [ ] **步骤 3：编写最少实现代码**

创建 `mobile-app/lib/core/github/clone_progress.dart`：

```dart
/// Clone 任务进度阶段。
enum ClonePhase { downloading, extracting, done, error }

/// Clone 任务的瞬时进度快照。
///
/// 由 [GithubService.cloneRepository] 通过 Stream 推送，
/// [CloneNotifier] 消费后转化为 [CloneState]。
class CloneProgress {
  final ClonePhase phase;
  final int receivedBytes;
  final int? totalBytes;
  final int processedFiles;
  final int? totalFiles;
  final String? errorMessage;
  final String? resultPath;

  const CloneProgress({
    required this.phase,
    required this.receivedBytes,
    required this.totalBytes,
    required this.processedFiles,
    this.totalFiles,
    this.errorMessage,
    this.resultPath,
  });

  /// 下载阶段百分比 [0, 1]；totalBytes 未知时返回 null。
  double? get downloadPercent =>
      (totalBytes == null || totalBytes == 0) ? null : receivedBytes / totalBytes!;

  /// 解压阶段百分比 [0, 1]；totalFiles 未知时返回 null。
  double? get extractPercent =>
      (totalFiles == null || totalFiles == 0) ? null : processedFiles / totalFiles!;

  Map<String, dynamic> toJson() => {
        'phase': phase.name,
        'receivedBytes': receivedBytes,
        'totalBytes': totalBytes,
        'processedFiles': processedFiles,
        'totalFiles': totalFiles,
        if (errorMessage != null) 'errorMessage': errorMessage,
        if (resultPath != null) 'resultPath': resultPath,
      };

  factory CloneProgress.fromJson(Map<String, dynamic> json) => CloneProgress(
        phase: ClonePhase.values.firstWhere(
          (e) => e.name == json['phase'],
          orElse: () => ClonePhase.downloading,
        ),
        receivedBytes: (json['receivedBytes'] as num?)?.toInt() ?? 0,
        totalBytes: (json['totalBytes'] as num?)?.toInt(),
        processedFiles: (json['processedFiles'] as num?)?.toInt() ?? 0,
        totalFiles: (json['totalFiles'] as num?)?.toInt(),
        errorMessage: json['errorMessage'] as String?,
        resultPath: json['resultPath'] as String?,
      );
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/github/clone_progress_test.dart`
预期：PASS（7 个测试全通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/core/github/clone_progress.dart test/core/github/clone_progress_test.dart
git commit -m "feat(mobile): 新增 CloneProgress 数据模型与测试"
```

---

## 任务 2：TimelineEvent 数据模型

**文件：**
- 创建：`mobile-app/lib/features/chat/models/timeline_event.dart`
- 测试：`mobile-app/test/features/chat/models/timeline_event_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/chat/models/timeline_event_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';

void main() {
  group('TimelineEvent', () {
    test('copyWith does not modify the original instance', () {
      const original = TimelineEvent(
        id: 'evt-1',
        type: TimelineEventType.text,
        timestamp: null,
        status: TimelineEventStatus.running,
        content: 'hello',
      );
      final copied = original.copyWith(
        status: TimelineEventStatus.completed,
        content: 'hello world',
      );
      expect(original.status, TimelineEventStatus.running);
      expect(original.content, 'hello');
      expect(copied.status, TimelineEventStatus.completed);
      expect(copied.content, 'hello world');
      expect(copied.id, 'evt-1');
      expect(copied.type, TimelineEventType.text);
    });

    test('toJson/fromJson roundtrip preserves all fields', () {
      final ts = DateTime(2026, 7, 21, 10, 30);
      final original = TimelineEvent(
        id: 'evt-2',
        type: TimelineEventType.toolCall,
        timestamp: ts,
        status: TimelineEventStatus.completed,
        toolCallId: 'tc-abc',
      );
      final decoded = TimelineEvent.fromJson(original.toJson());
      expect(decoded.id, 'evt-2');
      expect(decoded.type, TimelineEventType.toolCall);
      expect(decoded.status, TimelineEventStatus.completed);
      expect(decoded.toolCallId, 'tc-abc');
      expect(decoded.timestamp.toIso8601String(), ts.toIso8601String());
    });

    test('fromJson handles missing optional fields with defaults', () {
      final decoded = TimelineEvent.fromJson({
        'id': 'evt-3',
        'type': 'text',
        'status': 'running',
        'timestamp': DateTime(2026, 1, 1).toIso8601String(),
      });
      expect(decoded.content, isNull);
      expect(decoded.toolCallId, isNull);
      expect(decoded.metadata, isNull);
    });

    test('metadata roundtrip preserves map structure', () {
      final original = TimelineEvent(
        id: 'evt-4',
        type: TimelineEventType.metadata,
        timestamp: DateTime(2026, 7, 21),
        status: TimelineEventStatus.completed,
        metadata: {'model': 'gpt-4', 'tokens': 42},
      );
      final decoded = TimelineEvent.fromJson(original.toJson());
      expect(decoded.metadata, {'model': 'gpt-4', 'tokens': 42});
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/features/chat/models/timeline_event_test.dart`
预期：FAIL，报错 library not found。

- [ ] **步骤 3：编写最少实现代码**

创建 `mobile-app/lib/features/chat/models/timeline_event.dart`：

```dart
/// Timeline 事件类型。
///
/// 对应桌面端 [MessageTimelineEvent.type]，移动端按需实现核心子集：
/// - [text]：LLM 输出的文本片段
/// - [toolCall]：工具调用
/// - [reasoning]：LLM 思考过程
/// - [metadata]：模型/token/耗时等元信息（暂不主动产生，预留类型）
enum TimelineEventType { reasoning, text, toolCall, metadata }

/// Timeline 事件状态。
enum TimelineEventStatus { pending, running, completed, error }

/// Timeline 中的单个事件。
///
/// 一次 assistant turn 内的 text/toolCall/reasoning 按时间顺序记录为
/// [TimelineEvent] 列表，渲染时遍历该列表形成时间线视图。
class TimelineEvent {
  final String id;
  final TimelineEventType type;
  final DateTime timestamp;
  final TimelineEventStatus status;
  final String? content;
  final String? toolCallId;
  final Map<String, dynamic>? metadata;

  const TimelineEvent({
    required this.id,
    required this.type,
    required this.timestamp,
    required this.status,
    this.content,
    this.toolCallId,
    this.metadata,
  });

  TimelineEvent copyWith({
    TimelineEventStatus? status,
    String? content,
    Map<String, dynamic>? metadata,
  }) =>
      TimelineEvent(
        id: id,
        type: type,
        timestamp: timestamp,
        status: status ?? this.status,
        content: content ?? this.content,
        toolCallId: toolCallId,
        metadata: metadata ?? this.metadata,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'timestamp': timestamp.toIso8601String(),
        'status': status.name,
        if (content != null) 'content': content,
        if (toolCallId != null) 'toolCallId': toolCallId,
        if (metadata != null) 'metadata': metadata,
      };

  factory TimelineEvent.fromJson(Map<String, dynamic> json) => TimelineEvent(
        id: json['id'] as String? ?? '',
        type: TimelineEventType.values.firstWhere(
          (e) => e.name == json['type'],
          orElse: () => TimelineEventType.text,
        ),
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        status: TimelineEventStatus.values.firstWhere(
          (e) => e.name == json['status'],
          orElse: () => TimelineEventStatus.completed,
        ),
        content: json['content'] as String?,
        toolCallId: json['toolCallId'] as String?,
        metadata: json['metadata'] as Map<String, dynamic>?,
      );
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/features/chat/models/timeline_event_test.dart`
预期：PASS（4 个测试全通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/features/chat/models/timeline_event.dart test/features/chat/models/timeline_event_test.dart
git commit -m "feat(mobile): 新增 TimelineEvent 数据模型与测试"
```

---

## 任务 3：TimelineAssembler 装配器

**文件：**
- 创建：`mobile-app/lib/features/chat/timeline_assembler.dart`
- 测试：`mobile-app/test/features/chat/timeline_assembler_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/chat/timeline_assembler_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';
import 'package:spacecode_mobile/features/chat/timeline_assembler.dart';

void main() {
  group('TimelineAssembler', () {
    test('appendTextDelta creates a new running text event on first delta', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('Hello');
      expect(assembler.events.length, 1);
      expect(assembler.events.first.type, TimelineEventType.text);
      expect(assembler.events.first.status, TimelineEventStatus.running);
      expect(assembler.events.first.content, 'Hello');
    });

    test('appendTextDelta accumulates content into the current text event', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('Hello');
      assembler.appendTextDelta(' world');
      expect(assembler.events.length, 1);
      expect(assembler.events.first.content, 'Hello world');
    });

    test('addToolCall closes the current text event and appends toolCall event', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('thinking...');
      const toolCall = ToolCall(
        id: 'tc-1',
        toolName: 'list_files',
        input: '{"path":"."}',
      );
      assembler.addToolCall(toolCall);

      expect(assembler.events.length, 2);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].status, TimelineEventStatus.completed);
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[1].status, TimelineEventStatus.running);
      expect(assembler.events[1].toolCallId, 'tc-1');
    });

    test('text after toolCall creates a NEW text event (time ordering)', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('before');
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.appendTextDelta('after');

      expect(assembler.events.length, 3);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].content, 'before');
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[2].type, TimelineEventType.text);
      expect(assembler.events[2].content, 'after');
      expect(assembler.events[2].status, TimelineEventStatus.running);
    });

    test('completeToolCall updates status to completed', () {
      final assembler = TimelineAssembler();
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.completeToolCall('tc-1', ToolCallStatus.completed);

      expect(assembler.events.first.status, TimelineEventStatus.completed);
    });

    test('completeToolCall updates status to error when tool result is error', () {
      final assembler = TimelineAssembler();
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.completeToolCall('tc-1', ToolCallStatus.error);

      expect(assembler.events.first.status, TimelineEventStatus.error);
    });

    test('empty content text event is removed when closed', () {
      final assembler = TimelineAssembler();
      // 仅追加空 delta（不会创建事件，因为 delta 为空时直接 return）
      assembler.appendTextDelta('');
      assembler.completeTurn();
      expect(assembler.events, isEmpty);
    });

    test('non-empty text event is marked completed on completeTurn', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('partial');
      assembler.completeTurn();
      expect(assembler.events.length, 1);
      expect(assembler.events.first.status, TimelineEventStatus.completed);
    });

    test('multiple toolCalls preserve time ordering', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('intro');
      const tc1 = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      const tc2 = ToolCall(id: 'tc-2', toolName: 'read_file', input: '');
      assembler.addToolCall(tc1);
      assembler.appendTextDelta('middle');
      assembler.addToolCall(tc2);
      assembler.appendTextDelta('end');
      assembler.completeTurn();

      expect(assembler.events.length, 5);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].content, 'intro');
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[1].toolCallId, 'tc-1');
      expect(assembler.events[2].type, TimelineEventType.text);
      expect(assembler.events[2].content, 'middle');
      expect(assembler.events[3].type, TimelineEventType.toolCall);
      expect(assembler.events[3].toolCallId, 'tc-2');
      expect(assembler.events[4].type, TimelineEventType.text);
      expect(assembler.events[4].content, 'end');
    });

    test('appendReasoningDelta creates a separate reasoning event', () {
      final assembler = TimelineAssembler();
      assembler.appendReasoningDelta('thinking...');
      assembler.appendTextDelta('answer');
      assembler.completeTurn();

      expect(assembler.events.length, 2);
      expect(assembler.events[0].type, TimelineEventType.reasoning);
      expect(assembler.events[0].content, 'thinking...');
      expect(assembler.events[1].type, TimelineEventType.text);
      expect(assembler.events[1].content, 'answer');
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/features/chat/timeline_assembler_test.dart`
预期：FAIL，报错 library not found。

- [ ] **步骤 3：编写最少实现代码**

创建 `mobile-app/lib/features/chat/timeline_assembler.dart`：

```dart
import 'dart:async';

import 'models/timeline_event.dart';
import 'models/tool_call.dart';

/// Timeline 事件装配器。
///
/// 每个 assistant turn 创建一个实例，按事件到达顺序维护
/// [TimelineEvent] 列表。工具调用开始时会"切断"当前 text 事件，
/// LLM 工具调用后继续输出文本会创建**新的** text 事件，
/// 从而自然形成时间顺序。
///
/// 参照桌面端 `src/stores/turn/timelineAssembler.ts` 实现。
class TimelineAssembler {
  final List<TimelineEvent> _events = [];
  String? _currentTextEventId;
  String? _currentReasoningEventId;
  int _counter = 0;

  /// 当前已装配的事件列表（不可变视图）。
  List<TimelineEvent> get events => List.unmodifiable(_events);

  /// 流式文本 delta 到达：追加到当前 text 事件，若不存在则创建。
  void appendTextDelta(String delta) {
    if (delta.isEmpty) return;
    if (_currentTextEventId == null) {
      _currentTextEventId = _nextId();
      _events.add(TimelineEvent(
        id: _currentTextEventId!,
        type: TimelineEventType.text,
        timestamp: DateTime.now(),
        status: TimelineEventStatus.running,
        content: '',
      ));
    }
    final idx = _indexById(_currentTextEventId!);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        content: _events[idx].content! + delta,
      );
    }
  }

  /// 流式思考 delta 到达：追加到当前 reasoning 事件，若不存在则创建。
  void appendReasoningDelta(String delta) {
    if (delta.isEmpty) return;
    if (_currentReasoningEventId == null) {
      _currentReasoningEventId = _nextId();
      _events.add(TimelineEvent(
        id: _currentReasoningEventId!,
        type: TimelineEventType.reasoning,
        timestamp: DateTime.now(),
        status: TimelineEventStatus.running,
        content: '',
      ));
    }
    final idx = _indexById(_currentReasoningEventId!);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        content: _events[idx].content! + delta,
      );
    }
  }

  /// 工具调用开始：先关闭当前 text 事件，再追加 toolCall 事件。
  void addToolCall(ToolCall toolCall) {
    _completeCurrentTextEvent();
    _events.add(TimelineEvent(
      id: _nextId(),
      type: TimelineEventType.toolCall,
      timestamp: DateTime.now(),
      status: TimelineEventStatus.running,
      toolCallId: toolCall.id,
    ));
  }

  /// 工具结果到达：更新对应 toolCall 事件的状态。
  void completeToolCall(String toolCallId, ToolCallStatus status) {
    final idx = _events.indexWhere((e) =>
        e.type == TimelineEventType.toolCall && e.toolCallId == toolCallId);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        status: status == ToolCallStatus.completed
            ? TimelineEventStatus.completed
            : TimelineEventStatus.error,
      );
    }
  }

  /// turn 结束：关闭所有未完成事件。
  void completeTurn() {
    _completeCurrentTextEvent();
    _completeCurrentReasoningEvent();
  }

  void _completeCurrentTextEvent() {
    if (_currentTextEventId == null) return;
    final idx = _indexById(_currentTextEventId!);
    if (idx >= 0 && _events[idx].status == TimelineEventStatus.running) {
      if (_events[idx].content!.isEmpty) {
        _events.removeAt(idx);
      } else {
        _events[idx] =
            _events[idx].copyWith(status: TimelineEventStatus.completed);
      }
    }
    _currentTextEventId = null;
  }

  void _completeCurrentReasoningEvent() {
    if (_currentReasoningEventId == null) return;
    final idx = _indexById(_currentReasoningEventId!);
    if (idx >= 0 && _events[idx].status == TimelineEventStatus.running) {
      if (_events[idx].content!.isEmpty) {
        _events.removeAt(idx);
      } else {
        _events[idx] =
            _events[idx].copyWith(status: TimelineEventStatus.completed);
      }
    }
    _currentReasoningEventId = null;
  }

  int _indexById(String id) =>
      _events.indexWhere((e) => e.id == id);

  String _nextId() {
    _counter += 1;
    return 'tl-${DateTime.now().microsecondsSinceEpoch}-$_counter';
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/features/chat/timeline_assembler_test.dart`
预期：PASS（10 个测试全通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/features/chat/timeline_assembler.dart test/features/chat/timeline_assembler_test.dart
git commit -m "feat(mobile): 新增 TimelineAssembler 装配器与测试"
```

---

## 任务 4：GithubService.cloneRepository 改造为 Stream

**文件：**
- 修改：`mobile-app/lib/core/github/github_service.dart`
- 测试：`mobile-app/test/core/github/github_service_clone_test.dart`（新建，替代旧 `test/github_service_test.dart`）

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/github/github_service_clone_test.dart`：

```dart
import 'dart:async';
import 'dart:convert';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/github_service.dart';

void main() {
  group('GithubService.cloneRepository Stream', () {
    test('emits downloading progress with totalBytes from Content-Length',
        () async {
      final zipBytes = _buildZip([
        _ArchiveFile('repo/file1.txt', [1, 2, 3]),
      ]);
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([zipBytes]),
          200,
          headers: {
            'content-length': '${zipBytes.length}',
          },
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      final progresses = <CloneProgress>[];
      // 用临时目录避免污染测试机
      final targetDir = await _tempDir();
      try {
        await for (final p in service.cloneRepository(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: targetDir,
        )) {
          progresses.add(p);
        }
      } finally {
        service.dispose();
        await _cleanup(targetDir);
      }

      // 至少应包含：若干 downloading + 至少 1 个 extracting + 1 个 done
      expect(progresses, isNotEmpty);
      expect(progresses.any((p) => p.phase == ClonePhase.downloading), isTrue);
      expect(progresses.any((p) => p.phase == ClonePhase.extracting), isTrue);
      expect(progresses.last.phase, ClonePhase.done);
      expect(progresses.last.resultPath, targetDir);
      // 第一个 downloading 进度应包含 totalBytes
      final firstDownload =
          progresses.firstWhere((p) => p.phase == ClonePhase.downloading);
      expect(firstDownload.totalBytes, zipBytes.length);
    });

    test('emits error phase on non-200 response', () async {
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([utf8.encode('{"message":"Not Found"}')]),
          404,
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneRepository(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/unused',
      )) {
        progresses.add(p);
      }
      service.dispose();

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, contains('404'));
    });

    test('respects isCancelled callback during download', () async {
      final zipBytes = _buildZip([
        _ArchiveFile('repo/file1.txt', [1, 2, 3]),
      ]);
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([zipBytes]),
          200,
          headers: {'content-length': '${zipBytes.length}'},
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      bool cancelled = false;
      final progresses = <CloneProgress>[];
      try {
        await for (final p in service.cloneRepository(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/unused',
          isCancelled: () => cancelled,
        )) {
          progresses.add(p);
          // 收到第一个 downloading 后立即取消
          if (p.phase == ClonePhase.downloading) {
            cancelled = true;
          }
        }
      } catch (_) {
        // 取消可能抛异常，忽略
      } finally {
        service.dispose();
      }

      expect(progresses.any((p) => p.phase == ClonePhase.error), isTrue);
      expect(
          progresses
              .firstWhere((p) => p.phase == ClonePhase.error)
              .errorMessage,
          contains('已取消'));
    });
  });
}

/// 测试用 zip 构造工具。
List<int> _buildZip(List<_ArchiveFile> files) {
  final archive = Archive();
  for (final f in files) {
    archive.addFile(ArchiveFile.bytes(f.name, f.content));
  }
  return ZipEncoder().encode(archive)!;
}

class _ArchiveFile {
  final String name;
  final List<int> content;
  const _ArchiveFile(this.name, this.content);
}

Future<String> _tempDir() async {
  // 测试中不依赖 path_provider，用系统临时目录
  final dir = await Directory.systemTemp.createTemp('clone_test_');
  return dir.path;
}

Future<void> _cleanup(String path) async {
  try {
    final dir = Directory(path);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  } catch (_) {
    // 忽略清理错误
  }
}
```

注意：上述测试代码顶部需要导入 `dart:io`：

```dart
import 'dart:io';
```

请将 `import 'dart:io';` 加入文件顶部 import 区。

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/github/github_service_clone_test.dart`
预期：FAIL，报错 `cloneRepository` 返回 `Future<void>` 而非 `Stream<CloneProgress>`，或 `ClonePhase` 未定义。

- [ ] **步骤 3：编写实现代码**

修改 `mobile-app/lib/core/github/github_service.dart`，在文件顶部 import 区新增：

```dart
import 'clone_progress.dart';
```

将 `cloneRepository` 方法（约 170-204 行）整体替换为：

```dart
  /// 下载仓库 zipball 并解压到 [targetDirectory]，通过 Stream 推送进度。
  ///
  /// 进度阶段顺序：[ClonePhase.downloading] → [ClonePhase.extracting] →
  /// [ClonePhase.done]。失败时推送 [ClonePhase.error] 后终止。
  /// [abortTrigger] 用于异步中止 HTTP 请求；[isCancelled] 用于解压循环同步检查。
  Stream<CloneProgress> cloneRepository({
    required String repository,
    required String branch,
    required String targetDirectory,
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async* {
    _throwIfCancelled(isCancelled);
    final request = http.AbortableRequest(
      'GET',
      Uri.parse('https://api.github.com/repos/$repository/zipball/$branch'),
      abortTrigger: abortTrigger,
    )..headers.addAll(_headers);
    final response = await _client.send(request);

    if (response.statusCode != 200) {
      final errorBody = await response.stream.bytesToString();
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: _errorMessage(
            _safeDecode(errorBody), '仓库下载失败 (HTTP ${response.statusCode})'),
      );
      return;
    }

    final totalBytes = int.tryParse(
        response.headers['content-length'] ?? '');
    final bytes = <int>[];
    await for (final chunk in response.stream) {
      if (isCancelled?.call() == true) {
        yield CloneProgress(
          phase: ClonePhase.error,
          receivedBytes: bytes.length,
          totalBytes: totalBytes,
          processedFiles: 0,
          errorMessage: '已取消',
        );
        return;
      }
      bytes.addAll(chunk);
      yield CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: bytes.length,
        totalBytes: totalBytes,
        processedFiles: 0,
      );
    }

    if (isCancelled?.call() == true) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: bytes.length,
        totalBytes: totalBytes,
        processedFiles: 0,
        errorMessage: '已取消',
      );
      return;
    }

    final archive = ZipDecoder().decodeBytes(bytes);
    final totalFiles = archive.length;
    final root = Directory(targetDirectory);
    await root.create(recursive: true);
    var processed = 0;
    for (final file in archive) {
      if (isCancelled?.call() == true) {
        yield CloneProgress(
          phase: ClonePhase.error,
          receivedBytes: bytes.length,
          totalBytes: totalBytes,
          processedFiles: processed,
          totalFiles: totalFiles,
          errorMessage: '已取消',
        );
        return;
      }
      final relative = file.name.split('/').skip(1).join('/');
      if (relative.isEmpty) {
        continue;
      }
      final output = File(
          '${root.path}${Platform.pathSeparator}${relative.replaceAll('/', Platform.pathSeparator)}');
      if (file.isFile) {
        await output.parent.create(recursive: true);
        await output.writeAsBytes(file.content as List<int>);
      } else {
        await Directory(output.path).create(recursive: true);
      }
      processed++;
      if (processed % 5 == 0 || processed == totalFiles) {
        yield CloneProgress(
          phase: ClonePhase.extracting,
          receivedBytes: bytes.length,
          totalBytes: totalBytes,
          processedFiles: processed,
          totalFiles: totalFiles,
        );
      }
    }

    yield CloneProgress(
      phase: ClonePhase.done,
      receivedBytes: bytes.length,
      totalBytes: totalBytes,
      processedFiles: totalFiles,
      totalFiles: totalFiles,
      resultPath: targetDirectory,
    );
  }

  dynamic _safeDecode(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }
```

- [ ] **步骤 4：删除旧测试，更新依赖调用点（避免编译错误）**

旧测试 `mobile-app/test/github_service_test.dart` 调用 `await service.cloneRepository(...)`（Future 语义），与新 Stream 签名不兼容。删除该文件：

```bash
cd mobile-app && git rm test/github_service_test.dart
```

同时，两个调用点（`chat_controller.dart:340`、`skill_installer.dart:94`）的 `await service.cloneRepository(...)` 会编译失败。这两个调用点的完整修复在任务 7 中进行，但为了避免任务 4 commit 后 `flutter analyze` 失败，此处临时用 `await for (final _ in service.cloneRepository(...)) {}` 包裹：

修改 `mobile-app/lib/features/chat/chat_controller.dart` 第 340 行附近：

原代码：
```dart
            await github.cloneRepository(
              repository: workspace.repository!,
              branch: workspace.branch!,
              targetDirectory: checkoutPath,
              abortTrigger: token.whenCancelled,
              isCancelled: () => token.isCancelled,
            );
```

临时改为：
```dart
            await for (final _ in github.cloneRepository(
              repository: workspace.repository!,
              branch: workspace.branch!,
              targetDirectory: checkoutPath,
              abortTrigger: token.whenCancelled,
              isCancelled: () => token.isCancelled,
            )) {
              // 中间进度忽略；任务 7 中接入 TimelineAssembler 时再处理
            }
```

修改 `mobile-app/lib/core/skills/skill_installer.dart` 第 94 行附近：

原代码：
```dart
      await github.cloneRepository(
        repository: '${parsed.owner}/${parsed.name}',
        branch: branch,
        targetDirectory: targetDir.path,
        abortTrigger: cancellation.whenCancelled,
        isCancelled: () => cancellation.isCancelled,
      );
```

临时改为：
```dart
      await for (final _ in github.cloneRepository(
        repository: '${parsed.owner}/${parsed.name}',
        branch: branch,
        targetDirectory: targetDir.path,
        abortTrigger: cancellation.whenCancelled,
        isCancelled: () => cancellation.isCancelled,
      )) {
        // 中间进度忽略；技能安装无需进度反馈
      }
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cd mobile-app && flutter test test/core/github/github_service_clone_test.dart`
预期：PASS（3 个测试全通过）。

运行全量 analyze 确保无编译错误：
运行：`cd mobile-app && flutter analyze`
预期：No issues found（或仅保留既有 info 级提示）。

- [ ] **步骤 6：Commit**

```bash
cd mobile-app && git add lib/core/github/github_service.dart lib/features/chat/chat_controller.dart lib/core/skills/skill_installer.dart test/core/github/github_service_clone_test.dart
git rm test/github_service_test.dart
git commit -m "feat(mobile): cloneRepository 改造为 Stream<CloneProgress> 支持真实进度反馈"
```

---

## 任务 5：CloneNotifier + CloneState

**文件：**
- 创建：`mobile-app/lib/core/github/clone_notifier.dart`
- 测试：`mobile-app/test/core/github/clone_notifier_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/github/clone_notifier_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:spacecode_mobile/core/config/mobile_config.dart';
import 'package:spacecode_mobile/core/github/clone_notifier.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/github_service.dart';

void main() {
  group('CloneNotifier', () {
    test('startClone throws StateError when token is empty', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) => _StubConfig()),
        cloneServiceFactoryProvider.overrideWithValue(
            (token) => _FakeGithubService(token)),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      expect(
        () => notifier.startClone(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/tmp/repo',
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('startClone throws StateError when already running', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) => _StubConfig(token: 't')),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(token, stream: _neverCompletingStream())),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      // 启动但不等完成
      unawaited(notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      ));
      // 等待 state 切到 running
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(container.read(cloneProvider).status, CloneStatus.running);

      expect(
        () => notifier.startClone(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/tmp/repo2',
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('consumes stream and transitions to done state', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) => _StubConfig(token: 't')),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.downloading,
                    receivedBytes: 10,
                    totalBytes: 100,
                    processedFiles: 0),
                const CloneProgress(
                    phase: ClonePhase.extracting,
                    receivedBytes: 100,
                    totalBytes: 100,
                    processedFiles: 5,
                    totalFiles: 5),
                const CloneProgress(
                    phase: ClonePhase.done,
                    receivedBytes: 100,
                    totalBytes: 100,
                    processedFiles: 5,
                    totalFiles: 5,
                    resultPath: '/tmp/repo'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.done);
      expect(state.resultPath, '/tmp/repo');
      expect(state.repositoryName, 'spacecode/mobile');
    });

    test('reset returns state to idle', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) => _StubConfig(token: 't')),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.done,
                    receivedBytes: 0,
                    totalBytes: 0,
                    processedFiles: 0,
                    resultPath: '/tmp/repo'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      );
      expect(container.read(cloneProvider).status, CloneStatus.done);

      notifier.reset();
      expect(container.read(cloneProvider).status, CloneStatus.idle);
    });

    test('error phase transitions state to error', () async {
      final container = ProviderContainer(overrides: [
        mobileConfigProvider.overrideWith((ref) => _StubConfig(token: 't')),
        cloneServiceFactoryProvider.overrideWithValue((token) =>
            _FakeGithubService(
              token,
              stream: Stream.fromIterable([
                const CloneProgress(
                    phase: ClonePhase.error,
                    receivedBytes: 0,
                    totalBytes: null,
                    processedFiles: 0,
                    errorMessage: 'HTTP 404'),
              ]),
            )),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(cloneProvider.notifier);
      await notifier.startClone(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      );

      final state = container.read(cloneProvider);
      expect(state.status, CloneStatus.error);
      expect(state.errorMessage, 'HTTP 404');
    });
  });
}

class _StubConfig extends MobileConfig {
  _StubConfig({String token = '', String login = ''})
      : super(
          apiKey: '',
          baseUrl: '',
          model: '',
          githubToken: token,
          githubLogin: login,
          appLocale: 'zh',
        );
}

class _FakeGithubService extends GithubService {
  final Stream<CloneProgress> stream;
  _FakeGithubService(String token, {required this.stream})
      : super(token: token);

  @override
  Stream<CloneProgress> cloneRepository({
    required String repository,
    required String branch,
    required String targetDirectory,
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) {
    return stream;
  }
}

Stream<CloneProgress> _neverCompletingStream() {
  final controller = StreamController<CloneProgress>();
  // 不关闭，永不完成
  return controller.stream;
}
```

注意：`_StubConfig` 需要扩展 `MobileConfig`，请先 Read `mobile-app/lib/core/config/mobile_config.dart` 确认 `MobileConfig` 的构造函数签名。如果 `MobileConfig` 不允许子类化或字段不可写，请改用 `mobileConfigProvider.overrideWithValue` 直接传入构造好的 `MobileConfig` 实例。

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/core/github/clone_notifier_test.dart`
预期：FAIL，报错 `clone_notifier.dart` not found。

- [ ] **步骤 3：编写实现代码**

先 Read `mobile-app/lib/core/config/mobile_config.dart` 确认 `MobileConfig` 构造函数签名与 `mobileConfigProvider` 类型。

创建 `mobile-app/lib/core/github/clone_notifier.dart`：

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/mobile_config.dart';
import 'clone_progress.dart';
import 'github_service.dart';

/// Clone 任务状态。
enum CloneStatus { idle, running, done, error }

/// Clone 任务状态快照。
class CloneState {
  final CloneStatus status;
  final CloneProgress? progress;
  final String? resultPath;
  final String? errorMessage;
  final String? repositoryName;

  const CloneState({
    required this.status,
    this.progress,
    this.resultPath,
    this.errorMessage,
    this.repositoryName,
  });

  static const idle = CloneState(status: CloneStatus.idle);

  CloneState copyWith({
    CloneStatus? status,
    CloneProgress? progress,
    String? resultPath,
    String? errorMessage,
    String? repositoryName,
    bool clearProgress = false,
  }) =>
      CloneState(
        status: status ?? this.status,
        progress: clearProgress ? null : progress ?? this.progress,
        resultPath: resultPath ?? this.resultPath,
        errorMessage: errorMessage ?? this.errorMessage,
        repositoryName: repositoryName ?? this.repositoryName,
      );
}

/// GithubService 工厂 Provider：默认返回真实 [GithubService]，
/// 测试时可 override 返回 mock service。
final cloneServiceFactoryProvider =
    Provider<GithubService Function(String token)>((ref) {
  return (token) => GithubService(token: token);
});

/// Clone 任务的后台 StateNotifier。
///
/// 生命周期独立于设置页：StateNotifier 持有任务 Future，
/// 用户退出设置页后任务继续运行，再次进入设置页时通过
/// [cloneProvider] 监听最新状态。
class CloneNotifier extends StateNotifier<CloneState> {
  final Ref _ref;
  Completer<void>? _abortCompleter;
  bool _cancelled = false;
  Future<void>? _task;

  CloneNotifier(this._ref) : super(CloneState.idle);

  /// 启动后台 clone 任务。若已有任务运行中，抛 [StateError]。
  Future<void> startClone({
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    if (state.status == CloneStatus.running) {
      throw StateError('已有 clone 任务运行中');
    }
    final token = _ref.read(mobileConfigProvider).githubToken;
    if (token.isEmpty) {
      throw StateError('未连接 GitHub');
    }
    final service = _ref.read(cloneServiceFactoryProvider)(token);
    _abortCompleter = Completer<void>();
    _cancelled = false;
    state = CloneState(
      status: CloneStatus.running,
      progress: null,
      repositoryName: repository,
    );
    _task = _runTask(
      service: service,
      repository: repository,
      branch: branch,
      targetDirectory: targetDirectory,
    );
    await _task;
  }

  Future<void> _runTask({
    required GithubService service,
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    try {
      await for (final progress in service.cloneRepository(
        repository: repository,
        branch: branch,
        targetDirectory: targetDirectory,
        abortTrigger: _abortCompleter?.future,
        isCancelled: () => _cancelled,
      )) {
        if (progress.phase == ClonePhase.done) {
          state = CloneState(
            status: CloneStatus.done,
            progress: progress,
            resultPath: progress.resultPath,
            repositoryName: repository,
          );
        } else if (progress.phase == ClonePhase.error) {
          state = CloneState(
            status: CloneStatus.error,
            progress: progress,
            errorMessage: progress.errorMessage,
            repositoryName: repository,
          );
        } else {
          state = state.copyWith(
            status: CloneStatus.running,
            progress: progress,
            repositoryName: repository,
          );
        }
      }
    } catch (error) {
      state = CloneState(
        status: CloneStatus.error,
        errorMessage: error.toString(),
        repositoryName: repository,
      );
    } finally {
      service.dispose();
    }
  }

  /// 取消当前任务。
  Future<void> cancel() async {
    _cancelled = true;
    _abortCompleter?.complete();
    // 等待任务真正结束
    await _task;
  }

  /// 清除完成/错误状态，回到 idle。
  void reset() {
    if (state.status == CloneStatus.running) return;
    state = CloneState.idle;
  }
}

final cloneProvider =
    StateNotifierProvider<CloneNotifier, CloneState>((ref) {
  return CloneNotifier(ref);
});
```

- [ ] **步骤 4：运行测试验证通过**

如果测试因 `MobileConfig` 不能子类化失败，先 Read 文件确认构造函数签名并修复 `_StubConfig`。

运行：`cd mobile-app && flutter test test/core/github/clone_notifier_test.dart`
预期：PASS（5 个测试全通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/core/github/clone_notifier.dart test/core/github/clone_notifier_test.dart
git commit -m "feat(mobile): 新增 CloneNotifier 后台 StateNotifier 与状态机测试"
```

---

## 任务 6：ChatMessage 扩展 timelineEvents 字段

**文件：**
- 修改：`mobile-app/lib/features/chat/models/message.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/chat/models/message_timeline_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';

void main() {
  group('ChatMessage.timelineEvents', () {
    test('hasTimeline is false when timelineEvents is null', () {
      const msg = ChatMessage(id: 'm1', role: MessageRole.assistant);
      expect(msg.hasTimeline, isFalse);
    });

    test('hasTimeline is false when timelineEvents is empty', () {
      const msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: [],
      );
      expect(msg.hasTimeline, isFalse);
    });

    test('hasTimeline is true when timelineEvents is non-empty', () {
      final msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.text,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.completed,
            content: 'hi',
          ),
        ],
      );
      expect(msg.hasTimeline, isTrue);
    });

    test('toJson serializes timelineEvents when non-null', () {
      final msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.toolCall,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.running,
            toolCallId: 'tc1',
          ),
        ],
      );
      final json = msg.toJson();
      expect(json['timelineEvents'], isA<List>());
      expect((json['timelineEvents'] as List).length, 1);
    });

    test('fromJson returns null timelineEvents when field is absent (backward compat)',
        () {
      final json = {
        'id': 'm1',
        'role': 'assistant',
        'content': 'hi',
        'isStreaming': false,
        'timestamp': DateTime(2026, 7, 21).toIso8601String(),
      };
      final msg = ChatMessage.fromJson(json);
      expect(msg.timelineEvents, isNull);
      expect(msg.hasTimeline, isFalse);
    });

    test('fromJson roundtrip preserves timelineEvents', () {
      final original = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        content: 'hello',
        isStreaming: false,
        toolCalls: const [
          ToolCall(id: 'tc1', toolName: 'list_files', input: '{}'),
        ],
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.text,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.completed,
            content: 'hello',
          ),
          TimelineEvent(
            id: 'e2',
            type: TimelineEventType.toolCall,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.running,
            toolCallId: 'tc1',
          ),
        ],
      );
      final decoded = ChatMessage.fromJson(original.toJson());
      expect(decoded.timelineEvents?.length, 2);
      expect(decoded.timelineEvents![0].content, 'hello');
      expect(decoded.timelineEvents![1].toolCallId, 'tc1');
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/features/chat/models/message_timeline_test.dart`
预期：FAIL，报错 `timelineEvents` 字段未定义。

- [ ] **步骤 3：编写实现代码**

修改 `mobile-app/lib/features/chat/models/message.dart`，整体替换为：

```dart
import 'timeline_event.dart';
import 'tool_call.dart';

enum MessageRole { user, assistant, system }

class ChatMessage {
  final String id;
  final MessageRole role;
  final String content;
  final List<ToolCall>? toolCalls;
  final String? thinkingContent;
  final bool isStreaming;
  final DateTime timestamp;
  final List<TimelineEvent>? timelineEvents;

  ChatMessage({
    required this.id,
    required this.role,
    this.content = '',
    this.toolCalls,
    this.thinkingContent,
    this.isStreaming = false,
    DateTime? timestamp,
    this.timelineEvents,
  }) : timestamp = timestamp ?? DateTime.now();

  bool get hasTimeline =>
      timelineEvents != null && timelineEvents!.isNotEmpty;

  ChatMessage copyWith({
    String? content,
    List<ToolCall>? toolCalls,
    String? thinkingContent,
    bool? isStreaming,
    List<TimelineEvent>? timelineEvents,
  }) =>
      ChatMessage(
        id: id,
        role: role,
        content: content ?? this.content,
        toolCalls: toolCalls ?? this.toolCalls,
        thinkingContent: thinkingContent ?? this.thinkingContent,
        isStreaming: isStreaming ?? this.isStreaming,
        timelineEvents: timelineEvents ?? this.timelineEvents,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'content': content,
        'toolCalls': toolCalls?.map((t) => t.toJson()).toList(),
        'thinkingContent': thinkingContent,
        'isStreaming': isStreaming,
        'timestamp': timestamp.toIso8601String(),
        if (timelineEvents != null)
          'timelineEvents': timelineEvents!.map((e) => e.toJson()).toList(),
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String? ?? '',
        role: MessageRole.values.firstWhere(
          (e) => e.name == json['role'],
          orElse: () => MessageRole.assistant,
        ),
        content: json['content'] as String? ?? '',
        toolCalls: (json['toolCalls'] as List<dynamic>?)
            ?.map((t) => ToolCall.fromJson(t as Map<String, dynamic>))
            .toList(),
        thinkingContent: json['thinkingContent'] as String?,
        // 反序列化时一律标记为已完成（流式状态不持久化）
        isStreaming: false,
        timestamp:
            DateTime.tryParse(json['timestamp'] as String? ?? '') ??
                DateTime.now(),
        timelineEvents: (json['timelineEvents'] as List<dynamic>?)
            ?.map((e) => TimelineEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/features/chat/models/message_timeline_test.dart`
预期：PASS（6 个测试全通过）。

运行回归测试确保旧消息处理无破坏：
运行：`cd mobile-app && flutter test`
预期：PASS（全部测试通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/features/chat/models/message.dart test/features/chat/models/message_timeline_test.dart
git commit -m "feat(mobile): ChatMessage 新增 timelineEvents 字段支持时间线渲染"
```

---

## 任务 7：ChatController 接入 TimelineAssembler + 调整 clone 调用

**文件：**
- 修改：`mobile-app/lib/features/chat/chat_controller.dart`
- 修改：`mobile-app/lib/core/skills/skill_installer.dart`

- [ ] **步骤 1：阅读现有 controller 关键方法**

Read `mobile-app/lib/features/chat/chat_controller.dart` 的以下行段（确认行号可能因前面任务变动）：
- `_handleStreamEvent`（约 617-649 行）：流式 delta 处理
- `_handleAssistant`（约 651-712 行）：assistant 完整消息
- `_handleToolUse`（约 714-733 行）：工具调用开始
- `_handleToolResult`（约 735-757 行）：工具结果
- `_handleResult`（约 771-783 行）：turn 结束
- `_handleLocalAgentEvent`（约 516-559 行）：本地 agent 事件
- `_runLocalAgent` 内 clone 调用（约 340-346 行，已在任务 4 临时改为 `await for`）

- [ ] **步骤 2：修改 chat_controller.dart**

在文件顶部 import 区新增：

```dart
import 'timeline_assembler.dart';
import 'models/timeline_event.dart';
```

在 `ChatNotifier` 类字段区新增（参照其他私有字段位置，约 line 200-300 之间）：

```dart
  /// 每个 session 的当前 turn 装配器（生命周期 = 一次 assistant turn）。
  final Map<String, TimelineAssembler> _assemblers = {};
```

替换 `_handleStreamEvent` 方法（约 617-649 行）为：

```dart
  void _handleStreamEvent(Map<String, dynamic>? data) {
    if (data == null) return;
    final delta = data['delta'] as String? ?? '';
    if (delta.isEmpty) return;

    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);

    final bool needNewMessage = messages.isEmpty ||
        messages.last.role != MessageRole.assistant ||
        !messages.last.isStreaming;

    ChatMessage msg;
    TimelineAssembler assembler;
    if (needNewMessage) {
      msg = ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.assistant,
        content: delta,
        isStreaming: true,
      );
      assembler = _assemblers[sessionId] = TimelineAssembler();
      assembler.appendTextDelta(delta);
      msg = msg.copyWith(timelineEvents: assembler.events);
      _setMessages(sessionId, [...messages, msg]);
    } else {
      final last = messages.last;
      assembler = _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());
      assembler.appendTextDelta(delta);
      messages[messages.length - 1] = last.copyWith(
        content: last.content + delta,
        timelineEvents: assembler.events,
      );
      _setMessages(sessionId, messages);
    }
    _schedulePersist();
  }
```

替换 `_handleToolUse` 方法（约 714-733 行）为：

```dart
  void _handleToolUse(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolCall = ToolCall(
      id: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isEmpty || messages.last.role != MessageRole.assistant) {
      return;
    }
    final last = messages.last;
    final toolCalls = List<ToolCall>.from(last.toolCalls ?? [])..add(toolCall);
    final assembler =
        _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());
    assembler.addToolCall(toolCall);
    messages[messages.length - 1] = last.copyWith(
      toolCalls: toolCalls,
      timelineEvents: assembler.events,
    );
    _setMessages(sessionId, messages);
    _schedulePersist();
  }
```

替换 `_handleToolResult` 方法（约 735-757 行）为：

```dart
  void _handleToolResult(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolUseId = data['toolUseId'] as String? ?? '';
    final output = data['output']?.toString() ?? '';
    final isError = data['isError'] as bool? ?? false;
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    for (int i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.toolCalls != null && msg.toolCalls!.any((tc) => tc.id == toolUseId)) {
        final toolCalls = msg.toolCalls!
            .map((tc) => tc.id == toolUseId
                ? tc.copyWith(
                    output: output,
                    status: isError
                        ? ToolCallStatus.error
                        : ToolCallStatus.completed)
                : tc)
            .toList();
        final assembler = _assemblers[sessionId];
        if (assembler != null) {
          assembler.completeToolCall(
              toolUseId,
              isError
                  ? ToolCallStatus.error
                  : ToolCallStatus.completed);
          messages[i] = msg.copyWith(
            toolCalls: toolCalls,
            timelineEvents: assembler.events,
          );
        } else {
          messages[i] = msg.copyWith(toolCalls: toolCalls);
        }
        break;
      }
    }
    _setMessages(sessionId, messages);
    _schedulePersist();
  }
```

替换 `_handleResult` 方法（约 771-783 行）为：

```dart
  void _handleResult(Map<String, dynamic>? data) {
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final assembler = _assemblers.remove(sessionId);
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isNotEmpty && messages.last.isStreaming) {
      final last = messages.last;
      assembler?.completeTurn();
      messages[messages.length - 1] = last.copyWith(
        isStreaming: false,
        timelineEvents: assembler != null ? assembler.events : last.timelineEvents,
      );
      _setMessages(sessionId, messages);
    }
    _setLoading(sessionId, false);
    _schedulePersist();
  }
```

修改 `_handleLocalAgentEvent` 方法（约 516-559 行）以接入 assembler。整体替换为：

```dart
  void _handleLocalAgentEvent(String sessionId, AgentEvent event) {
    final messages =
        List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isEmpty || messages.last.role != MessageRole.assistant) return;
    final assistant = messages.last;
    final assembler =
        _assemblers.putIfAbsent(sessionId, () => TimelineAssembler());

    if (event.type == AgentEventType.assistantDelta && event.delta != null) {
      assembler.appendTextDelta(event.delta!);
      messages[messages.length - 1] = assistant.copyWith(
        content: assistant.content + event.delta!,
        isStreaming: true,
        timelineEvents: assembler.events,
      );
      _setMessages(sessionId, messages);
      _schedulePersist();
      return;
    }

    if (event.type != AgentEventType.toolExecutionStart &&
        event.type != AgentEventType.toolExecutionEnd) {
      return;
    }

    final calls = List<ToolCall>.from(assistant.toolCalls ?? const []);
    if (event.type == AgentEventType.toolExecutionStart &&
        event.toolCall != null) {
      final newCall = ToolCall(
        id: event.toolCall!.id,
        toolName: event.toolCall!.name,
        input: jsonEncode(event.toolCall!.arguments),
      );
      calls.add(newCall);
      assembler.addToolCall(newCall);
    } else if (event.type == AgentEventType.toolExecutionEnd &&
        event.toolCall != null) {
      final index = calls.indexWhere((call) => call.id == event.toolCall!.id);
      if (index >= 0) {
        final newStatus = event.isError
            ? ToolCallStatus.error
            : ToolCallStatus.completed;
        calls[index] = calls[index].copyWith(
          output: event.toolResult,
          status: newStatus,
        );
        assembler.completeToolCall(event.toolCall!.id, newStatus);
      }
    }
    messages[messages.length - 1] = assistant.copyWith(
      toolCalls: calls,
      timelineEvents: assembler.events,
    );
    _setMessages(sessionId, messages);
  }
```

修改 `_runLocalAgent` 方法中 clone 调用（约 340-346 行，已被任务 4 临时改为 `await for`）。再次替换为携带进度反馈的版本：

原代码（任务 4 临时版本）：
```dart
            await for (final _ in github.cloneRepository(
              repository: workspace.repository!,
              branch: workspace.branch!,
              targetDirectory: checkoutPath,
              abortTrigger: token.whenCancelled,
              isCancelled: () => token.isCancelled,
            )) {
              // 中间进度忽略；任务 7 中接入 TimelineAssembler 时再处理
            }
```

替换为：
```dart
            await for (final progress in github.cloneRepository(
              repository: workspace.repository!,
              branch: workspace.branch!,
              targetDirectory: checkoutPath,
              abortTrigger: token.whenCancelled,
              isCancelled: () => token.isCancelled,
            )) {
              if (progress.phase == ClonePhase.error) {
                cloneError = progress.errorMessage ?? 'clone 失败';
              }
              // 中间进度不更新 UI；虚拟 ToolCallCard 已显示"运行中"
            }
```

注意：在 chat_controller.dart 顶部新增 import：

```dart
import '../../core/github/clone_progress.dart';
```

- [ ] **步骤 3：修改 skill_installer.dart（确认无需变更）**

任务 4 已将 `skill_installer.dart:94` 改为 `await for (final _ in ...)` 形式，无需进一步修改。保留现状即可。

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test`
预期：PASS（全部已有测试通过；本任务不新增测试，因为 controller 集成测试需 mock engine，超出本次范围）。

运行：`cd mobile-app && flutter analyze`
预期：No issues found。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/features/chat/chat_controller.dart
git commit -m "feat(mobile): ChatController 接入 TimelineAssembler 实现时间线事件装配"
```

---

## 任务 8：MessageBubble 双路径渲染 + _TimelineEntry Widget

**文件：**
- 修改：`mobile-app/lib/features/chat/widgets/message_bubble.dart`
- 测试：`mobile-app/test/features/chat/widgets/message_bubble_timeline_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/chat/widgets/message_bubble_timeline_test.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';
import 'package:spacecode_mobile/features/chat/widgets/message_bubble.dart';

void main() {
  testWidgets('legacy path renders content text when timelineEvents is null',
      (tester) async {
    const msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'hello world',
    );
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('hello world'), findsOneWidget);
  });

  testWidgets('timeline path renders text events in order', (tester) async {
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'beforeafter',
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'before',
        ),
        TimelineEvent(
          id: 'e2',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'after',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('before'), findsOneWidget);
    expect(find.text('after'), findsOneWidget);
  });

  testWidgets('timeline path renders toolCall card between text events',
      (tester) async {
    const toolCall = ToolCall(
      id: 'tc1',
      toolName: 'list_files',
      input: '{"path":"."}',
      output: 'file1.txt',
      status: ToolCallStatus.completed,
    );
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'beforeafter',
      toolCalls: const [toolCall],
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'before',
        ),
        TimelineEvent(
          id: 'e2',
          type: TimelineEventType.toolCall,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          toolCallId: 'tc1',
        ),
        TimelineEvent(
          id: 'e3',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'after',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );

    // 文本按顺序渲染
    expect(find.text('before'), findsOneWidget);
    expect(find.text('after'), findsOneWidget);
    // 工具调用卡片存在
    expect(find.text('list_files'), findsOneWidget);
  });

  testWidgets('user message always uses legacy path', (tester) async {
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.user,
      content: 'my question',
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'should not show',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('my question'), findsOneWidget);
    expect(find.text('should not show'), findsNothing);
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd mobile-app && flutter test test/features/chat/widgets/message_bubble_timeline_test.dart`
预期：FAIL，报错 timeline 路径未实现（"before"/"after" 文本找不到）。

- [ ] **步骤 3：编写实现代码**

修改 `mobile-app/lib/features/chat/widgets/message_bubble.dart`，整体替换为：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message.dart';
import '../models/timeline_event.dart';
import 'streaming_text.dart';
import 'thinking_block.dart';
import 'tool_call_card.dart';
import 'markdown_renderer.dart';

class MessageBubble extends ConsumerWidget {
  final ChatMessage message;

  const MessageBubble({
    super.key,
    required this.message,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isUser = message.role == MessageRole.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        padding: isUser ? const EdgeInsets.all(12) : EdgeInsets.zero,
        decoration: isUser
            ? const BoxDecoration(
                color: Color(0xffcc785c),
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(12),
                  topRight: Radius.circular(12),
                  bottomLeft: Radius.circular(12),
                  bottomRight: Radius.circular(4),
                ),
              )
            : const BoxDecoration(),
        child: isUser
            ? _buildUserContent(theme)
            : (!isUser && message.hasTimeline)
                ? _buildTimeline(theme)
                : _buildLegacyAssistant(theme),
      ),
    );
  }

  Widget _buildUserContent(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (message.content.isNotEmpty)
          Text(
            message.content,
            style: const TextStyle(
              color: Color(0xfffaf9f5),
              fontSize: 15,
              height: 1.6,
            ),
          ),
      ],
    );
  }

  /// 旧路径：thinking → content → toolCalls（向后兼容）。
  Widget _buildLegacyAssistant(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (message.thinkingContent != null &&
            message.thinkingContent!.isNotEmpty)
          ThinkingBlock(
            content: message.thinkingContent!,
            isStreaming: message.isStreaming,
          ),
        if (message.content.isNotEmpty)
          message.isStreaming
              ? StreamingText(
                  text: message.content,
                  isStreaming: message.isStreaming,
                )
              : MarkdownRenderer(
                  content: message.content,
                  isStreaming: message.isStreaming,
                )
        else if (message.isStreaming)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 12,
                height: 12,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '正在思考...',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        if (message.toolCalls != null && message.toolCalls!.isNotEmpty)
          ...message.toolCalls!.map((tc) => ToolCallCard(toolCall: tc)),
      ],
    );
  }

  /// 新路径：按 timelineEvents 顺序渲染。
  Widget _buildTimeline(ThemeData theme) {
    final events = message.timelineEvents!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (int i = 0; i < events.length; i++)
          _buildTimelineEvent(
            events[i],
            theme,
            isLast: i == events.length - 1,
          ),
      ],
    );
  }

  Widget _buildTimelineEvent(
    TimelineEvent event,
    ThemeData theme, {
    required bool isLast,
  }) {
    switch (event.type) {
      case TimelineEventType.text:
        final isRunning = message.isStreaming &&
            event.status == TimelineEventStatus.running;
        return _TimelineEntry(
          dotColor: _statusColor(event.status, theme),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: isRunning
              ? StreamingText(text: event.content ?? '')
              : MarkdownRenderer(content: event.content ?? ''),
        );
      case TimelineEventType.toolCall:
        final toolCall = message.toolCalls?.firstWhere(
          (tc) => tc.id == event.toolCallId,
          orElse: () => const ToolCall(
            id: '',
            toolName: 'unknown',
            input: '',
          ),
        );
        if (toolCall == null) {
          return const SizedBox.shrink();
        }
        return _TimelineEntry(
          dotColor: _statusColor(event.status, theme),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: ToolCallCard(toolCall: toolCall),
        );
      case TimelineEventType.reasoning:
        return _TimelineEntry(
          dotColor: theme.colorScheme.onSurface.withValues(alpha: 0.4),
          showLine: !isLast,
          lineColor: theme.colorScheme.onSurface.withValues(alpha: 0.15),
          child: ThinkingBlock(
            content: event.content ?? '',
            isStreaming: message.isStreaming &&
                event.status == TimelineEventStatus.running,
          ),
        );
      case TimelineEventType.metadata:
        // 元信息事件不渲染（暂不产生）
        return const SizedBox.shrink();
    }
  }

  Color _statusColor(TimelineEventStatus status, ThemeData theme) {
    switch (status) {
      case TimelineEventStatus.running:
      case TimelineEventStatus.pending:
        return theme.colorScheme.primary;
      case TimelineEventStatus.completed:
        return theme.colorScheme.primary;
      case TimelineEventStatus.error:
        return theme.colorScheme.error;
    }
  }
}

/// Timeline 单条目：左侧圆点 + 竖线 + 右侧内容。
class _TimelineEntry extends StatelessWidget {
  final Color dotColor;
  final bool showLine;
  final Color lineColor;
  final Widget child;

  const _TimelineEntry({
    required this.dotColor,
    required this.showLine,
    required this.lineColor,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 左侧装饰列：圆点 + 竖线
        SizedBox(
          width: 24,
          child: Column(
            children: [
              Container(
                width: 12,
                height: 12,
                margin: const EdgeInsets.only(top: 4),
                decoration: BoxDecoration(
                  color: dotColor,
                  shape: BoxShape.circle,
                ),
              ),
              if (showLine)
                Container(
                  width: 2,
                  height: 28,
                  color: lineColor,
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        // 右侧内容
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: child,
          ),
        ),
      ],
    );
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd mobile-app && flutter test test/features/chat/widgets/message_bubble_timeline_test.dart`
预期：PASS（4 个测试全通过）。

- [ ] **步骤 5：Commit**

```bash
cd mobile-app && git add lib/features/chat/widgets/message_bubble.dart test/features/chat/widgets/message_bubble_timeline_test.dart
git commit -m "feat(mobile): MessageBubble 双路径渲染支持 Agent Timeline 视觉"
```

---

## 任务 9：设置页 _CloneTaskCard + 接入 CloneNotifier

**文件：**
- 修改：`mobile-app/lib/features/settings/settings_screen.dart`

- [ ] **步骤 1：阅读现有设置页结构**

Read `mobile-app/lib/features/settings/settings_screen.dart`：
- 第 200-220 行：`_githubSettings(theme)` 调用位置
- 第 374-419 行：`_githubSettings` 方法体
- 第 440-495 行：`_cloneGithubRepository` 方法

- [ ] **步骤 2：修改 settings_screen.dart**

**2.1 新增 import**（顶部 import 区）：

```dart
import '../../core/github/clone_notifier.dart';
import '../../core/github/clone_progress.dart';
```

**2.2 修改 `_githubSettings` 方法**（约 374-419 行）：

在 "手动 Clone 仓库到本地" 按钮下方（原 `SizedBox(width: double.infinity, child: TextButton.icon(...))` 之后），新增一个 `Consumer` widget 监听 clone 状态：

将原方法体末尾的 `]` 之前新增：

```dart
          // Clone 任务进度/完成/错误显示
          Consumer(builder: (context, ref, _) {
            final cloneState = ref.watch(cloneProvider);
            if (cloneState.status == CloneStatus.idle) {
              return const SizedBox.shrink();
            }
            return _CloneTaskCard(state: cloneState);
          }),
```

完整的 `_githubSettings` 方法修改后大致结构：

```dart
  Widget _githubSettings(ThemeData theme) {
    final config = ref.watch(mobileConfigProvider);
    final connected = config.githubToken.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 原有 Row（连接/断开按钮）保持不变
            Row(...),
            const SizedBox(height: 8),
            // 原有"手动 Clone 仓库到本地"按钮保持不变
            SizedBox(
              width: double.infinity,
              child: TextButton.icon(
                onPressed: connected ? _cloneGithubRepository : null,
                icon: const Icon(Icons.download_outlined, size: 17),
                label: const Text('手动 Clone 仓库到本地'),
              ),
            ),
            // 新增：Clone 任务进度卡
            Consumer(builder: (context, ref, _) {
              final cloneState = ref.watch(cloneProvider);
              if (cloneState.status == CloneStatus.idle) {
                return const SizedBox.shrink();
              }
              return _CloneTaskCard(state: cloneState);
            }),
          ],
        ),
      ),
    );
  }
```

注意：实际实现时只需在现有 `_githubSettings` 方法的 `children` 数组末尾 `]` 之前插入 `Consumer` 即可，不要重写整个方法。

**2.3 简化 `_cloneGithubRepository` 方法**（约 440-495 行）：

整体替换为：

```dart
  Future<void> _cloneGithubRepository() async {
    final token = ref.read(mobileConfigProvider).githubToken;
    final service = GithubService(token: token);
    try {
      final repos = await service.listRepositories();
      if (!mounted) return;
      final repo = await showModalBottomSheet<GithubRepository>(
        context: context,
        builder: (sheetContext) => ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(16),
          children: [
            const Text('选择要 Clone 的仓库',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            ...repos.map((item) => ListTile(
                  title: Text(item.fullName),
                  subtitle: Text('默认分支：${item.defaultBranch}'),
                  onTap: () => Navigator.pop(sheetContext, item),
                )),
          ],
        ),
      );
      if (repo == null || !mounted) return;
      final branches = await service.listBranches(repo.fullName);
      if (!mounted) return;
      final branch = await showDialog<String>(
        context: context,
        builder: (dialogContext) => SimpleDialog(
          title: const Text('选择分支'),
          children: branches
              .map((item) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(dialogContext, item),
                    child: Text(item),
                  ))
              .toList(),
        ),
      );
      if (branch == null || !mounted) return;
      final target = await FilePicker.platform
          .getDirectoryPath(dialogTitle: '选择 Clone 目标目录');
      if (target == null || !mounted) return;

      // 交给后台 CloneNotifier，立即返回（不阻塞 UI）
      try {
        await ref.read(cloneProvider.notifier).startClone(
              repository: repo.fullName,
              branch: branch,
              targetDirectory: target,
            );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(error.message)));
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error.toString())));
      }
    } finally {
      service.dispose();
    }
  }
```

**2.4 新增 `_CloneTaskCard` 私有 Widget**（在 settings_screen.dart 文件末尾，最后一个 `}` 之前添加）：

```dart
class _CloneTaskCard extends ConsumerWidget {
  final CloneState state;

  const _CloneTaskCard({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      child: _buildContent(context, ref, theme),
    );
  }

  Widget _buildContent(BuildContext context, WidgetRef ref, ThemeData theme) {
    switch (state.status) {
      case CloneStatus.running:
        return _buildRunning(context, ref, theme);
      case CloneStatus.done:
        return _buildDone(context, ref, theme);
      case CloneStatus.error:
        return _buildError(context, ref, theme);
      case CloneStatus.idle:
        return const SizedBox.shrink();
    }
  }

  Widget _buildRunning(BuildContext context, WidgetRef ref, ThemeData theme) {
    final progress = state.progress;
    final phase = progress?.phase ?? ClonePhase.downloading;
    final percent = phase == ClonePhase.extracting
        ? progress?.extractPercent
        : progress?.downloadPercent;
    final label = phase == ClonePhase.extracting ? '解压中' : '下载中';
    final detail = phase == ClonePhase.extracting
        ? '文件 ${progress?.processedFiles ?? 0}/${progress?.totalFiles ?? '?'}'
        : '${_formatBytes(progress?.receivedBytes ?? 0)}'
            '/${progress?.totalBytes == null ? '?' : _formatBytes(progress!.totalBytes!)}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '$label：${state.repositoryName ?? ''}',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).cancel(),
              child: const Text('取消'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: percent,
          backgroundColor: theme.colorScheme.surface,
        ),
        const SizedBox(height: 4),
        Text(
          percent == null
              ? '$label中… ($detail)'
              : '$label ${(percent * 100).toStringAsFixed(0)}% ($detail)',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ],
    );
  }

  Widget _buildDone(BuildContext context, WidgetRef ref, ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.check_circle_rounded,
                color: const Color(0xff5db872), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${state.repositoryName ?? ''} 已克隆',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => _launchFileManager(state.resultPath),
              child: const Text('打开目录'),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).reset(),
              child: const Text('清除'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          '路径：${state.resultPath ?? ''}',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ],
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.error_rounded,
                color: const Color(0xffc64545), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${state.repositoryName ?? ''} 克隆失败',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).reset(),
              child: const Text('清除'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          state.errorMessage ?? '未知错误',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.error,
          ),
        ),
      ],
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _launchFileManager(String? path) async {
    if (path == null) return;
    // Android: 用 url_launcher 打开 content:// URI 不可靠，
    // 改为提示用户复制路径
    // 这里仅做最少实现：弹 SnackBar 提示路径已复制
    // 完整方案需引入 flutter_file_manager 或 platform channel，超出本次范围
    // ignore: unused_result
    await Clipboard.setData(ClipboardData(text: path));
  }
}
```

注意 `_launchFileManager` 使用 `Clipboard`，需要在文件顶部 import：

```dart
import 'package:flutter/services.dart';
```

检查文件顶部 import 区是否已存在 `import 'package:flutter/services.dart';`，若已存在则不要重复添加。

- [ ] **步骤 3：运行测试验证通过**

运行：`cd mobile-app && flutter analyze`
预期：No issues found。

运行：`cd mobile-app && flutter test`
预期：PASS（全部已有测试通过；UI 集成测试通过手动验证）。

- [ ] **步骤 4：Commit**

```bash
cd mobile-app && git add lib/features/settings/settings_screen.dart
git commit -m "feat(mobile): 设置页接入 CloneNotifier 显示后台 clone 进度与完成状态"
```

---

## 任务 10：全量验证 + APK 构建

**文件：** 无（验证任务）

- [ ] **步骤 1：运行全量 analyze**

运行：`cd mobile-app && flutter analyze`
预期：No issues found（或仅保留既有 info 级提示，无 error/warning）。

- [ ] **步骤 2：运行全量测试**

运行：`cd mobile-app && flutter test`
预期：全部测试 PASS。新增测试统计：
- `clone_progress_test.dart`：7 个
- `clone_notifier_test.dart`：5 个
- `github_service_clone_test.dart`：3 个
- `timeline_event_test.dart`：4 个
- `timeline_assembler_test.dart`：10 个
- `message_timeline_test.dart`：6 个
- `message_bubble_timeline_test.dart`：4 个

新增共 39 个测试，加上既有测试总数应 ≥ 149（前次基线 110）。

- [ ] **步骤 3：构建 debug APK**

运行：`cd mobile-app && flutter build apk --debug`
预期：构建成功，输出 `build/app/outputs/flutter-apk/app-debug.apk`。

- [ ] **步骤 4：安装到手机并手动验证**

运行：
```bash
$adb = "C:\Users\杨雅坤\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb install -r -d -t "d:\AI\SpaceCode\mobile-app\build\app\outputs\flutter-apk\app-debug.apk"
```
预期：安装成功（保留数据）。

手动验证清单：

**Clone 进度反馈**：
- [ ] 设置 → 连接 GitHub → 点击"手动 Clone 仓库到本地"
- [ ] 选择仓库、分支、目录后**立即返回设置页**（不阻塞）
- [ ] GitHub 分组下方出现 Clone 任务卡：转圈 + "下载中：user/repo"
- [ ] 进度条随下载进度增长，显示百分比和字节数
- [ ] 切换到其他页面再回到设置页，进度卡仍在更新（后台运行）
- [ ] 下载完毕后显示"解压中：x/y 文件"
- [ ] 完成后显示 ✅ "user/repo 已克隆" + 路径 + [打开目录] [清除]
- [ ] 点击 [取消] 任务中止，显示错误信息

**Agent Timeline**：
- [ ] 启动新会话，发送一个会触发工具调用的请求（如"列出当前目录文件"）
- [ ] LLM 输出文本 → 工具调用卡片 → LLM 继续输出文本，三者按时间顺序竖向排列
- [ ] 每个事件左侧有圆点 + 竖线连接
- [ ] 工具调用卡片不再被文字挤压到后面
- [ ] 历史会话（无 timelineEvents）仍按旧版样式渲染（thinking + content + toolCalls 顺序）

- [ ] **步骤 5：Commit 验证记录（可选）**

无需额外 commit；任务 1-9 的 commit 已涵盖全部代码变更。

---

## 自检

### 1. 规格覆盖度

| 规格章节 | 任务 |
|---------|------|
| 2.2 CloneProgress 数据模型 | 任务 1 ✅ |
| 2.3 CloneState + CloneNotifier | 任务 5 ✅ |
| 2.4 GithubService.cloneRepository 改造 | 任务 4 ✅ |
| 2.5 设置页 UI 改造 | 任务 9 ✅ |
| 2.6 影响调用点（chat_controller + skill_installer） | 任务 4（临时） + 任务 7（最终）✅ |
| 3.2 TimelineEvent 数据模型 | 任务 2 ✅ |
| 3.3 ChatMessage 扩展 | 任务 6 ✅ |
| 3.4 TimelineAssembler | 任务 3 ✅ |
| 3.5 ChatController 改造 | 任务 7 ✅ |
| 3.6 渲染层 | 任务 8 ✅ |
| 3.7 Timeline 视觉组件 | 任务 8 ✅ |
| 3.8 持久化与兼容 | 任务 6 ✅ |
| 4.1 Clone Progress 测试 | 任务 1、4、5 ✅ |
| 4.2 Timeline 测试 | 任务 2、3、6、8 ✅ |

无遗漏。

### 2. 占位符扫描

搜索计划文本中的红旗模式：无 TODO、无"待定"、无"类似任务 N"、无"添加适当的错误处理"。所有代码步骤均包含完整代码块。

### 3. 类型一致性

- `CloneProgress` 在任务 1/4/5/9 中属性名一致：`phase`、`receivedBytes`、`totalBytes`、`processedFiles`、`totalFiles`、`errorMessage`、`resultPath`
- `CloneState` 在任务 5/9 中属性名一致：`status`、`progress`、`resultPath`、`errorMessage`、`repositoryName`
- `CloneNotifier` 方法名一致：`startClone`、`cancel`、`reset`
- `TimelineEvent` 在任务 2/3/6/7/8 中属性名一致：`id`、`type`、`timestamp`、`status`、`content`、`toolCallId`、`metadata`
- `TimelineAssembler` 在任务 3/7 中方法名一致：`appendTextDelta`、`appendReasoningDelta`、`addToolCall`、`completeToolCall`、`completeTurn`、`events`
- `cloneProvider` / `cloneServiceFactoryProvider` 在任务 5/9 中一致
- `ChatMessage.timelineEvents` / `hasTimeline` 在任务 6/7/8 中一致

无类型不一致。

### 4. 已知风险与缓解

- 任务 5 测试中 `_StubConfig extends MobileConfig` 可能因 `MobileConfig` 不允许子类化失败：缓解方式为先 Read mobile_config.dart 确认构造函数签名，若不可子类化则直接用 `MobileConfig(...)` 构造并 `overrideWithValue`。子代理执行任务 5 时应先做此检查。
- 任务 7 的 `_handleLocalAgentEvent` 改造涉及 `AgentEventType.assistantDelta` 的 `event.delta` 字段，需确认 `AgentEvent` 数据类的字段名（Read `core/agent/agent_types.dart`）。
- 任务 9 的 `_launchFileManager` 实现为剪贴板复制路径（最少实现），完整方案需要 platform channel 调用 Android 文件管理器 Intent，超出本次范围。

无阻塞性问题，子代理可在执行时自行解决上述小问题。

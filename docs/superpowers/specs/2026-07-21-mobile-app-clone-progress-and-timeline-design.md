# 移动端 Clone 进度反馈与 Agent Timeline 设计规格

## 1. 背景与目标

SpaceCode 手机端存在两个体验问题需要优化：

### 问题 1：GitHub Clone 仓库无进度反馈

用户在设置页连接 GitHub 后点击"手动 Clone 仓库到本地"，选择目录后直接返回设置页：
- 整个 clone 期间 UI 完全静默（无 loading、无进度条、无状态文字）
- 大仓库下载耗时几十秒到数分钟，用户感知"卡住"
- clone 完成仅弹短时 SnackBar，信息易被错过
- 退出设置页后无法查看 clone 状态

底层 `GithubService.cloneRepository()` 用 `http.Response.bodyBytes` 一次性 await 整包再解压，不暴露进度 Stream；已支持取消（`abortTrigger` + `isCancelled`）但前端未接入。

### 问题 2：聊天工具调用卡片被文字挤压

LLM 调用工具时，工具调用卡片被 LLM 输出的 response 文字挤压到后面，而非 Agent Timeline 形式。

根因：
- 一次 assistant turn 被压成一条 `ChatMessage`，所有文本累加到 `content` 单一字符串，所有工具调用累加到平铺 `toolCalls` 列表，丢失时间交错信息
- `MessageBubble.build()` 硬编码渲染顺序为 `content → toolCalls`，卡片永远在文本下方

### 目标

1. **Clone 进度**：真实进度条（下载百分比 + 解压百分比），后台运行，设置页可查看进度，退出设置页不中断任务，单任务串行
2. **Agent Timeline**：按时间顺序排列 text/toolCall/reasoning 事件，复刻桌面端 AgentTimeline 视觉，历史会话向后兼容

## 2. 优化 1：GitHub Clone 后台进度

### 2.1 架构

将 clone 从设置页方法提升为 Riverpod 后台 StateNotifier，生命周期独立于页面：

```
设置页 UI ←→ CloneNotifier (StateNotifier)
                  ↓
           GithubService.cloneRepository() → Stream<CloneProgress>
                  ↓
           HTTP streaming + zip 解压（实时发进度）
```

### 2.2 数据模型

**新建** `mobile-app/lib/core/github/clone_progress.dart`：

```dart
enum ClonePhase { downloading, extracting, done, error }

class CloneProgress {
  final ClonePhase phase;
  final int receivedBytes;
  final int? totalBytes;        // 来自 Content-Length，可能为 null
  final int processedFiles;
  final int? totalFiles;        // 解压阶段从 archive 获取
  final String? errorMessage;
  final String? resultPath;     // done 阶段的产物路径

  double? get downloadPercent =>
      totalBytes == null || totalBytes == 0
          ? null
          : receivedBytes / totalBytes!;
  double? get extractPercent =>
      totalFiles == null || totalFiles == 0
          ? null
          : processedFiles / totalFiles!;

  // 构造函数、copyWith、fromJson、toJson
}
```

### 2.3 CloneState + CloneNotifier

**新建** `mobile-app/lib/core/github/clone_notifier.dart`：

```dart
enum CloneStatus { idle, running, done, error }

class CloneState {
  final CloneStatus status;
  final CloneProgress? progress;    // running 时的最新进度
  final String? resultPath;         // done 时的产物路径
  final String? errorMessage;       // error 时
  final String? repositoryName;     // 当前任务仓库名

  static const idle = CloneState(
    status: CloneStatus.idle,
    progress: null,
    resultPath: null,
    errorMessage: null,
    repositoryName: null,
  );

  // copyWith
}

class CloneNotifier extends StateNotifier<CloneState> {
  final Ref _ref;

  CloneNotifier(this._ref) : super(CloneState.idle);

  /// 启动后台 clone 任务。若已有任务运行中，抛 StateError。
  Future<void> startClone({
    required String repository,
    required String branch,
    required String targetDirectory,
  });

  /// 取消当前任务
  Future<void> cancel();

  /// 清除完成/错误状态，回到 idle
  void reset();
}

final cloneProvider = StateNotifierProvider<CloneNotifier, CloneState>((ref) {
  return CloneNotifier(ref);
});
```

**关键行为**：
- `startClone` 若 `state.status == running` 抛 `StateError('已有 clone 任务运行中')`
- token 来源：`_ref.read(mobileConfigProvider).githubToken`（与设置页 `_cloneGithubRepository` 原逻辑一致）；若 token 为空抛 `StateError('未连接 GitHub')`
- 在 `startClone` 内部创建 `GithubService(token: token)` 实例（任务完成后 `dispose`）
- 内部创建 `Completer<void>` 作为 abortTrigger，`cancel()` 调用 `completer.complete()`
- `isCancelled` 回调返回内部 `_cancelled` 布尔标志；`cancel()` 同时置 `_cancelled = true` 并 `completer.complete()`，两者分别用于解压循环同步检查与 HTTP 请求异步中止
- 消费 `cloneRepository` 返回的 Stream，每个 `CloneProgress` 更新 state
- 完成后 state 变为 `done`（保留 `resultPath`），错误时变为 `error`（保留 `errorMessage`），finally 中 `service.dispose()`
- 后台运行：StateNotifier 持有任务 Future，不依赖设置页 Widget 生命周期

### 2.4 GithubService.cloneRepository 改造

**修改** `mobile-app/lib/core/github/github_service.dart`：

签名从 `Future<void>` 改为 `Stream<CloneProgress>`：

```dart
Stream<CloneProgress> cloneRepository({
  required String repository,
  required String branch,
  required String targetDirectory,
  Future<void>? abortTrigger,
  bool Function()? isCancelled,
}) async* {
  // 1. 用 http.Client.send 拿 StreamedResponse
  final request = http.Request('GET', Uri.parse(zipballUrl));
  _addAuthHeaders(request);
  final client = http.Client();
  final response = await client.send(request);

  if (response.statusCode != 200) {
    client.close();
    yield CloneProgress(
      phase: ClonePhase.error,
      receivedBytes: 0,
      processedFiles: 0,
      errorMessage: 'HTTP ${response.statusCode}',
    );
    return;
  }

  final totalBytes = int.tryParse(
      response.headers['content-length'] ?? '');

  // 2. 流式读取，累计 receivedBytes，定期 yield 下载进度
  final bytes = <int>[];
  await for (final chunk in response.stream) {
    if (isCancelled?.call() == true) {
      client.close();
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
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
  client.close();

  // 3. 解压：遍历 archive，每 N 个文件 yield 一次进度
  final archive = ZipDecoder().decodeBytes(bytes);
  final totalFiles = archive.length;
  var processed = 0;
  for (final file in archive) {
    if (isCancelled?.call() == true) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: bytes.length,
        processedFiles: processed,
        totalFiles: totalFiles,
        errorMessage: '已取消',
      );
      return;
    }
    // 写文件到 targetDirectory（复用现有逻辑）
    _writeArchiveFile(file, targetDirectory);
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

  // 4. 完成
  yield CloneProgress(
    phase: ClonePhase.done,
    receivedBytes: bytes.length,
    totalBytes: totalBytes,
    processedFiles: totalFiles,
    totalFiles: totalFiles,
    resultPath: targetDirectory,
  );
}
```

**进度更新频率**：
- 下载阶段：每个 chunk 都 yield（chunk 大小通常 16-64KB，频率合适）
- 解压阶段：每 5 个文件 yield 一次（避免小文件场景下 yield 过于频繁）

### 2.5 设置页 UI 改造

**修改** `mobile-app/lib/features/settings/settings_screen.dart`：

`_cloneGithubRepository()` 方法简化为：
1. 读取 token、选仓库、选分支、选目录（保持现有逻辑）
2. 调用 `ref.read(cloneProvider.notifier).startClone(...)`
3. 不再 `await` clone 完成（后台运行，立即返回）
4. 不再显示 SnackBar（进度由设置页的 Clone 任务区域显示）

设置页 GitHub 分组下方新增"Clone 任务"区域（仅在 `state.status != idle` 时显示）：

```dart
// 在 GitHub 设置分组下方
Consumer(builder: (context, ref, _) {
  final cloneState = ref.watch(cloneProvider);
  if (cloneState.status == CloneStatus.idle) {
    return const SizedBox.shrink();
  }
  return _CloneTaskCard(state: cloneState);
}),
```

**新建** `_CloneTaskCard` Widget（settings_screen.dart 内私有 Widget）：

- **running** 状态：
  - 显示仓库名 `cloneState.repositoryName`
  - 下载阶段：进度条 + 百分比 + `receivedBytes/totalBytes`（MB）
  - 解压阶段：进度条 + `processedFiles/totalFiles`
  - [取消] 按钮 → `ref.read(cloneProvider.notifier).cancel()`
- **done** 状态：
  - ✅ 图标 + "{repo} 已克隆"
  - 路径: `{resultPath}`
  - [在文件管理器中打开]（用 `url_launcher`）+ [清除] 按钮
- **error** 状态：
  - ❌ 图标 + "克隆失败"
  - 错误信息（`errorMessage`，可滚动）
  - [清除] 按钮

### 2.6 影响调用点

`cloneRepository` 签名变更影响 2 个调用点：

1. **`chat_controller.dart:340`**：改为消费 Stream，仍用虚拟 ToolCallCard 反馈
   - 开始时推送 `toolExecutionStart` 事件
   - 监听 Stream，在最后一条 progress 时推送 `toolExecutionEnd`
   - 中间进度可忽略（或更新 toolCall 的 output 字段）

2. **`skill_installer.dart:94`**：改为消费 Stream
   - `await for (final p in service.cloneRepository(...))` 直到 `p.phase == done`
   - 忽略中间进度（技能安装无需进度反馈）

## 3. 优化 2：Agent Timeline

### 3.1 架构

新增 `TimelineEvent` 模型 + `TimelineAssembler`，在 controller 层按时间顺序记录事件流，渲染层遍历 `timelineEvents` 按 type 分发到对应 Widget。

### 3.2 数据模型

**新建** `mobile-app/lib/features/chat/models/timeline_event.dart`：

```dart
enum TimelineEventType { reasoning, text, toolCall, metadata }

enum TimelineEventStatus { pending, running, completed, error }

class TimelineEvent {
  final String id;
  final TimelineEventType type;
  final DateTime timestamp;
  final TimelineEventStatus status;
  final String? content;       // text/reasoning 的内容
  final String? toolCallId;    // toolCall 类型时关联的 ToolCall.id
  final Map<String, dynamic>? metadata;  // metadata 类型（模型/token/耗时）

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
  });

  Map<String, dynamic> toJson();
  factory TimelineEvent.fromJson(Map<String, dynamic> json);
}
```

### 3.3 ChatMessage 扩展

**修改** `mobile-app/lib/features/chat/models/message.dart`：

```dart
class ChatMessage {
  // 既有字段保留（向后兼容）...
  final String content;
  final List<ToolCall>? toolCalls;
  final String? thinkingContent;
  
  // 新增字段
  final List<TimelineEvent>? timelineEvents;  // null = 旧会话
  
  bool get hasTimeline =>
      timelineEvents != null && timelineEvents!.isNotEmpty;
}
```

`toJson` / `fromJson` 增加 `timelineEvents` 序列化；旧数据无此字段时 `timelineEvents = null`。

### 3.4 TimelineAssembler（核心装配逻辑）

**新建** `mobile-app/lib/features/chat/timeline_assembler.dart`：

```dart
class TimelineAssembler {
  final List<TimelineEvent> _events = [];
  String? _currentTextEventId;   // 当前未关闭的 text 事件
  String? _currentReasoningEventId;

  List<TimelineEvent> get events => List.unmodifiable(_events);

  /// 流式文本 delta 到达
  void appendTextDelta(String delta) {
    if (_currentTextEventId == null) {
      _currentTextEventId = _uuid();
      _events.add(TimelineEvent(
        id: _currentTextEventId!,
        type: TimelineEventType.text,
        timestamp: DateTime.now(),
        status: TimelineEventStatus.running,
        content: '',
      ));
    }
    final idx = _events.indexWhere((e) => e.id == _currentTextEventId);
    _events[idx] = _events[idx].copyWith(
      content: _events[idx].content! + delta,
    );
  }

  /// 工具调用开始：先关闭当前 text 事件
  void addToolCall(ToolCall toolCall) {
    _completeCurrentTextEvent();
    _events.add(TimelineEvent(
      id: _uuid(),
      type: TimelineEventType.toolCall,
      timestamp: DateTime.now(),
      status: TimelineEventStatus.running,
      toolCallId: toolCall.id,
    ));
  }

  /// 工具结果到达：更新对应事件状态
  void completeToolCall(String toolCallId, ToolCallStatus status) {
    final idx = _events.indexWhere((e) =>
        e.type == TimelineEventType.toolCall &&
        e.toolCallId == toolCallId);
    if (idx >= 0) {
      _events[idx] = _events[idx].copyWith(
        status: status == ToolCallStatus.completed
            ? TimelineEventStatus.completed
            : TimelineEventStatus.error,
      );
    }
  }

  /// 思考过程 delta
  void appendReasoningDelta(String delta) {
    // 同 appendTextDelta 但 type=reasoning，使用 _currentReasoningEventId
  }

  /// turn 结束：关闭所有未完成事件
  void completeTurn() {
    _completeCurrentTextEvent();
    _completeCurrentReasoningEvent();
  }

  void _completeCurrentTextEvent() {
    if (_currentTextEventId != null) {
      final idx = _events.indexWhere((e) => e.id == _currentTextEventId);
      if (idx >= 0 && _events[idx].status == TimelineEventStatus.running) {
        // 空内容事件直接移除（避免渲染空气泡）
        if (_events[idx].content!.isEmpty) {
          _events.removeAt(idx);
        } else {
          _events[idx] = _events[idx].copyWith(
              status: TimelineEventStatus.completed);
        }
      }
      _currentTextEventId = null;
    }
  }

  String _uuid() => DateTime.now().microsecondsSinceEpoch.toString();
}
```

**核心设计**：工具调用开始时 `_completeCurrentTextEvent()` 关闭当前 text 事件 → LLM 工具调用后继续输出文本会创建**新的** text 事件 → 自然形成时间顺序。

### 3.5 ChatController 改造

**修改** `mobile-app/lib/features/chat/chat_controller.dart`：

- 每个 assistant turn 维护一个 `TimelineAssembler` 实例（在 turn 开始时创建）
- `_handleStreamEvent(delta)`：`_assembler.appendTextDelta(delta)` → 更新对应 `ChatMessage.timelineEvents`
- `_handleToolUse(toolCall)`：`_assembler.addToolCall(toolCall)`（仍把 toolCall 追加到 `message.toolCalls` 供 ToolCallCard 查找）
- `_handleToolResult(toolUseId, status)`：`_assembler.completeToolCall(toolUseId, status)`
- `_handleResult()`：`_assembler.completeTurn()` → 最终更新 `ChatMessage.timelineEvents = _assembler.events`
- 持久化时序列化 `timelineEvents`；旧数据反序列化时 `timelineEvents = null` 触发回退渲染

**状态同步**：每次 assembler 变化后，调用 `_updateMessage(messageId, (msg) => msg.copyWith(timelineEvents: assembler.events))` 触发 UI 刷新。

### 3.6 渲染层

**修改** `mobile-app/lib/features/chat/widgets/message_bubble.dart`：

```dart
@override
Widget build(BuildContext context) {
  if (message.hasTimeline) {
    return _buildTimeline(message);   // 新路径：按 timelineEvents 渲染
  }
  return _buildLegacy(message);       // 旧路径：content + toolCalls（向后兼容）
}

Widget _buildLegacy(ChatMessage message) {
  // 原有逻辑：ThinkingBlock → content → toolCalls
}

Widget _buildTimeline(ChatMessage message) {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (int i = 0; i < message.timelineEvents!.length; i++)
        _buildTimelineEvent(
          message.timelineEvents![i],
          message,
          isLast: i == message.timelineEvents!.length - 1,
        ),
    ],
  );
}

Widget _buildTimelineEvent(TimelineEvent event, ChatMessage message,
    {required bool isLast}) {
  switch (event.type) {
    case TimelineEventType.text:
      return _TimelineEntry(
        dotColor: theme.primary,
        isLast: isLast,
        child: message.isStreaming && event.status == TimelineEventStatus.running
            ? StreamingText(text: event.content!)
            : MarkdownRenderer(data: event.content!),
      );
    case TimelineEventType.toolCall:
      final toolCall = message.toolCalls!.firstWhere(
        (tc) => tc.id == event.toolCallId,
      );
      return _TimelineEntry(
        dotColor: _statusColor(event.status),
        isLast: isLast,
        child: ToolCallCard(toolCall: toolCall),
      );
    case TimelineEventType.reasoning:
      return _TimelineEntry(
        dotColor: theme.disabledColor,
        isLast: isLast,
        child: ThinkingBlock(content: event.content!),
      );
    case TimelineEventType.metadata:
      return _MetadataChip(metadata: event.metadata!);  // 不带 timeline 装饰
  }
}
```

### 3.7 Timeline 视觉组件

**新建** `_TimelineEntry` Widget（`message_bubble.dart` 内私有 Widget）：

```
●  text 事件（Markdown 内容）
│
●  toolCall 事件（ToolCallCard）
│
●  text 事件（工具结果后的新文本）
│
●  reasoning 事件（折叠的思考块）
```

实现：
- `Row` 布局：左侧固定宽度 24px 的 `Column`（dot + line），右侧 `Expanded(child: content)`
- 圆点：`Container(width: 12, height: 12, decoration: BoxDecoration(shape: circle, color: dotColor))`
- 竖线：`Container(width: 2, color: theme.dividerColor)`（`isLast` 时不显示）
- 圆点颜色按 status：`running=primary`、`completed=primary`、`error=colorScheme.error`
- 右侧内容 `padding: EdgeInsets.only(bottom: 12)` 形成事件间距

### 3.8 持久化与兼容

`ChatMessage.toJson`：
```dart
final json = {
  ...,
  if (timelineEvents != null)
    'timelineEvents': timelineEvents!.map((e) => e.toJson()).toList(),
};
```

`ChatMessage.fromJson`：
```dart
timelineEvents: json['timelineEvents'] != null
    ? (json['timelineEvents'] as List)
        .map((e) => TimelineEvent.fromJson(e as Map<String, dynamic>))
        .toList()
    : null,  // null 触发回退渲染
```

旧会话（无 `timelineEvents` 字段）自动走 `_buildLegacy` 路径。

## 4. 测试策略

### 4.1 Clone Progress 测试

**新建** `test/core/github/clone_progress_test.dart`：
- `CloneProgress.downloadPercent` 计算（含 totalBytes 为 null 的边界）
- `CloneProgress.extractPercent` 计算
- `fromJson` / `toJson` 往返

**新建** `test/core/github/clone_notifier_test.dart`：
- `startClone` 在 idle 时启动任务
- `startClone` 在 running 时抛 StateError
- `cancel` 后 state 变为 error（含"已取消"信息）
- `reset` 后 state 变为 idle
- 任务完成时 state 变为 done（含 resultPath）

**新建** `test/core/github/github_service_clone_test.dart`：
- mock HTTP streaming，验证下载进度 yield 频率
- mock zip 数据，验证解压进度 yield
- 验证取消行为

### 4.2 Timeline 测试

**新建** `test/features/chat/models/timeline_event_test.dart`：
- `fromJson` / `toJson` 往返
- `copyWith` 不修改原对象

**新建** `test/features/chat/timeline_assembler_test.dart`：
- 单 text 事件流式追加
- text → toolCall → text 交错（验证时间顺序）
- 空内容 text 事件被移除
- toolCall 状态更新
- `completeTurn` 关闭所有未完成事件

**新建** `test/features/chat/widgets/message_bubble_timeline_test.dart`：
- 新会话按 `timelineEvents` 渲染（找到所有 _TimelineEntry）
- 旧会话回退渲染（无 `timelineEvents` 字段时走 legacy 路径）
- 流式 text 事件显示 StreamingText
- toolCall 事件找到对应 ToolCallCard

## 5. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| `cloneRepository` 签名变更影响 chat_controller 和 skill_installer | 两处调用点同步改造，保持消费 Stream 直至完成 |
| TimelineAssembler 在 turn 边界处理错误（如工具结果延迟到达） | `_handleToolResult` 允许在 `completeTurn` 后仍更新状态（向后查找） |
| 旧会话持久化数据无 timelineEvents | `fromJson` 时 `timelineEvents = null`，渲染层走 `_buildLegacy` 回退路径 |
| HTTP streaming 在某些代理下不返回 Content-Length | `totalBytes` 为 null 时进度条显示"下载中"无百分比 |
| Clone 后台任务被 OS 杀进程 | 不持久化 clone 状态（重启后回到 idle），用户需手动重新 clone（符合最小实现） |

## 6. 不在范围内

以下事项不在本次优化范围：
- 项目目录浏览页（clone 完成后只显示路径，不跳转浏览）
- 多任务并行 clone（单任务串行）
- Clone 任务持久化（重启后不恢复）
- metadata 事件的生成（仅定义类型，不在 controller 主动产生）
- 桌面端 Timeline 装配器的 1:1 移植（移动端按需实现核心子集）

## 7. 文件清单

### 新建文件

| 路径 | 职责 |
|------|------|
| `mobile-app/lib/core/github/clone_progress.dart` | CloneProgress 数据模型 |
| `mobile-app/lib/core/github/clone_notifier.dart` | CloneNotifier + CloneState + Riverpod provider |
| `mobile-app/lib/features/chat/models/timeline_event.dart` | TimelineEvent 数据模型 |
| `mobile-app/lib/features/chat/timeline_assembler.dart` | Timeline 装配器 |
| `mobile-app/test/core/github/clone_progress_test.dart` | CloneProgress 测试 |
| `mobile-app/test/core/github/clone_notifier_test.dart` | CloneNotifier 测试 |
| `mobile-app/test/core/github/github_service_clone_test.dart` | GithubService.cloneRepository 测试 |
| `mobile-app/test/features/chat/models/timeline_event_test.dart` | TimelineEvent 测试 |
| `mobile-app/test/features/chat/timeline_assembler_test.dart` | TimelineAssembler 测试 |
| `mobile-app/test/features/chat/widgets/message_bubble_timeline_test.dart` | MessageBubble Timeline 渲染测试 |

### 修改文件

| 路径 | 修改内容 |
|------|---------|
| `mobile-app/lib/core/github/github_service.dart` | `cloneRepository` 改为返回 `Stream<CloneProgress>`，用 HTTP streaming + 解压进度 |
| `mobile-app/lib/features/settings/settings_screen.dart` | `_cloneGithubRepository` 改为调用 CloneNotifier；新增 `_CloneTaskCard` Widget |
| `mobile-app/lib/features/chat/models/message.dart` | 新增 `timelineEvents` 字段 + 序列化 |
| `mobile-app/lib/features/chat/chat_controller.dart` | 事件处理改用 TimelineAssembler；clone 调用改为消费 Stream |
| `mobile-app/lib/features/chat/widgets/message_bubble.dart` | 双路径渲染（timeline / legacy）+ `_TimelineEntry` Widget |
| `mobile-app/lib/core/skills/skill_installer.dart` | `cloneRepository` 调用改为消费 Stream |

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/protocol/protocol.dart';
import '../../core/connection/connection_service.dart';
import '../../core/storage/chat_history_storage.dart';
import 'models/message.dart';
import 'models/tool_call.dart';
import 'models/permission_request.dart';

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  return ChatNotifier(ref);
});

class ChatState {
  final String? currentSessionId;
  final List<ChatMessage> messages;
  final List<PermissionRequest> pendingPermissions;
  final bool isLoading;
  final String? currentAgent;
  /// 桌面端当前激活会话的项目目录，由 session_changed 推送更新
  final String? projectPath;
  /// 所有历史会话索引（不含消息体），用于 SessionsScreen 列表
  final List<SessionSummary> sessions;
  /// 历史是否已加载完成（启动时从 SharedPreferences 异步加载）
  final bool historyLoaded;

  const ChatState({
    this.currentSessionId,
    this.messages = const [],
    this.pendingPermissions = const [],
    this.isLoading = false,
    this.currentAgent,
    this.projectPath,
    this.sessions = const [],
    this.historyLoaded = false,
  });

  ChatState copyWith({
    String? currentSessionId,
    List<ChatMessage>? messages,
    List<PermissionRequest>? pendingPermissions,
    bool? isLoading,
    String? currentAgent,
    String? projectPath,
    List<SessionSummary>? sessions,
    bool? historyLoaded,
  }) => ChatState(
    currentSessionId: currentSessionId ?? this.currentSessionId,
    messages: messages ?? this.messages,
    pendingPermissions: pendingPermissions ?? this.pendingPermissions,
    isLoading: isLoading ?? this.isLoading,
    currentAgent: currentAgent ?? this.currentAgent,
    projectPath: projectPath ?? this.projectPath,
    sessions: sessions ?? this.sessions,
    historyLoaded: historyLoaded ?? this.historyLoaded,
  );
}

class ChatNotifier extends StateNotifier<ChatState> {
  final Ref _ref;
  final _uuid = const Uuid();
  final _storage = ChatHistoryStorage();
  StreamSubscription? _subscription;
  // 防抖保存：连续追加流式 delta 时只在停顿 500ms 后写一次盘
  Timer? _persistTimer;

  ChatNotifier(this._ref) : super(const ChatState()) {
    _subscription =
        _ref.read(connectionProvider.notifier).messages.listen(_handlePush);
    _loadHistory();
  }

  /// 启动时从 SharedPreferences 加载历史会话列表 + 上次未关闭的当前会话消息
  Future<void> _loadHistory() async {
    final data = await _storage.loadAll();
    if (data.sessions.isEmpty) {
      state = state.copyWith(sessions: [], historyLoaded: true);
      return;
    }

    // 自动恢复上次激活的会话（若有）
    final currentId = data.currentSessionId ?? data.sessions.first.id;
    final messages = await _storage.loadMessages(currentId);
    final currentSummary = data.sessions.firstWhere(
      (s) => s.id == currentId,
      orElse: () => data.sessions.first,
    );

    state = state.copyWith(
      currentSessionId: currentId,
      messages: messages,
      sessions: data.sessions,
      projectPath: currentSummary.projectPath,
      historyLoaded: true,
    );
  }

  void _handlePush(MobilePush push) {
    switch (push.type) {
      case PushType.streamEvent:
        _handleStreamEvent(push.data);
        break;
      case PushType.assistant:
        _handleAssistant(push.data);
        break;
      case PushType.toolUse:
        _handleToolUse(push.data);
        break;
      case PushType.toolResult:
        _handleToolResult(push.data);
        break;
      case PushType.permissionRequest:
        _handlePermissionRequest(push.data);
        break;
      case PushType.result:
        _handleResult(push.data);
        break;
      case PushType.sessionChanged:
        _handleSessionChanged(push.data);
        break;
      default:
        break;
    }
  }

  void sendMessage(String content) {
    final sessionId = state.currentSessionId ?? _uuid.v4();
    if (state.currentSessionId == null) {
      state = state.copyWith(currentSessionId: sessionId);
    }
    final userMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.user,
      content: content,
    );
    state = state.copyWith(
      messages: [...state.messages, userMsg],
      isLoading: true,
    );
    final assistantMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.assistant,
      isStreaming: true,
    );
    state = state.copyWith(messages: [...state.messages, assistantMsg]);
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.sendMessage,
          data: {
            'sessionId': sessionId,
            'content': content,
            'images': [],
          },
        ));
    _schedulePersist();
  }

  void _handleStreamEvent(Map<String, dynamic>? data) {
    if (data == null) return;
    final delta = data['delta'] as String? ?? '';
    if (delta.isEmpty) return;

    final messages = List<ChatMessage>.from(state.messages);

    // 若最后一条 assistant message 已完成（isStreaming=false，说明上一轮 assistant
    // 事件已处理），创建新 message 容纳本轮流式输出。
    // 这样每轮 LLM 响应对应一条独立 message，工具卡片不会被子后续文字挤压，
    // 参考桌面端 AgentTimeline 按事件时序渲染的方式。
    final bool needNewMessage = messages.isEmpty ||
        messages.last.role != MessageRole.assistant ||
        !messages.last.isStreaming;

    if (needNewMessage) {
      final newMsg = ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.assistant,
        content: delta,
        isStreaming: true,
      );
      state = state.copyWith(messages: [...messages, newMsg]);
    } else {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: last.content + delta,
      );
      state = state.copyWith(messages: messages);
    }
    _schedulePersist();
  }

  void _handleAssistant(Map<String, dynamic>? data) {
    if (data == null) return;
    final message = data['message'] as Map<String, dynamic>?;
    if (message == null) return;
    final content = message['content'];

    String text = '';
    String? thinking;
    List<ToolCall> toolCalls = [];

    if (content is List) {
      for (final item in content) {
        if (item is! Map<String, dynamic>) continue;
        final itemType = item['type'];
        if (itemType == 'text') {
          text += (item['text'] as String?) ?? '';
        } else if (itemType == 'thinking') {
          thinking = (item['thinking'] as String?) ?? (item['text'] as String?) ?? '';
        } else if (itemType == 'tool_use') {
          toolCalls.add(ToolCall(
            id: (item['id'] as String?) ?? '',
            toolName: (item['name'] as String?) ?? '',
            input: item['input']?.toString() ?? '',
          ));
        }
      }
    } else if (content is String) {
      text = content;
    }

    final messages = List<ChatMessage>.from(state.messages);

    // assistant 事件是「一轮 LLM 响应结束」的信号（包含完整 text 和 tool_use）。
    // 若最后一条 assistant message 已完成（上一轮 assistant 事件已处理过），
    // 必须创建新 message——否则本轮内容会拼到上一条末尾，丢失时序信息，
    // 导致工具卡片被后续文字挤压到列表末尾。
    final bool needNewMessage = messages.isEmpty ||
        messages.last.role != MessageRole.assistant ||
        !messages.last.isStreaming;

    if (needNewMessage) {
      final newMsg = ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.assistant,
        content: text,
        thinkingContent: thinking,
        toolCalls: toolCalls.isEmpty ? null : toolCalls,
        isStreaming: false,
      );
      state = state.copyWith(messages: [...messages, newMsg]);
    } else {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: text.isEmpty ? last.content : text,
        thinkingContent: thinking ?? last.thinkingContent,
        toolCalls: toolCalls.isEmpty ? last.toolCalls : toolCalls,
        isStreaming: false,
      );
      state = state.copyWith(messages: messages);
    }
    _schedulePersist();
  }

  void _handleToolUse(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolCall = ToolCall(
      id: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
      final last = messages.last;
      final toolCalls = List<ToolCall>.from(last.toolCalls ?? [])..add(toolCall);
      messages[messages.length - 1] = last.copyWith(toolCalls: toolCalls);
      state = state.copyWith(messages: messages);
    }
    _schedulePersist();
  }

  void _handleToolResult(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolUseId = data['toolUseId'] as String? ?? '';
    final output = data['output']?.toString() ?? '';
    final messages = List<ChatMessage>.from(state.messages);
    for (int i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.toolCalls != null) {
        final toolCalls = msg.toolCalls!
            .map((tc) => tc.id == toolUseId
                ? tc.copyWith(output: output, status: ToolCallStatus.completed)
                : tc)
            .toList();
        messages[i] = msg.copyWith(toolCalls: toolCalls);
        break;
      }
    }
    state = state.copyWith(messages: messages);
    _schedulePersist();
  }

  void _handlePermissionRequest(Map<String, dynamic>? data) {
    if (data == null) return;
    final request = PermissionRequest(
      sessionId: data['sessionId'] as String? ?? '',
      toolUseId: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    state = state.copyWith(
        pendingPermissions: [...state.pendingPermissions, request]);
  }

  void _handleResult(Map<String, dynamic>? data) {
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.isStreaming) {
      messages[messages.length - 1] =
          messages.last.copyWith(isStreaming: false);
    }
    state = state.copyWith(messages: messages, isLoading: false);
    _schedulePersist();
  }

  /// 桌面端推送 session_changed 事件：更新当前项目目录，让 AppBar 显示
  void _handleSessionChanged(Map<String, dynamic>? data) {
    if (data == null) return;
    final projectPath = data['projectPath'] as String?;
    if (projectPath != null) {
      state = state.copyWith(projectPath: projectPath);
    }
  }

  void allowPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.allowPermission,
          data: {
            'sessionId': state.currentSessionId,
            'toolUseId': toolUseId,
          },
        ));
    state = state.copyWith(
      pendingPermissions:
          state.pendingPermissions.where((p) => p.toolUseId != toolUseId).toList(),
    );
  }

  void denyPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.denyPermission,
          data: {
            'sessionId': state.currentSessionId,
            'toolUseId': toolUseId,
          },
        ));
    state = state.copyWith(
      pendingPermissions:
          state.pendingPermissions.where((p) => p.toolUseId != toolUseId).toList(),
    );
  }

  void newSession() {
    final sessionId = _uuid.v4();
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.newSession,
          data: {'sessionId': sessionId},
        ));
    state = state.copyWith(
      currentSessionId: sessionId,
      messages: [],
      pendingPermissions: [],
      isLoading: false,
    );
    _storage.setCurrentSessionId(sessionId);
  }

  /// 切换到历史会话：加载该会话消息，更新 currentSessionId，并通知桌面端
  Future<void> switchToSession(String sessionId) async {
    final messages = await _storage.loadMessages(sessionId);
    final summary = state.sessions.firstWhere(
      (s) => s.id == sessionId,
      orElse: () => state.sessions.first,
    );
    state = state.copyWith(
      currentSessionId: sessionId,
      messages: messages,
      projectPath: summary.projectPath,
      pendingPermissions: [],
      isLoading: false,
    );
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.switchSession,
          data: {'sessionId': sessionId},
        ));
    _storage.setCurrentSessionId(sessionId);
  }

  Future<void> deleteSession(String sessionId) async {
    await _storage.deleteSession(sessionId);
    final sessions = state.sessions.where((s) => s.id != sessionId).toList();
    if (state.currentSessionId == sessionId) {
      // 删除的是当前会话：清空消息或切到第一个会话
      if (sessions.isEmpty) {
        state = state.copyWith(
          sessions: sessions,
          currentSessionId: null,
          messages: [],
          projectPath: null,
        );
      } else {
        await switchToSession(sessions.first.id);
        state = state.copyWith(sessions: sessions);
      }
    } else {
      state = state.copyWith(sessions: sessions);
    }
  }

  /// 切换当前会话使用的 Agent，同步到 ChatState 并通知桌面端
  void setAgent(String agentId, String agentName) {
    state = state.copyWith(currentAgent: agentName);
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.listAgents,
          data: {'selectedAgentId': agentId},
        ));
  }

  void abort() {
    if (state.currentSessionId != null) {
      _ref.read(connectionProvider.notifier).send(MobileRequest(
            type: RequestType.abort,
            data: {'sessionId': state.currentSessionId},
          ));
    }
  }

  /// 防抖持久化：500ms 内多次状态变更只写一次盘
  void _schedulePersist() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(milliseconds: 500), _persist);
  }

  Future<void> _persist() async {
    final sid = state.currentSessionId;
    if (sid == null) return;
    // 仅持久化已完成的消息（避免流式中间态被存盘）
    final messages = state.messages
        .where((m) => !m.isStreaming || m.content.isNotEmpty)
        .map((m) => m.isStreaming ? m.copyWith(isStreaming: false) : m)
        .toList();
    // 标题：取首条用户消息前 30 字符，否则用「新对话」
    final firstUser = messages.firstWhere(
      (m) => m.role == MessageRole.user,
      orElse: () => messages.isNotEmpty
          ? messages.first
          : ChatMessage(id: '', role: MessageRole.assistant, content: '新对话'),
    );
    final title = firstUser.content.isEmpty
        ? '新对话'
        : (firstUser.content.length > 30
            ? '${firstUser.content.substring(0, 30)}...'
            : firstUser.content);

    await _storage.saveSession(
      sessionId: sid,
      title: title,
      messages: messages,
      projectPath: state.projectPath,
    );

    // 同步更新 sessions 列表（upsert + 按 updatedAt 排序）
    final updated = SessionSummary(
      id: sid,
      title: title,
      createdAt: state.sessions.firstWhere(
        (s) => s.id == sid,
        orElse: () => SessionSummary(
          id: sid,
          title: title,
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
          projectPath: state.projectPath,
          messageCount: messages.length,
        ),
      ).createdAt,
      updatedAt: DateTime.now(),
      projectPath: state.projectPath,
      messageCount: messages.length,
    );
    final newSessions = (state.sessions.where((s) => s.id != sid).toList()
          ..add(updated))
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    state = state.copyWith(sessions: newSessions);
  }

  @override
  void dispose() {
    _persistTimer?.cancel();
    _subscription?.cancel();
    super.dispose();
  }
}

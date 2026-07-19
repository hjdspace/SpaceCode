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

/// 多会话并行的聊天状态。
///
/// 关键设计：
/// - `messagesBySession` 为每个 sessionId 独立缓存消息列表
/// - `messages` / `isLoading` 是 getter，返回当前 currentSessionId 对应的视图
/// - engine 推送事件携带 sessionId（见 main.ts subscribeEngineEventsForMobile），
///   _handleXxx 方法按 sessionId 路由到对应缓存，不污染其他会话
/// - newSession / switchToSession 只切换 currentSessionId，不清空其他会话缓存
/// - 这样多个会话可以真正并行：旧会话的 LLM 输出继续累积到其缓存，
///   用户切换回旧会话时能看到完整对话
class ChatState {
  final String? currentSessionId;
  /// 每个 session 的消息缓存（并行会话的核心数据结构）
  final Map<String, List<ChatMessage>> messagesBySession;
  /// 每个 session 的 loading 状态（是否正在等待 LLM 响应）
  final Map<String, bool> loadingBySession;
  /// 每个 session 的 agent 名称
  final Map<String, String> agentBySession;
  final List<PermissionRequest> pendingPermissions;
  /// 桌面端当前激活会话的项目目录，由 session_changed 推送更新
  final String? projectPath;
  /// 所有历史会话索引（不含消息体），用于 SessionsScreen 列表
  final List<SessionSummary> sessions;
  /// 历史是否已加载完成（启动时从 SharedPreferences 异步加载）
  final bool historyLoaded;

  const ChatState({
    this.currentSessionId,
    required this.messagesBySession,
    required this.loadingBySession,
    required this.agentBySession,
    this.pendingPermissions = const [],
    this.projectPath,
    this.sessions = const [],
    this.historyLoaded = false,
  });

  /// 当前会话的消息列表（只读视图）
  List<ChatMessage> get messages =>
      currentSessionId == null ? const [] : (messagesBySession[currentSessionId] ?? const []);

  /// 当前会话是否正在等待 LLM 响应
  bool get isLoading =>
      currentSessionId == null ? false : (loadingBySession[currentSessionId] ?? false);

  /// 当前会话的 agent 名称
  String? get currentAgent =>
      currentSessionId == null ? null : agentBySession[currentSessionId];

  ChatState copyWith({
    String? currentSessionId,
    Map<String, List<ChatMessage>>? messagesBySession,
    Map<String, bool>? loadingBySession,
    Map<String, String>? agentBySession,
    List<PermissionRequest>? pendingPermissions,
    String? projectPath,
    List<SessionSummary>? sessions,
    bool? historyLoaded,
  }) => ChatState(
    currentSessionId: currentSessionId ?? this.currentSessionId,
    messagesBySession: messagesBySession ?? this.messagesBySession,
    loadingBySession: loadingBySession ?? this.loadingBySession,
    agentBySession: agentBySession ?? this.agentBySession,
    pendingPermissions: pendingPermissions ?? this.pendingPermissions,
    projectPath: projectPath ?? this.projectPath,
    sessions: sessions ?? this.sessions,
    historyLoaded: historyLoaded ?? this.historyLoaded,
  );

  /// 工厂方法：创建初始空状态
  factory ChatState.initial() => const ChatState(
        messagesBySession: {},
        loadingBySession: {},
        agentBySession: {},
      );
}

class ChatNotifier extends StateNotifier<ChatState> {
  final Ref _ref;
  final _uuid = const Uuid();
  final _storage = ChatHistoryStorage();
  StreamSubscription? _subscription;
  // 防抖保存：连续追加流式 delta 时只在停顿 500ms 后写一次盘
  Timer? _persistTimer;

  ChatNotifier(this._ref) : super(ChatState.initial()) {
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

    final messagesBySession = <String, List<ChatMessage>>{currentId: messages};
    final loadingBySession = <String, bool>{currentId: false};

    state = state.copyWith(
      currentSessionId: currentId,
      messagesBySession: messagesBySession,
      loadingBySession: loadingBySession,
      agentBySession: const {},
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

  /// 从推送数据中提取 sessionId，回退到当前 session（兼容老协议）
  String? _extractSessionId(Map<String, dynamic>? data) {
    if (data == null) return state.currentSessionId;
    final sid = data['sessionId'] as String?;
    return sid ?? state.currentSessionId;
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
    final assistantMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.assistant,
      isStreaming: true,
    );

    final newMessages = [...state.messages, userMsg, assistantMsg];
    _setMessages(sessionId, newMessages);
    _setLoading(sessionId, true);

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

    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages = List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);

    // 若最后一条 assistant message 已完成（isStreaming=false，说明上一轮 assistant
    // 事件已处理），创建新 message 容纳本轮流式输出。
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
      _setMessages(sessionId, [...messages, newMsg]);
    } else {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: last.content + delta,
      );
      _setMessages(sessionId, messages);
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

    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages = List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);

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
      _setMessages(sessionId, [...messages, newMsg]);
    } else {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: text.isEmpty ? last.content : text,
        thinkingContent: thinking ?? last.thinkingContent,
        toolCalls: toolCalls.isEmpty ? last.toolCalls : toolCalls,
        isStreaming: false,
      );
      _setMessages(sessionId, messages);
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
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages = List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
      final last = messages.last;
      final toolCalls = List<ToolCall>.from(last.toolCalls ?? [])..add(toolCall);
      messages[messages.length - 1] = last.copyWith(toolCalls: toolCalls);
      _setMessages(sessionId, messages);
    }
    _schedulePersist();
  }

  void _handleToolResult(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolUseId = data['toolUseId'] as String? ?? '';
    final output = data['output']?.toString() ?? '';
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages = List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
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
    _setMessages(sessionId, messages);
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
    final sessionId = _extractSessionId(data);
    if (sessionId == null) return;
    final messages = List<ChatMessage>.from(state.messagesBySession[sessionId] ?? []);
    if (messages.isNotEmpty && messages.last.isStreaming) {
      messages[messages.length - 1] =
          messages.last.copyWith(isStreaming: false);
      _setMessages(sessionId, messages);
    }
    _setLoading(sessionId, false);
    _schedulePersist();
  }

  /// 桌面端推送 session_changed 事件：更新当前项目目录
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

  /// 新建会话：仅切换 currentSessionId，不清空其他会话缓存
  /// 旧会话的 engine 子进程仍在运行，事件继续累积到对应缓存
  void newSession() {
    final sessionId = _uuid.v4();
    _ref.read(connectionProvider.notifier).send(MobileRequest(
          type: RequestType.newSession,
          data: {'sessionId': sessionId},
        ));
    final newMessagesBySession = Map<String, List<ChatMessage>>.from(state.messagesBySession);
    newMessagesBySession[sessionId] = [];
    final newLoadingBySession = Map<String, bool>.from(state.loadingBySession);
    newLoadingBySession[sessionId] = false;
    state = state.copyWith(
      currentSessionId: sessionId,
      messagesBySession: newMessagesBySession,
      loadingBySession: newLoadingBySession,
      pendingPermissions: [],
    );
    _storage.setCurrentSessionId(sessionId);
  }

  /// 切换到历史会话：仅切换 currentSessionId，加载该会话的消息到缓存
  /// 不影响其他会话的 engine 进程
  Future<void> switchToSession(String sessionId) async {
    // 若该 session 的消息未加载到内存，从 storage 加载
    final messagesBySession = Map<String, List<ChatMessage>>.from(state.messagesBySession);
    if (!messagesBySession.containsKey(sessionId)) {
      final messages = await _storage.loadMessages(sessionId);
      messagesBySession[sessionId] = messages;
    }
    final summary = state.sessions.firstWhere(
      (s) => s.id == sessionId,
      orElse: () => state.sessions.first,
    );
    final loadingBySession = Map<String, bool>.from(state.loadingBySession);
    loadingBySession.putIfAbsent(sessionId, () => false);

    state = state.copyWith(
      currentSessionId: sessionId,
      messagesBySession: messagesBySession,
      loadingBySession: loadingBySession,
      projectPath: summary.projectPath,
      pendingPermissions: [],
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
    final messagesBySession = Map<String, List<ChatMessage>>.from(state.messagesBySession);
    messagesBySession.remove(sessionId);
    final loadingBySession = Map<String, bool>.from(state.loadingBySession);
    loadingBySession.remove(sessionId);

    if (state.currentSessionId == sessionId) {
      if (sessions.isEmpty) {
        state = state.copyWith(
          sessions: sessions,
          messagesBySession: messagesBySession,
          loadingBySession: loadingBySession,
          currentSessionId: null,
          projectPath: null,
        );
      } else {
        // 切到第一个会话
        final nextId = sessions.first.id;
        if (!messagesBySession.containsKey(nextId)) {
          final msgs = await _storage.loadMessages(nextId);
          messagesBySession[nextId] = msgs;
        }
        loadingBySession.putIfAbsent(nextId, () => false);
        state = state.copyWith(
          sessions: sessions,
          messagesBySession: messagesBySession,
          loadingBySession: loadingBySession,
          currentSessionId: nextId,
          projectPath: sessions.first.projectPath,
        );
        _ref.read(connectionProvider.notifier).send(MobileRequest(
              type: RequestType.switchSession,
              data: {'sessionId': nextId},
            ));
        _storage.setCurrentSessionId(nextId);
      }
    } else {
      state = state.copyWith(
        sessions: sessions,
        messagesBySession: messagesBySession,
        loadingBySession: loadingBySession,
      );
    }
  }

  /// 切换当前会话使用的 Agent，同步到 ChatState 并通知桌面端
  void setAgent(String agentId, String agentName) {
    final sid = state.currentSessionId;
    if (sid == null) return;
    final newAgentBySession = Map<String, String>.from(state.agentBySession);
    newAgentBySession[sid] = agentName;
    state = state.copyWith(agentBySession: newAgentBySession);
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

  /// 更新某个 session 的消息缓存（不可变更新）
  void _setMessages(String sessionId, List<ChatMessage> messages) {
    final newMap = Map<String, List<ChatMessage>>.from(state.messagesBySession);
    newMap[sessionId] = messages;
    state = state.copyWith(messagesBySession: newMap);
  }

  /// 更新某个 session 的 loading 状态（不可变更新）
  void _setLoading(String sessionId, bool loading) {
    final newMap = Map<String, bool>.from(state.loadingBySession);
    newMap[sessionId] = loading;
    state = state.copyWith(loadingBySession: newMap);
  }

  /// 防抖持久化：500ms 内多次状态变更只写一次盘
  void _schedulePersist() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(milliseconds: 500), _persist);
  }

  Future<void> _persist() async {
    final sid = state.currentSessionId;
    if (sid == null) return;
    final messages = state.messagesBySession[sid] ?? [];
    // 仅持久化已完成的消息（避免流式中间态被存盘）
    final persistableMessages = messages
        .where((m) => !m.isStreaming || m.content.isNotEmpty)
        .map((m) => m.isStreaming ? m.copyWith(isStreaming: false) : m)
        .toList();
    // 标题：取首条用户消息前 30 字符，否则用「新对话」
    final firstUser = persistableMessages.firstWhere(
      (m) => m.role == MessageRole.user,
      orElse: () => persistableMessages.isNotEmpty
          ? persistableMessages.first
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
      messages: persistableMessages,
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
          messageCount: persistableMessages.length,
        ),
      ).createdAt,
      updatedAt: DateTime.now(),
      projectPath: state.projectPath,
      messageCount: persistableMessages.length,
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

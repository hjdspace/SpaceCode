import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/protocol/protocol.dart';
import '../../core/connection/connection_service.dart';
import 'models/message.dart';
import 'models/tool_call.dart';
import 'models/permission_request.dart';

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  final notifier = ChatNotifier(ref);
  return notifier;
});

class ChatState {
  final String? currentSessionId;
  final List<ChatMessage> messages;
  final List<PermissionRequest> pendingPermissions;
  final bool isLoading;
  final String? currentAgent;

  const ChatState({
    this.currentSessionId,
    this.messages = const [],
    this.pendingPermissions = const [],
    this.isLoading = false,
    this.currentAgent,
  });

  ChatState copyWith({
    String? currentSessionId,
    List<ChatMessage>? messages,
    List<PermissionRequest>? pendingPermissions,
    bool? isLoading,
    String? currentAgent,
  }) =>
      ChatState(
        currentSessionId: currentSessionId ?? this.currentSessionId,
        messages: messages ?? this.messages,
        pendingPermissions: pendingPermissions ?? this.pendingPermissions,
        isLoading: isLoading ?? this.isLoading,
        currentAgent: currentAgent ?? this.currentAgent,
      );
}

class ChatNotifier extends StateNotifier<ChatState> {
  final Ref _ref;
  final _uuid = const Uuid();
  StreamSubscription? _subscription;

  ChatNotifier(this._ref) : super(const ChatState()) {
    _subscription =
        _ref.read(connectionProvider.notifier).messages.listen(_handlePush);
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
        // assistant 事件标志着本轮结束；若包含 tool_use，工具执行后下一轮
        // stream_event 会创建新 message。若不含 tool_use，标记为非流式，
        // _handleResult 仍可正常处理。
        isStreaming: false,
      );
      state = state.copyWith(messages: [...messages, newMsg]);
    } else {
      // 用 assistant 事件的完整内容替换流式累积的 delta（避免重复），
      // 并补上 tool_use 与 thinking
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: text.isEmpty ? last.content : text,
        thinkingContent: thinking ?? last.thinkingContent,
        toolCalls: toolCalls.isEmpty ? last.toolCalls : toolCalls,
        isStreaming: false,
      );
      state = state.copyWith(messages: messages);
    }
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
    state = ChatState(currentSessionId: sessionId);
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

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

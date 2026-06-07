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
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
      final last = messages.last;
      messages[messages.length - 1] =
          last.copyWith(content: last.content + delta);
      state = state.copyWith(messages: messages);
    }
  }

  void _handleAssistant(Map<String, dynamic>? data) {}

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

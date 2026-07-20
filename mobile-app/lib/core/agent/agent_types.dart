import 'dart:async';

enum AgentRole { user, assistant, tool }

class AgentToolCall {
  final String id;
  final String name;
  final Map<String, dynamic> arguments;

  const AgentToolCall({
    required this.id,
    required this.name,
    required this.arguments,
  });
}

class AgentMessage {
  final AgentRole role;
  final String content;
  final List<AgentToolCall> toolCalls;
  final String? toolCallId;
  final bool isError;

  const AgentMessage({
    required this.role,
    this.content = '',
    this.toolCalls = const [],
    this.toolCallId,
    this.isError = false,
  });

  const AgentMessage.user(String content)
      : this(role: AgentRole.user, content: content);

  const AgentMessage.assistant({
    String content = '',
    List<AgentToolCall> toolCalls = const [],
  }) : this(
          role: AgentRole.assistant,
          content: content,
          toolCalls: toolCalls,
        );

  const AgentMessage.tool({
    required String toolCallId,
    required String content,
    bool isError = false,
  }) : this(
          role: AgentRole.tool,
          content: content,
          toolCallId: toolCallId,
          isError: isError,
        );
}

enum AgentEventType {
  agentStart,
  turnStart,
  assistantMessage,
  assistantDelta,
  toolExecutionStart,
  toolExecutionEnd,
  agentEnd,
}

class AgentEvent {
  final AgentEventType type;
  final AgentMessage? message;
  final AgentToolCall? toolCall;
  final String? toolResult;
  final String? delta;
  final bool isError;

  const AgentEvent({
    required this.type,
    this.message,
    this.toolCall,
    this.toolResult,
    this.delta,
    this.isError = false,
  });
}

enum AgentStopReason { completed, maxTurns }

class AgentRunResult {
  final String text;
  final AgentStopReason stopReason;
  final List<AgentMessage> newMessages;

  const AgentRunResult({
    required this.text,
    required this.stopReason,
    required this.newMessages,
  });
}

class AgentCancelledException implements Exception {
  const AgentCancelledException();

  @override
  String toString() => 'Agent task cancelled';
}

class AgentCancellationToken {
  final Completer<void> _cancelled = Completer<void>();

  bool get isCancelled => _cancelled.isCompleted;
  Future<void> get whenCancelled => _cancelled.future;

  void cancel() {
    if (!_cancelled.isCompleted) _cancelled.complete();
  }

  void throwIfCancelled() {
    if (isCancelled) throw const AgentCancelledException();
  }
}

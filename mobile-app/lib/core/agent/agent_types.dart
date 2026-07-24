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
  /// LLM 开始生成工具调用（已收到 tool_call id + name）。
  ///
  /// 在 SSE 流式响应中，第一个 tool_call delta 携带 id 与 function.name 时触发。
  /// UI 收到此事件应立即创建 `status=running` 的 ToolCall 并加入 timeline，
  /// 让用户在 LLM 还在生成参数时就能看到"运行中"的工具卡片。
  toolCallStreamingStart,
  /// LLM 工具调用参数的流式 delta（累积的 partial JSON）。
  ///
  /// 每次 input_json_delta 到达时触发，参数 [AgentEvent.toolCallPartialJson]
  /// 是已累积的 partial JSON 字符串（不是单次 delta）。
  toolCallStreamingDelta,
  /// LLM 工具调用流式结束（完整 input JSON 已就绪）。
  ///
  /// SSE 流的 `[DONE]` 或 markDone 时触发，参数 [AgentEvent.toolCallPartialJson]
  /// 是完整的 input JSON 字符串。UI 应解析后写回 toolCall.input。
  toolCallStreamingComplete,
  toolExecutionStart,
  toolExecutionEnd,
  agentEnd,
  /// 权限询问事件：Plugin 抛出 PermissionRequestedException，
  /// AgentSession 推送此事件给 UI，UI 渲染 PermissionCard，
  /// 用户响应后通过 AgentSession.resolvePermission 解锁。
  permissionRequest,
}

class AgentEvent {
  final AgentEventType type;
  final AgentMessage? message;
  final AgentToolCall? toolCall;
  final String? toolResult;
  final String? delta;
  final bool isError;

  /// 流式工具调用的累积 partial JSON（仅 type == toolCallStreamingDelta /
  /// toolCallStreamingComplete 时有效）。
  ///
  /// - delta：累积的部分 JSON（引号可能未闭合）
  /// - complete：完整的 JSON 字符串
  final String? toolCallPartialJson;

  /// 权限请求 ID（仅 type == permissionRequest 时有效）
  final String? permissionRequestId;
  /// 权限请求关联的工具名（仅 type == permissionRequest 时有效）
  final String? permissionToolName;
  /// 权限请求关联的工具参数 JSON（仅 type == permissionRequest 时有效）
  final Map<String, dynamic>? permissionArguments;
  /// 权限请求原因（仅 type == permissionRequest 时有效）
  final String? permissionReason;
  /// 危险等级（read/write/dangerous，仅 type == permissionRequest 时有效）
  final String? permissionDangerLevel;

  const AgentEvent({
    required this.type,
    this.message,
    this.toolCall,
    this.toolResult,
    this.delta,
    this.isError = false,
    this.toolCallPartialJson,
    this.permissionRequestId,
    this.permissionToolName,
    this.permissionArguments,
    this.permissionReason,
    this.permissionDangerLevel,
  });

  /// 构造权限请求事件的便捷方法。
  factory AgentEvent.permissionRequest({
    required String requestId,
    required AgentToolCall toolCall,
    required String reason,
    required String dangerLevel,
  }) {
    return AgentEvent(
      type: AgentEventType.permissionRequest,
      permissionRequestId: requestId,
      toolCall: toolCall,
      permissionToolName: toolCall.name,
      permissionArguments: toolCall.arguments,
      permissionReason: reason,
      permissionDangerLevel: dangerLevel,
    );
  }
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

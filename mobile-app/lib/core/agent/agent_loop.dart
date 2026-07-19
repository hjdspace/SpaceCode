import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';

typedef AgentEventListener = void Function(AgentEvent event);

class AgentSession {
  final AgentModel model;
  final String systemPrompt;
  final int maxTurns;
  final int contextMessageLimit;
  final AgentToolRegistry _tools;
  final List<AgentMessage> _messages = [];

  AgentSession({
    required this.model,
    required this.systemPrompt,
    List<AgentPlugin> plugins = const [],
    List<AgentMessage> initialMessages = const [],
    this.maxTurns = 16,
    this.contextMessageLimit = 48,
  }) : _tools = AgentToolRegistry(plugins) {
    _messages.addAll(initialMessages);
  }

  List<AgentMessage> get messages => List.unmodifiable(_messages);

  Future<AgentRunResult> run(
    String prompt, {
    required AgentModelConfig config,
    AgentCancellationToken? cancellationToken,
    AgentEventListener? onEvent,
  }) async {
    final token = cancellationToken ?? AgentCancellationToken();
    final newMessages = <AgentMessage>[];
    final userMessage = AgentMessage.user(prompt);
    _messages.add(userMessage);
    newMessages.add(userMessage);
    onEvent?.call(const AgentEvent(type: AgentEventType.agentStart));
    try {
      for (var turn = 0; turn < maxTurns; turn++) {
        token.throwIfCancelled();
        onEvent?.call(const AgentEvent(type: AgentEventType.turnStart));
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
        token.throwIfCancelled();

        final assistantMessage = AgentMessage.assistant(
          content: response.text,
          toolCalls: response.toolCalls,
        );
        _messages.add(assistantMessage);
        newMessages.add(assistantMessage);
        onEvent?.call(AgentEvent(
          type: AgentEventType.assistantMessage,
          message: assistantMessage,
        ));

        if (response.toolCalls.isEmpty) {
          _compactContext();
          final result = AgentRunResult(
            text: response.text,
            stopReason: AgentStopReason.completed,
            newMessages: newMessages,
          );
          return result;
        }

        final executedCalls = await _executeToolBatch(
          response.toolCalls,
          token,
          onEvent,
        );
        for (final executed in executedCalls) {
          final call = executed.call;
          final result = executed.result;
          final toolMessage = AgentMessage.tool(
            toolCallId: call.id,
            content: result.content,
            isError: result.isError,
          );
          _messages.add(toolMessage);
          newMessages.add(toolMessage);
        }
        token.throwIfCancelled();
      }

      _compactContext();
      return AgentRunResult(
        text: newMessages
            .where((message) => message.role == AgentRole.assistant)
            .map((message) => message.content)
            .lastWhere((text) => text.isNotEmpty,
                orElse: () => 'Agent 已达到最大执行轮数'),
        stopReason: AgentStopReason.maxTurns,
        newMessages: newMessages,
      );
    } finally {
      onEvent?.call(const AgentEvent(type: AgentEventType.agentEnd));
    }
  }

  Future<AgentToolResult> _executeTool(
    AgentToolCall call,
    AgentCancellationToken token,
  ) async {
    try {
      final tool = _tools.find(call.name);
      if (tool == null) {
        return AgentToolResult(
          content: 'Tool ${call.name} not found',
          isError: true,
        );
      }
      for (final plugin in _tools.plugins) {
        token.throwIfCancelled();
        final decision = await plugin.beforeToolCall(call);
        if (!decision.allowed) {
          return AgentToolResult(
            content: decision.reason ?? 'Tool execution blocked',
            isError: true,
          );
        }
      }
      token.throwIfCancelled();
      final result = await tool.execute(call.arguments, token);
      for (final plugin in _tools.plugins) {
        token.throwIfCancelled();
        await plugin.afterToolCall(call, result);
      }
      return result;
    } on AgentCancelledException {
      rethrow;
    } catch (error) {
      return AgentToolResult(
          content: 'Tool ${call.name} failed: $error', isError: true);
    }
  }

  Future<List<_ExecutedToolCall>> _executeToolBatch(
    List<AgentToolCall> calls,
    AgentCancellationToken token,
    AgentEventListener? onEvent,
  ) async {
    final sequential = calls.any((call) =>
        _tools.find(call.name)?.executionMode ==
        AgentToolExecutionMode.sequential);
    if (sequential) {
      final results = <_ExecutedToolCall>[];
      for (final call in calls) {
        results.add(await _executeToolWithEvents(call, token, onEvent));
      }
      return results;
    }
    return Future.wait(
      calls.map((call) => _executeToolWithEvents(call, token, onEvent)),
    );
  }

  Future<_ExecutedToolCall> _executeToolWithEvents(
    AgentToolCall call,
    AgentCancellationToken token,
    AgentEventListener? onEvent,
  ) async {
    token.throwIfCancelled();
    onEvent?.call(AgentEvent(
      type: AgentEventType.toolExecutionStart,
      toolCall: call,
    ));
    try {
      final result = await _executeTool(call, token);
      onEvent?.call(AgentEvent(
        type: AgentEventType.toolExecutionEnd,
        toolCall: call,
        toolResult: result.content,
        isError: result.isError,
      ));
      return _ExecutedToolCall(call: call, result: result);
    } on AgentCancelledException {
      onEvent?.call(AgentEvent(
        type: AgentEventType.toolExecutionEnd,
        toolCall: call,
        toolResult: 'Task cancelled',
        isError: true,
      ));
      rethrow;
    }
  }

  void _compactContext() {
    if (_messages.length <= contextMessageLimit) return;
    var start = _messages.length - contextMessageLimit;
    while (
        start < _messages.length && _messages[start].role != AgentRole.user) {
      start++;
    }
    if (start >= _messages.length) {
      start = _messages.length - contextMessageLimit;
    }
    _messages.removeRange(0, start);
  }
}

class _ExecutedToolCall {
  final AgentToolCall call;
  final AgentToolResult result;

  const _ExecutedToolCall({required this.call, required this.result});
}

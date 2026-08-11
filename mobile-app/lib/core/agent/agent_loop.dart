import 'dart:async';

import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'permission_exception.dart';

typedef AgentEventListener = void Function(AgentEvent event);

class AgentSession {
  final AgentModel model;
  final String systemPrompt;
  final int maxTurns;
  final int contextMessageLimit;
  final AgentToolRegistry _tools;
  final List<AgentMessage> _messages = [];

  /// 当前会话的权限模式（default/plan/acceptEdits/bypassPermissions）。
  ///
  /// 由 [LocalAgentService] 在构造 session 时传入，影响所有 Plugin 的
  /// beforeToolCall 决策。
  final String permissionMode;

  /// 进行中的权限询问：requestId → Completer。
  ///
  /// Plugin 抛出 [PermissionRequestedException] 时，[AgentSession] 创建
  /// Completer 并存入此 Map，推送 [AgentEventType.permissionRequest] 事件给 UI。
  /// UI 收到用户响应后调用 [resolvePermission] 完成 Completer，工具调用继续。
  final Map<String, Completer<AgentToolDecision>> _pendingPermissions = {};

  AgentSession({
    required this.model,
    required this.systemPrompt,
    List<AgentPlugin> plugins = const [],
    List<AgentMessage> initialMessages = const [],
    this.maxTurns = 16,
    this.contextMessageLimit = 48,
    this.permissionMode = PermissionMode.defaultMode,
  }) : _tools = AgentToolRegistry(plugins) {
    _messages.addAll(initialMessages);
  }

  List<AgentMessage> get messages => List.unmodifiable(_messages);

  /// 用户响应权限询问。
  ///
  /// 由 ChatNotifier 在用户点击 PermissionCard 的"允许/拒绝"按钮后调用。
  /// 如果 [requestId] 不存在（已超时或会话已取消），此调用为 no-op。
  void resolvePermission(String requestId, AgentToolDecision decision) {
    final completer = _pendingPermissions.remove(requestId);
    if (completer != null && !completer.isCompleted) {
      completer.complete(decision);
    }
  }

  /// 取消所有进行中的权限询问（用于会话取消时）。
  void _cancelAllPendingPermissions() {
    for (final completer in _pendingPermissions.values) {
      if (!completer.isCompleted) {
        completer.complete(const AgentToolDecision.deny('Session cancelled'));
      }
    }
    _pendingPermissions.clear();
  }

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
          onToolCallStart: (toolId, toolName) {
            onEvent?.call(AgentEvent(
              type: AgentEventType.toolCallStreamingStart,
              toolCall: AgentToolCall(
                id: toolId,
                name: toolName,
                arguments: const {},
              ),
            ));
          },
          onToolCallDelta: (toolId, partialJson) {
            onEvent?.call(AgentEvent(
              type: AgentEventType.toolCallStreamingDelta,
              toolCall: AgentToolCall(
                id: toolId,
                name: '',
                arguments: const {},
              ),
              toolCallPartialJson: partialJson,
            ));
          },
          onToolCallStop: (toolId, fullJson) {
            onEvent?.call(AgentEvent(
              type: AgentEventType.toolCallStreamingComplete,
              toolCall: AgentToolCall(
                id: toolId,
                name: '',
                arguments: const {},
              ),
              toolCallPartialJson: fullJson,
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
      _cancelAllPendingPermissions();
      onEvent?.call(const AgentEvent(type: AgentEventType.agentEnd));
    }
  }

  Future<AgentToolResult> _executeTool(
    AgentToolCall call,
    AgentCancellationToken token,
    AgentEventListener? onEvent,
  ) async {
    try {
      // 1. 横切拦截：所有 Plugin 的 beforeToolCall 先执行
      //    （即使工具未注册，拦截器也能 deny 危险调用）
      for (final plugin in _tools.plugins) {
        token.throwIfCancelled();
        AgentToolDecision decision;
        try {
          decision = await plugin.beforeToolCall(
            call,
            permissionMode: permissionMode,
          );
        } on PermissionRequestedException catch (request) {
          // 异步询问用户：推送事件 + 等待 Completer
          decision = await _askUser(request, token, onEvent);
        }
        if (!decision.allowed) {
          return AgentToolResult(
            content: decision.reason ?? 'Tool execution blocked',
            isError: true,
          );
        }
      }
      // 2. 工具查找
      final tool = _tools.find(call.name);
      if (tool == null) {
        return AgentToolResult(
          content: 'Tool ${call.name} not found',
          isError: true,
        );
      }
      // 3. 执行 + afterToolCall
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

  /// 推送权限询问事件给 UI 并等待用户响应。
  ///
  /// 流程：
  /// 1. 创建 Completer 存入 [_pendingPermissions]
  /// 2. 推送 [AgentEventType.permissionRequest] 事件给 UI
  /// 3. 等待 [resolvePermission] 完成 Completer（或 5 分钟超时自动 deny）
  Future<AgentToolDecision> _askUser(
    PermissionRequestedException request,
    AgentCancellationToken token,
    AgentEventListener? onEvent,
  ) async {
    final completer = Completer<AgentToolDecision>();
    _pendingPermissions[request.requestId] = completer;

    onEvent?.call(AgentEvent.permissionRequest(
      requestId: request.requestId,
      toolCall: request.toolCall,
      reason: request.reason,
      dangerLevel: request.dangerLevel,
    ));

    // 5 分钟超时自动拒绝
    final timeoutFuture = Future<AgentToolDecision>.delayed(
      const Duration(minutes: 5),
      () => const AgentToolDecision.deny('Permission request timed out'),
    );

    // 会话取消时自动拒绝
    final cancelFuture = token.whenCancelled.then((_) =>
        const AgentToolDecision.deny('Session cancelled'));

    try {
      final decision = await Future.any(
        [completer.future, timeoutFuture, cancelFuture],
      );
      // 清理：若 completer 仍未完成（因为超时或取消先返回），标记为已完成
      if (!completer.isCompleted) {
        completer.complete(decision);
      }
      _pendingPermissions.remove(request.requestId);
      return decision;
    } catch (error) {
      _pendingPermissions.remove(request.requestId);
      return AgentToolDecision.deny('Permission request failed: $error');
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
      final result = await _executeTool(call, token, onEvent);
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

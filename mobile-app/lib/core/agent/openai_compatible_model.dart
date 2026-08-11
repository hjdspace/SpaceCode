import 'dart:convert';

import 'package:http/http.dart' as http;

import 'agent_model.dart';
import 'agent_types.dart';

class OpenAiCompatibleModel implements AgentModel {
  static const _maxRateLimitRetries = 2;
  static const _defaultRateLimitDelay = Duration(minutes: 1);

  final http.Client _client;

  OpenAiCompatibleModel({http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  }) async {
    cancellationToken.throwIfCancelled();
    final base = config.baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint =
        base.endsWith('/chat/completions') ? base : '$base/chat/completions';
    // 流式开启条件：显式 onDelta（文本流）或 onToolCallStart/Delta/Stop（工具流）。
    // 只要任意一个流式回调存在就启用 SSE，确保工具调用能流式触发。
    final useStream = onDelta != null ||
        onToolCallStart != null ||
        onToolCallDelta != null ||
        onToolCallStop != null;
    final body = jsonEncode({
      'model': config.model,
      'stream': useStream,
      'messages': [
        {'role': 'system', 'content': systemPrompt},
        ...messages.map(_messageToJson),
      ],
      if (tools.isNotEmpty)
        'tools': tools
            .map((tool) => {
                  'type': 'function',
                  'function': {
                    'name': tool.name,
                    'description': tool.description,
                    'parameters': tool.inputSchema,
                  },
                })
            .toList(),
    });

    for (var retry = 0;; retry++) {
      final request = http.AbortableRequest(
        'POST',
        Uri.parse(endpoint),
        abortTrigger: cancellationToken.whenCancelled,
      )
        ..headers.addAll({
          'Authorization': 'Bearer ${config.apiKey}',
          'Content-Type': 'application/json',
          if (useStream) 'Accept': 'text/event-stream',
        })
        ..body = body;

      try {
        if (!useStream) {
          return await _completeNonStream(request, cancellationToken);
        }
        return await _completeStream(
          request,
          cancellationToken,
          onDelta ?? (_) {},
          onToolCallStart,
          onToolCallDelta,
          onToolCallStop,
        );
      } on _RateLimitException catch (error) {
        if (retry >= _maxRateLimitRetries) {
          throw StateError(error.message);
        }
        await _waitForRateLimit(error.retryAfter, cancellationToken);
      }
    }
  }

  Future<void> _waitForRateLimit(
    Duration? retryAfter,
    AgentCancellationToken cancellationToken,
  ) async {
    final delay = retryAfter ?? _defaultRateLimitDelay;
    if (delay > Duration.zero) {
      await Future.any<void>([
        Future<void>.delayed(delay),
        cancellationToken.whenCancelled,
      ]);
    }
    cancellationToken.throwIfCancelled();
  }

  Future<AgentModelResponse> _completeNonStream(
    http.AbortableRequest request,
    AgentCancellationToken cancellationToken,
  ) async {
    http.StreamedResponse streamed;
    try {
      streamed =
          await _client.send(request).timeout(const Duration(seconds: 90));
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    // 服务器可能即使在没有请求 stream 时也返回 SSE（例如代理强制流式），
    // 此时降级走流式解析，确保 tool_calls 等仍能正确累积。
    final contentType = streamed.headers['content-type'] ?? '';
    if (contentType.contains('text/event-stream')) {
      return _completeStreamFromResponse(
        streamed,
        cancellationToken,
        (_) {},
        null,
        null,
        null,
      );
    }
    return _completeJsonFromResponse(streamed, cancellationToken);
  }

  Future<AgentModelResponse> _completeJsonFromResponse(
    http.StreamedResponse streamed,
    AgentCancellationToken cancellationToken,
  ) async {
    final response = await http.Response.fromStream(streamed);
    cancellationToken.throwIfCancelled();

    Object? body;
    try {
      body = jsonDecode(response.body);
    } on FormatException {
      throw StateError('模型返回了无效 JSON（${response.statusCode}）');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body is Map<String, dynamic> ? body['error'] : null;
      final message = error is Map
          ? error['message']
          : body is Map
              ? body['message']
              : null;
      if (response.statusCode == 429) {
        throw _RateLimitException(
          message?.toString() ?? 'Rate limit exceeded',
          _retryAfter(response.headers),
        );
      }
      throw StateError(message?.toString() ?? '模型请求失败（${response.statusCode}）');
    }
    if (body is! Map<String, dynamic>) throw StateError('模型返回了无效响应');
    final choices = body['choices'];
    if (choices is! List || choices.isEmpty || choices.first is! Map) {
      throw StateError('模型没有返回内容');
    }
    final message = (choices.first as Map)['message'];
    if (message is! Map<String, dynamic>) throw StateError('模型返回了无效消息');
    return AgentModelResponse(
      text: _readText(message['content']),
      toolCalls: _readToolCalls(message['tool_calls']),
    );
  }

  Future<AgentModelResponse> _completeStream(
    http.AbortableRequest request,
    AgentCancellationToken cancellationToken,
    void Function(String delta) onDelta,
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  ) async {
    http.StreamedResponse response;
    try {
      response =
          await _client.send(request).timeout(const Duration(seconds: 90));
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    final contentType = response.headers['content-type'] ?? '';
    if (contentType.contains('application/json')) {
      return _completeJsonFromResponse(response, cancellationToken);
    }
    return _completeStreamFromResponse(
      response,
      cancellationToken,
      onDelta,
      onToolCallStart,
      onToolCallDelta,
      onToolCallStop,
    );
  }

  Future<AgentModelResponse> _completeStreamFromResponse(
    http.StreamedResponse response,
    AgentCancellationToken cancellationToken,
    void Function(String delta) onDelta,
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  ) async {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final errorBody = await response.stream.bytesToString();
      String? message;
      try {
        final decoded = jsonDecode(errorBody);
        if (decoded is Map<String, dynamic>) {
          final err = decoded['error'];
          if (err is Map) {
            message = err['message']?.toString();
          } else {
            message = decoded['message']?.toString();
          }
        }
      } catch (_) {
        message = errorBody;
      }
      if (response.statusCode == 429) {
        throw _RateLimitException(
          message?.toString() ?? 'Rate limit exceeded',
          _retryAfter(response.headers),
        );
      }
      throw StateError(message?.toString() ?? '模型请求失败（${response.statusCode}）');
    }

    final buffer = StringBuffer();
    final toolCallBuilder = _StreamingToolCallBuilder(
      onToolCallStart: onToolCallStart,
      onToolCallDelta: onToolCallDelta,
      onToolCallStop: onToolCallStop,
    );
    final lineBuffer = StringBuffer();
    void processLine(String rawLine) {
      final line = rawLine.trim();
      if (line.isEmpty || !line.startsWith('data:')) return;
      final data = line.substring(5).trim();
      if (data == '[DONE]') {
        toolCallBuilder.markDone();
        return;
      }
      try {
        final decoded = jsonDecode(data);
        if (decoded is! Map<String, dynamic>) return;
        final choices = decoded['choices'];
        if (choices is! List || choices.isEmpty) return;
        final choice = choices.first;
        if (choice is! Map<String, dynamic>) return;
        final delta = choice['delta'];
        if (delta is! Map<String, dynamic>) return;
        final content = delta['content'];
        if (content is String && content.isNotEmpty) {
          buffer.write(content);
          onDelta(content);
        }
        toolCallBuilder.consumeDelta(delta);
      } catch (_) {
        // 忽略解析错误的事件
      }
    }

    try {
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        cancellationToken.throwIfCancelled();
        lineBuffer.write(chunk);
        final lines = lineBuffer.toString().split('\n');
        lineBuffer.clear();
        lineBuffer.write(lines.removeLast());
        for (final rawLine in lines) {
          processLine(rawLine);
        }
      }
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
    processLine(lineBuffer.toString());
    toolCallBuilder.markDone();
    return AgentModelResponse(
      text: buffer.toString(),
      toolCalls: toolCallBuilder.buildToolCalls(),
    );
  }

  Map<String, dynamic> _messageToJson(AgentMessage message) {
    switch (message.role) {
      case AgentRole.user:
        return {'role': 'user', 'content': message.content};
      case AgentRole.assistant:
        return {
          'role': 'assistant',
          'content': message.content.isEmpty ? null : message.content,
          if (message.toolCalls.isNotEmpty)
            'tool_calls': message.toolCalls
                .map((call) => {
                      'id': call.id,
                      'type': 'function',
                      'function': {
                        'name': call.name,
                        'arguments': jsonEncode(call.arguments),
                      },
                    })
                .toList(),
        };
      case AgentRole.tool:
        return {
          'role': 'tool',
          'tool_call_id': message.toolCallId,
          'content': message.content,
        };
    }
  }

  String _readText(Object? content) {
    if (content is String) return content;
    if (content is List) {
      return content
          .whereType<Map<String, dynamic>>()
          .where((part) => part['type'] == 'text')
          .map((part) => part['text'] as String? ?? '')
          .join();
    }
    return '';
  }

  List<AgentToolCall> _readToolCalls(Object? rawCalls) {
    if (rawCalls is! List) return const [];
    final calls = <AgentToolCall>[];
    for (final rawCall in rawCalls.whereType<Map<String, dynamic>>()) {
      final function = rawCall['function'];
      if (function is! Map<String, dynamic>) continue;
      final name = function['name'] as String?;
      if (name == null || name.isEmpty) continue;
      final rawArguments = function['arguments'];
      Map<String, dynamic> arguments;
      if (rawArguments is String) {
        final decoded = jsonDecode(rawArguments);
        arguments = decoded is Map
            ? decoded.cast<String, dynamic>()
            : <String, dynamic>{};
      } else {
        arguments = rawArguments is Map
            ? rawArguments.cast<String, dynamic>()
            : <String, dynamic>{};
      }
      calls.add(AgentToolCall(
        id: rawCall['id'] as String? ?? 'tool-${calls.length + 1}',
        name: name,
        arguments: arguments,
      ));
    }
    return calls;
  }

  Duration? _retryAfter(Map<String, String> headers) {
    final seconds = int.tryParse(headers['retry-after'] ?? '');
    if (seconds == null || seconds < 0) return null;
    return Duration(seconds: seconds);
  }

  @override
  void dispose() => _client.close();
}

class _RateLimitException implements Exception {
  final String message;
  final Duration? retryAfter;

  const _RateLimitException(this.message, this.retryAfter);
}

/// 在 SSE 流中累积 tool_calls 信息（支持多个并发 tool_call）。
///
/// 同时通过 [onToolCallStart] / [onToolCallDelta] / [onToolCallStop] 回调
/// 把流式过程暴露给上层，让 UI 能在 LLM 生成工具参数时就显示"运行中"卡片。
class _StreamingToolCallBuilder {
  final Map<int, _StreamingToolCall> _calls = {};
  bool _done = false;
  final AgentToolCallStartCallback? onToolCallStart;
  final AgentToolCallDeltaCallback? onToolCallDelta;
  final AgentToolCallStopCallback? onToolCallStop;

  _StreamingToolCallBuilder({
    this.onToolCallStart,
    this.onToolCallDelta,
    this.onToolCallStop,
  });

  void consumeDelta(Map<String, dynamic> delta) {
    final toolCalls = delta['tool_calls'];
    if (toolCalls is! List || toolCalls.isEmpty) return;
    for (final tc in toolCalls.whereType<Map<String, dynamic>>()) {
      final index = (tc['index'] as int?) ?? 0;
      final existing = _calls.putIfAbsent(index, () => _StreamingToolCall());
      final id = tc['id'] as String?;
      if (id != null && existing.id.isEmpty) {
        existing.id = id;
      }
      final function = tc['function'];
      if (function is! Map<String, dynamic>) continue;
      final name = function['name'] as String?;
      if (name != null && existing.name.isEmpty) {
        existing.name = name;
      }
      // id 与 name 都已就绪时触发 start（仅触发一次）
      if (!existing.startEmitted &&
          existing.id.isNotEmpty &&
          existing.name.isNotEmpty) {
        existing.startEmitted = true;
        onToolCallStart?.call(existing.id, existing.name);
      }
      final args = function['arguments'];
      if (args is String) {
        existing.arguments.write(args);
        // 每次 arguments 追加后触发 delta，传递累积的 partial JSON
        if (existing.startEmitted) {
          onToolCallDelta?.call(existing.id, existing.arguments.toString());
        }
      }
    }
  }

  void markDone() {
    if (_done) return;
    _done = true;
    // 对每个已 emit start 的 call 触发 stop，传递完整 JSON 字符串
    if (onToolCallStop != null) {
      for (final call in _calls.values) {
        if (call.startEmitted) {
          onToolCallStop!.call(call.id, call.arguments.toString());
        }
      }
    }
  }

  List<AgentToolCall> buildToolCalls() {
    if (!_done) return const [];
    final sortedKeys = _calls.keys.toList()..sort();
    return sortedKeys.map((index) {
      final call = _calls[index]!;
      Map<String, dynamic> decodedArgs;
      final raw = call.arguments.toString();
      if (raw.isEmpty) {
        decodedArgs = const {};
      } else {
        try {
          final decoded = jsonDecode(raw);
          decodedArgs = decoded is Map
              ? decoded.cast<String, dynamic>()
              : <String, dynamic>{};
        } catch (_) {
          decodedArgs = {'_raw': raw};
        }
      }
      return AgentToolCall(
        id: call.id.isEmpty ? 'tool-${index + 1}' : call.id,
        name: call.name,
        arguments: decodedArgs,
      );
    }).toList();
  }
}

class _StreamingToolCall {
  String id = '';
  String name = '';
  final StringBuffer arguments = StringBuffer();
  bool startEmitted = false;
}

import 'dart:convert';

import 'package:http/http.dart' as http;

import 'agent_model.dart';
import 'agent_types.dart';

class OpenAiCompatibleModel implements AgentModel {
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
  }) async {
    cancellationToken.throwIfCancelled();
    final base = config.baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint =
        base.endsWith('/chat/completions') ? base : '$base/chat/completions';
    final request = http.AbortableRequest(
      'POST',
      Uri.parse(endpoint),
      abortTrigger: cancellationToken.whenCancelled,
    )
      ..headers.addAll({
        'Authorization': 'Bearer ${config.apiKey}',
        'Content-Type': 'application/json',
      })
      ..body = jsonEncode({
        'model': config.model,
        'stream': false,
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
    late http.Response response;
    try {
      final streamed =
          await _client.send(request).timeout(const Duration(seconds: 90));
      response = await http.Response.fromStream(streamed);
    } on http.RequestAbortedException {
      throw const AgentCancelledException();
    }
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

  @override
  void dispose() => _client.close();
}

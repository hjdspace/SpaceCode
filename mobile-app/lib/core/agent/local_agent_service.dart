import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config/mobile_config.dart';
import '../workspace/workspace_target.dart';
import 'agent_types.dart';

class LocalAgentService {
  final http.Client _client;

  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  /// 完成一次 Agent 调用，保留原签名兼容 chat_controller。
  ///
  /// 内部使用 SSE 流式接收，文本 delta 通过 [onEvent] 实时推送
  /// （`AgentEventType.assistantDelta`），完整文本作为返回值返回。
  Future<String> complete({
    required String sessionId,
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    required AgentCancellationToken cancellationToken,
    required void Function(AgentEvent) onEvent,
  }) async {
    if (config.apiKey.trim().isEmpty) {
      throw StateError('请先在设置中配置 API Key');
    }
    if (config.model.trim().isEmpty) {
      throw StateError('请先在设置中配置模型');
    }

    final base = config.baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint =
        base.endsWith('/chat/completions') ? base : '$base/chat/completions';
    final context = workspace?.promptContext;
    final messages = <Map<String, dynamic>>[
      {
        'role': 'system',
        'content': _buildSystemPrompt(context),
      },
      ...history.map(_agentMessageToJson),
      {'role': 'user', 'content': prompt},
    ];
    final tools = _buildTools(workspace);

    final buffer = StringBuffer();
    for (var attempt = 0; attempt < 8; attempt++) {
      cancellationToken.throwIfCancelled();

      final request = http.AbortableRequest(
        'POST',
        Uri.parse(endpoint),
        abortTrigger: cancellationToken.whenCancelled,
      )
        ..headers.addAll({
          'Authorization': 'Bearer ${config.apiKey}',
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        })
        ..body = jsonEncode({
          'model': config.model,
          'stream': true,
          'messages': messages,
          if (tools != null) 'tools': tools,
        });

      http.StreamedResponse response;
      try {
        response = await _client
            .send(request)
            .timeout(const Duration(seconds: 90));
      } on http.RequestAbortedException {
        throw const AgentCancelledException();
      }

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
        throw StateError(
            message?.toString() ?? '模型请求失败（${response.statusCode}）');
      }

      final toolCall = _ToolCallBuilder();
      final lineBuffer = StringBuffer();

      try {
        await for (final chunk in response.stream.transform(utf8.decoder)) {
          cancellationToken.throwIfCancelled();
          lineBuffer.write(chunk);
          final lines = lineBuffer.toString().split('\n');
          lineBuffer.clear();
          if (lines.isNotEmpty && !lines.last.endsWith('\n')) {
            lineBuffer.write(lines.removeLast());
          }
          for (final rawLine in lines) {
            final line = rawLine.trim();
            if (line.isEmpty || !line.startsWith('data:')) continue;
            final data = line.substring(5).trim();
            if (data == '[DONE]') {
              toolCall.markDone();
              continue;
            }
            try {
              final decoded = jsonDecode(data);
              if (decoded is! Map<String, dynamic>) continue;
              final choices = decoded['choices'];
              if (choices is! List || choices.isEmpty) continue;
              final choice = choices.first;
              if (choice is! Map<String, dynamic>) continue;
              final delta = choice['delta'];
              if (delta is! Map<String, dynamic>) continue;

              final content = delta['content'];
              if (content is String && content.isNotEmpty) {
                buffer.write(content);
                onEvent(AgentEvent(
                  type: AgentEventType.assistantDelta,
                  delta: content,
                ));
              }

              toolCall.consumeDelta(delta);
            } catch (_) {
              // 忽略解析错误的 chunk
            }
          }
        }
      } on http.RequestAbortedException {
        throw const AgentCancelledException();
      }

      toolCall.markDone();

      if (toolCall.hasToolCall) {
        final assistantMessage = toolCall.buildAssistantMessage();
        messages.add(assistantMessage);
        final toolCallId = toolCall.toolCallId;
        final toolName = toolCall.toolName;
        final toolArguments = toolCall.arguments;
        final decodedArgs = _decodeArguments(toolArguments);
        onEvent(AgentEvent(
          type: AgentEventType.toolExecutionStart,
          toolCall: AgentToolCall(
            id: toolCallId,
            name: toolName,
            arguments: decodedArgs,
          ),
        ));
        cancellationToken.throwIfCancelled();
        final toolResult = await _runTool(
          toolName,
          decodedArgs,
          workspace?.localPath,
        );
        onEvent(AgentEvent(
          type: AgentEventType.toolExecutionEnd,
          toolCall: AgentToolCall(
            id: toolCallId,
            name: toolName,
            arguments: decodedArgs,
          ),
          toolResult: toolResult,
          isError: toolResult.startsWith('工具执行失败'),
        ));
        messages.add({
          'role': 'tool',
          'tool_call_id': toolCallId,
          'content': toolResult,
        });
        continue;
      }
      return buffer.toString();
    }
    throw StateError('Agent 工具调用次数超出限制');
  }

  /// 兼容 chat_controller 调用：实际取消由 cancellationToken 控制
  void abort(String sessionId) {
    // no-op：cancellationToken.cancel() 由调用方触发，
    // AbortableRequest 会通过 abortTrigger 自动中断 HTTP 流
  }

  /// 重置 session 状态（noop，cancellationToken 由调用方管理）
  void resetSession(String sessionId) {
    // no-op
  }

  /// 从 API 获取可用模型列表（OpenAI 兼容 /models 接口）
  Future<List<String>> listModels({
    required String baseUrl,
    required String apiKey,
  }) async {
    if (apiKey.trim().isEmpty) throw StateError('请先配置 API Key');
    if (baseUrl.trim().isEmpty) throw StateError('请先配置 Base URL');

    final base = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint = base.endsWith('/models') ? base : '$base/models';
    final request = http.Request('GET', Uri.parse(endpoint))
      ..headers.addAll({
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      });
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 30));
    final body = await response.stream.bytesToString();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String? message;
      try {
        final decoded = jsonDecode(body);
        if (decoded is Map<String, dynamic>) {
          final err = decoded['error'];
          message = err is Map
              ? err['message']?.toString()
              : decoded['message']?.toString();
        }
      } catch (_) {
        message = body;
      }
      throw StateError(message ?? '获取模型列表失败（${response.statusCode}）');
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map<String, dynamic>) return const [];
    final data = decoded['data'];
    if (data is! List) return const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((m) => m['id'] as String?)
        .where((id) => id != null && id.isNotEmpty)
        .cast<String>()
        .toList();
  }

  Map<String, dynamic> _agentMessageToJson(AgentMessage message) {
    switch (message.role) {
      case AgentRole.user:
        return {'role': 'user', 'content': message.content};
      case AgentRole.assistant:
        if (message.toolCalls.isEmpty) {
          return {'role': 'assistant', 'content': message.content};
        }
        return {
          'role': 'assistant',
          'content': message.content.isEmpty ? null : message.content,
          'tool_calls': message.toolCalls
              .map((tc) => {
                    'id': tc.id,
                    'type': 'function',
                    'function': {
                      'name': tc.name,
                      'arguments': jsonEncode(tc.arguments),
                    },
                  })
              .toList(),
        };
      case AgentRole.tool:
        return {
          'role': 'tool',
          'tool_call_id': message.toolCallId ?? '',
          'content': message.content,
        };
    }
  }

  Map<String, dynamic> _decodeArguments(String json) {
    if (json.isEmpty) return const {};
    try {
      final decoded = jsonDecode(json);
      if (decoded is Map) return decoded.cast<String, dynamic>();
    } catch (_) {}
    return const {};
  }

  String _buildSystemPrompt(String? context) {
    const base = 'You are SpaceCode Mobile Agent, a professional coding assistant. '
        'Help the user complete coding tasks efficiently and concisely.\n'
        'IMPORTANT: You are SpaceCode Mobile Agent only. '
        'Never mention other AI products or brands (such as Pi, Claude, ChatGPT, etc.) in your responses. '
        'Never claim to be inspired by any other AI product. '
        'If asked about your identity, respond that you are SpaceCode Mobile Agent.';
    if (context == null) return base;
    return '$base\n\nWork within this workspace context:\n$context\n'
        'Use file tools to inspect and modify files, then summarize the changes.';
  }

  List<Map<String, dynamic>>? _buildTools(WorkspaceTarget? workspace) {
    if (workspace?.localPath == null) return null;
    return [
      {
        'type': 'function',
        'function': {
          'name': 'list_files',
          'description': 'List files in the workspace.',
          'parameters': {
            'type': 'object',
            'properties': {
              'path': {'type': 'string'}
            },
          },
        },
      },
      {
        'type': 'function',
        'function': {
          'name': 'read_file',
          'description': 'Read a UTF-8 text file from the workspace.',
          'parameters': {
            'type': 'object',
            'properties': {
              'path': {'type': 'string'}
            },
            'required': ['path'],
          },
        },
      },
      {
        'type': 'function',
        'function': {
          'name': 'write_file',
          'description': 'Write a UTF-8 text file in the workspace.',
          'parameters': {
            'type': 'object',
            'properties': {
              'path': {'type': 'string'},
              'content': {'type': 'string'},
            },
            'required': ['path', 'content'],
          },
        },
      },
    ];
  }

  Future<String> _runTool(
      String name, Map<String, dynamic> arguments, String? root) async {
    if (root == null) return '工具执行失败：工作目录未配置';
    try {
      switch (name) {
        case 'list_files':
          final directory =
              Directory(_safePath(root, arguments['path'] as String? ?? '.'));
          if (!await directory.exists()) return '目录不存在';
          final entries = await directory
              .list()
              .map((entry) => entry.path.substring(directory.path.length + 1))
              .toList();
          return entries.join('\n');
        case 'read_file':
          final file =
              File(_safePath(root, arguments['path'] as String? ?? ''));
          return await file.readAsString();
        case 'write_file':
          final file =
              File(_safePath(root, arguments['path'] as String? ?? ''));
          await file.parent.create(recursive: true);
          await file.writeAsString(arguments['content'] as String? ?? '');
          return '已写入 ${file.path}';
        default:
          return '未知工具：$name';
      }
    } catch (error) {
      return '工具执行失败：$error';
    }
  }

  String _safePath(String root, String relative) {
    final normalized = relative.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').contains('..')) {
      throw StateError('路径必须位于工作目录内');
    }
    return File(
            '$root${Platform.pathSeparator}${normalized == '.' ? '' : normalized.replaceAll('/', Platform.pathSeparator)}')
        .path;
  }

  void dispose() => _client.close();
}

/// 在 SSE 流中累积 tool_calls 信息。
class _ToolCallBuilder {
  String? _toolCallId;
  String? _toolName;
  final _arguments = StringBuffer();
  bool _hasToolCall = false;
  bool _done = false;

  bool get hasToolCall => _hasToolCall && _done;
  String get toolCallId => _toolCallId ?? '';
  String get toolName => _toolName ?? '';
  String get arguments => _arguments.toString();

  void consumeDelta(Map<String, dynamic> delta) {
    final toolCalls = delta['tool_calls'];
    if (toolCalls is! List || toolCalls.isEmpty) return;
    for (final tc in toolCalls.whereType<Map<String, dynamic>>()) {
      final id = tc['id'] as String?;
      final function = tc['function'];
      if (function is! Map<String, dynamic>) continue;
      _hasToolCall = true;
      if (_toolCallId == null && id != null) _toolCallId = id;
      final name = function['name'] as String?;
      if (_toolName == null && name != null) _toolName = name;
      final args = function['arguments'];
      if (args is String) _arguments.write(args);
    }
  }

  void markDone() {
    _done = true;
  }

  Map<String, dynamic> buildAssistantMessage() {
    return {
      'role': 'assistant',
      'content': null,
      'tool_calls': [
        {
          'id': toolCallId,
          'type': 'function',
          'function': {
            'name': toolName,
            'arguments': arguments,
          },
        }
      ],
    };
  }
}

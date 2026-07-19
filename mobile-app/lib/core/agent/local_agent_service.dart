import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config/mobile_config.dart';
import '../workspace/workspace_target.dart';

class LocalAgentService {
  final http.Client _client;

  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  Future<String> complete({
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
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
        'content': context == null
            ? 'You are SpaceCode Mobile Agent. Help the user complete coding tasks. Use the provided file tools when a workspace is available.'
            : 'You are SpaceCode Mobile Agent. Work within this workspace context:\n$context\nUse file tools to inspect and modify files, then summarize the changes.',
      },
      {'role': 'user', 'content': prompt},
    ];
    final tools = workspace?.localPath == null
        ? null
        : [
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

    for (var attempt = 0; attempt < 8; attempt++) {
      final response = await _client
          .post(
            Uri.parse(endpoint),
            headers: {
              'Authorization': 'Bearer ${config.apiKey}',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'model': config.model,
              'stream': false,
              'messages': messages,
              if (tools != null) 'tools': tools,
            }),
          )
          .timeout(const Duration(seconds: 90));

      final body = jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = body is Map<String, dynamic>
            ? (body['error'] is Map
                ? body['error']['message']
                : body['message'])
            : null;
        throw StateError(
            message?.toString() ?? '模型请求失败（${response.statusCode}）');
      }
      if (body is! Map<String, dynamic>) throw StateError('模型返回了无效响应');
      final choices = body['choices'];
      if (choices is! List || choices.isEmpty) throw StateError('模型没有返回内容');
      final message = choices.first is Map ? choices.first['message'] : null;
      if (message is! Map<String, dynamic>) throw StateError('模型返回了无效消息');
      final toolCalls = message['tool_calls'];
      if (toolCalls is List && toolCalls.isNotEmpty) {
        messages.add(message);
        for (final call in toolCalls.whereType<Map<String, dynamic>>()) {
          final function = call['function'];
          if (function is! Map<String, dynamic>) continue;
          final name = function['name'] as String? ?? '';
          final rawArguments = function['arguments'];
          final arguments = rawArguments is String
              ? jsonDecode(rawArguments) as Map<String, dynamic>
              : (rawArguments as Map?)?.cast<String, dynamic>() ??
                  <String, dynamic>{};
          final result = await _runTool(name, arguments, workspace!.localPath!);
          messages.add({
            'role': 'tool',
            'tool_call_id': call['id'] as String? ?? '',
            'content': result,
          });
        }
        continue;
      }
      final content = message['content'];
      if (content is String && content.isNotEmpty) return content;
      throw StateError('模型没有返回文本内容');
    }
    throw StateError('Agent 工具调用次数超出限制');
  }

  Future<String> _runTool(
      String name, Map<String, dynamic> arguments, String root) async {
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

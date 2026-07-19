import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/mobile_config.dart';
import '../skills/skill_registry.dart';
import '../workspace/workspace_target.dart';
import 'agent_loop.dart';
import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'openai_compatible_model.dart';
import 'plugins/skill_plugin.dart';
import 'plugins/workspace_plugin.dart';

class LocalAgentService {
  final http.Client _client;

  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  /// 完成一次 Agent 调用，保留原签名兼容 chat_controller。
  ///
  /// 内部构造 [AgentSession] + Plugins，委托给 [OpenAiCompatibleModel]。
  /// 文本 delta 通过 [onEvent] 实时推送（`AgentEventType.assistantDelta`），
  /// 完整文本作为返回值返回。
  Future<String> complete({
    required String sessionId,
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    required AgentCancellationToken cancellationToken,
    required void Function(AgentEvent) onEvent,
    SkillRegistryState? skillRegistry,
  }) async {
    if (config.apiKey.trim().isEmpty) {
      throw StateError('请先在设置中配置 API Key');
    }
    if (config.model.trim().isEmpty) {
      throw StateError('请先在设置中配置模型');
    }

    final model = OpenAiCompatibleModel(client: _client);
    final plugins = <AgentPlugin>[
      if (workspace?.localPath != null) WorkspacePlugin(workspace!.localPath!),
      if (skillRegistry != null && skillRegistry.skills.isNotEmpty)
        SkillPlugin(skillRegistry),
    ];

    final session = AgentSession(
      model: model,
      systemPrompt: _buildBaseSystemPrompt(workspace?.promptContext),
      plugins: plugins,
      initialMessages: history,
      maxTurns: 8,
    );

    final result = await session.run(
      prompt,
      config: AgentModelConfig(
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      ),
      cancellationToken: cancellationToken,
      onEvent: onEvent,
    );
    return result.text;
  }

  /// 兼容 chat_controller 调用：实际取消由 cancellationToken 控制。
  void abort(String sessionId) {
    // no-op
  }

  /// 重置 session 状态（noop，cancellationToken 由调用方管理）。
  void resetSession(String sessionId) {
    // no-op
  }

  /// 从 API 获取可用模型列表（OpenAI 兼容 /models 接口）。
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

  String _buildBaseSystemPrompt(String? context) {
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

  void dispose() => _client.close();
}

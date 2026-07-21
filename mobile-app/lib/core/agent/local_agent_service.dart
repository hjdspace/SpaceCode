import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../config/mobile_config.dart';
import '../skills/skill_registry.dart';
import '../workspace/workspace_target.dart';
import 'agent_loop.dart';
import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'binary_resolver.dart';
import 'openai_compatible_model.dart';
import 'permission_interceptor.dart';
import 'plugins/git_plugin.dart';
import 'plugins/shell_plugin.dart';
import 'plugins/skill_plugin.dart';
import 'plugins/workspace_plugin.dart';

/// 权限询问回调类型。
///
/// 由 [LocalAgentService.complete] 在收到 [AgentEventType.permissionRequest]
/// 事件时调用，UI 层（ChatNotifier）负责把请求加入 pendingPermissions 列表，
/// 并在用户响应后通过返回值告知 decision。
typedef LocalPermissionHandler = void Function(AgentEvent permissionEvent);

class LocalAgentService {
  final http.Client _client;

  LocalAgentService({http.Client? client}) : _client = client ?? http.Client();

  /// 完成一次 Agent 调用。
  ///
  /// [permissionMode] 从 SharedPreferences 读取并传入，影响所有 Plugin 的
  /// beforeToolCall 决策（default/plan/acceptEdits/bypassPermissions）。
  ///
  /// [onPermissionRequest] 在 AgentSession 推送 permissionRequest 事件时调用，
  /// UI 层渲染 PermissionCard，用户响应后通过 [resolvePermission] 注入。
  ///
  /// 返回值：最终 assistant 文本。
  Future<String> complete({
    required String sessionId,
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    required AgentCancellationToken cancellationToken,
    required void Function(AgentEvent) onEvent,
    SkillRegistryState? skillRegistry,
    String permissionMode = PermissionMode.defaultMode,
    LocalPermissionHandler? onPermissionRequest,
  }) async {
    if (config.apiKey.trim().isEmpty) {
      throw StateError('请先在设置中配置 API Key');
    }
    if (config.model.trim().isEmpty) {
      throw StateError('请先在设置中配置模型');
    }

    final model = OpenAiCompatibleModel(client: _client);
    final localPath = workspace?.localPath;
    final env = BinaryResolver.instance.isInitialized
        ? BinaryResolver.instance.environment
        : Platform.environment;
    final gitPath = BinaryResolver.instance.gitPath;
    final plugins = <AgentPlugin>[
      // 横切权限拦截器（不提供工具，只实现 beforeToolCall）
      PermissionInterceptorPlugin(),
      if (localPath != null) WorkspacePlugin(localPath),
      if (localPath != null)
        ShellPlugin(workingDirectory: localPath, environment: env),
      // GitPlugin 仅在 git 二进制可用时加载
      if (localPath != null && gitPath != null)
        GitPlugin(
          gitPath: gitPath,
          workingDirectory: localPath,
          environment: env,
        ),
      if (skillRegistry != null && skillRegistry.skills.isNotEmpty)
        SkillPlugin(skillRegistry),
    ];

    final session = AgentSession(
      model: model,
      systemPrompt: _buildBaseSystemPrompt(workspace?.promptContext),
      plugins: plugins,
      initialMessages: history,
      maxTurns: 8,
      permissionMode: permissionMode,
    );

    // 监听事件：把 permissionRequest 事件转发给 UI 层
    Future<AgentRunResult> runFuture = session.run(
      prompt,
      config: AgentModelConfig(
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      ),
      cancellationToken: cancellationToken,
      onEvent: (event) {
        if (event.type == AgentEventType.permissionRequest &&
            onPermissionRequest != null) {
          onPermissionRequest(event);
        }
        onEvent(event);
      },
    );

    // 暴露 session 给上层用于 resolvePermission
    _sessionsBySessionId[sessionId] = session;
    try {
      final result = await runFuture;
      return result.text;
    } finally {
      _sessionsBySessionId.remove(sessionId);
    }
  }

  /// 进行中的 AgentSession（按 sessionId 索引），用于权限响应注入。
  final Map<String, AgentSession> _sessionsBySessionId = {};

  /// 用户响应权限询问。
  ///
  /// 由 ChatNotifier 在用户点击 PermissionCard 后调用，转发给对应 sessionId
  /// 的 [AgentSession.resolvePermission]。
  void resolvePermission(String sessionId, String requestId,
      AgentToolDecision decision) {
    _sessionsBySessionId[sessionId]?.resolvePermission(requestId, decision);
  }

  /// 兼容 chat_controller 调用：实际取消由 cancellationToken 控制。
  void abort(String sessionId) {
    // no-op
  }

  /// 重置 session 状态（noop，cancellationToken 由调用方管理）。
  void resetSession(String sessionId) {
    _sessionsBySessionId.remove(sessionId);
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

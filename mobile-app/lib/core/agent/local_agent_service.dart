import 'package:http/http.dart' as http;

import '../config/mobile_config.dart';
import '../workspace/workspace_target.dart';
import 'agent_loop.dart';
import 'agent_model.dart';
import 'agent_plugin.dart';
import 'agent_types.dart';
import 'openai_compatible_model.dart';
import 'plugins/workspace_plugin.dart';

class LocalAgentService {
  final AgentModel _model;
  final List<AgentPlugin> _installedPlugins;
  final Map<String, _AgentSessionEntry> _sessions = {};
  final Map<String, AgentCancellationToken> _activeRuns = {};

  LocalAgentService({
    http.Client? client,
    AgentModel? model,
    List<AgentPlugin> plugins = const [],
  })  : _model = model ?? OpenAiCompatibleModel(client: client),
        _installedPlugins = List.unmodifiable(plugins);

  Future<String> complete({
    String sessionId = 'default',
    required MobileConfig config,
    required String prompt,
    WorkspaceTarget? workspace,
    List<AgentMessage> history = const [],
    AgentCancellationToken? cancellationToken,
    AgentEventListener? onEvent,
  }) async {
    if (config.apiKey.trim().isEmpty) {
      throw StateError('请先在设置中配置 API Key');
    }
    if (config.baseUrl.trim().isEmpty) {
      throw StateError('请先在设置中配置 Base URL');
    }
    if (config.model.trim().isEmpty) {
      throw StateError('请先在设置中配置模型');
    }

    final workspaceKey =
        '${workspace?.mode.name}:${workspace?.repository ?? ''}:${workspace?.branch ?? ''}:${workspace?.localPath ?? ''}';
    var entry = _sessions[sessionId];
    if (entry == null || entry.workspaceKey != workspaceKey) {
      entry = _AgentSessionEntry(
        workspaceKey: workspaceKey,
        session: AgentSession(
          model: _model,
          systemPrompt: _systemPrompt(workspace),
          plugins: _plugins(workspace),
          initialMessages: history,
        ),
      );
      _sessions[sessionId] = entry;
    }

    final token = cancellationToken ?? AgentCancellationToken();
    _activeRuns[sessionId]?.cancel();
    _activeRuns[sessionId] = token;
    try {
      final result = await entry.session.run(
        prompt,
        config: AgentModelConfig(
          apiKey: config.apiKey.trim(),
          baseUrl: config.baseUrl.trim(),
          model: config.model.trim(),
        ),
        cancellationToken: token,
        onEvent: onEvent,
      );
      return result.text;
    } finally {
      if (identical(_activeRuns[sessionId], token)) {
        _activeRuns.remove(sessionId);
      }
    }
  }

  List<AgentPlugin> _plugins(WorkspaceTarget? workspace) {
    final path = workspace?.localPath;
    return [
      ..._installedPlugins,
      if (path != null && path.isNotEmpty) WorkspacePlugin(path),
    ];
  }

  String _systemPrompt(WorkspaceTarget? workspace) {
    final context = workspace?.promptContext;
    return '''You are SpaceCode Mobile Coding Agent, a small autonomous coding agent inspired by Pi.

Rules:
- Inspect relevant files before editing.
- Use edit_file for focused changes and write_file only for new files or full replacements.
- Keep all file operations inside the workspace.
- Verify your work with read_file or grep_files after editing.
- Do not claim a file changed unless a tool result confirms it.
- When no workspace tools are available, explain that limitation instead of inventing changes.
${context == null ? '' : '\nWorkspace:\n$context'}''';
  }

  void abort(String sessionId) {
    _activeRuns[sessionId]?.cancel();
  }

  void resetSession(String sessionId) {
    abort(sessionId);
    _sessions.remove(sessionId);
  }

  void dispose() {
    for (final token in _activeRuns.values) {
      token.cancel();
    }
    _activeRuns.clear();
    _sessions.clear();
    _model.dispose();
  }
}

class _AgentSessionEntry {
  final String workspaceKey;
  final AgentSession session;

  const _AgentSessionEntry({
    required this.workspaceKey,
    required this.session,
  });
}

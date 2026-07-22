import 'agent_model.dart';
import 'agent_types.dart';

enum AgentToolExecutionMode { parallel, sequential }

class AgentToolResult {
  final String content;
  final bool isError;

  const AgentToolResult({
    required this.content,
    this.isError = false,
  });
}

abstract class AgentTool {
  AgentToolDefinition get definition;
  AgentToolExecutionMode get executionMode => AgentToolExecutionMode.parallel;

  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  );
}

class AgentToolDecision {
  final bool allowed;
  final String? reason;

  const AgentToolDecision.allow()
      : allowed = true,
        reason = null;

  const AgentToolDecision.deny(this.reason) : allowed = false;
}

/// 权限模式常量。
///
/// 与桌面端 engine / mobile-app SharedPreferences 中的字符串值保持一致。
class PermissionMode {
  static const defaultMode = 'default';
  static const plan = 'plan';
  static const acceptEdits = 'acceptEdits';
  static const bypassPermissions = 'bypassPermissions';

  static const all = [defaultMode, plan, acceptEdits, bypassPermissions];
}

abstract class AgentPlugin {
  List<AgentTool> createTools() => const [];

  /// 工具调用前的拦截钩子。
  ///
  /// [permissionMode] 为当前会话的权限模式（default/plan/acceptEdits/bypassPermissions）。
  /// Plugin 可基于此判断是否：
  /// - 直接允许（return AgentToolDecision.allow()）
  /// - 直接拒绝（return AgentToolDecision.deny(reason)）
  /// - 抛 [PermissionRequestedException] 请求用户决定
  ///
  /// 默认实现：允许所有工具调用（向后兼容现有 Plugin）。
  Future<AgentToolDecision> beforeToolCall(
    AgentToolCall call, {
    String permissionMode = PermissionMode.defaultMode,
  }) async {
    return const AgentToolDecision.allow();
  }

  Future<void> afterToolCall(
      AgentToolCall call, AgentToolResult result) async {}

  /// 返回追加到 systemPrompt 末尾的文本，默认空。
  /// AgentSession 在每次调用 model.complete 前拼接所有 plugin 的 suffix。
  String buildSystemPromptSuffix() => '';
}

class AgentToolRegistry {
  final Map<String, AgentTool> _tools = {};
  final List<AgentPlugin> plugins;

  AgentToolRegistry(this.plugins) {
    for (final plugin in plugins) {
      for (final tool in plugin.createTools()) {
        if (_tools.containsKey(tool.definition.name)) {
          throw StateError('Duplicate agent tool: ${tool.definition.name}');
        }
        _tools[tool.definition.name] = tool;
      }
    }
  }

  List<AgentToolDefinition> get definitions =>
      _tools.values.map((tool) => tool.definition).toList(growable: false);

  AgentTool? find(String name) => _tools[name];
}

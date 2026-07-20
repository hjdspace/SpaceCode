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

abstract class AgentPlugin {
  List<AgentTool> createTools() => const [];

  Future<AgentToolDecision> beforeToolCall(AgentToolCall call) async {
    return const AgentToolDecision.allow();
  }

  Future<void> afterToolCall(
      AgentToolCall call, AgentToolResult result) async {}
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

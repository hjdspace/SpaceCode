import 'agent_types.dart';

class AgentModelConfig {
  final String apiKey;
  final String baseUrl;
  final String model;

  const AgentModelConfig({
    required this.apiKey,
    required this.baseUrl,
    required this.model,
  });
}

class AgentToolDefinition {
  final String name;
  final String description;
  final Map<String, dynamic> inputSchema;

  const AgentToolDefinition({
    required this.name,
    required this.description,
    required this.inputSchema,
  });
}

class AgentModelResponse {
  final String text;
  final List<AgentToolCall> toolCalls;

  const AgentModelResponse({
    this.text = '',
    this.toolCalls = const [],
  });
}

abstract class AgentModel {
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
  });

  void dispose() {}
}

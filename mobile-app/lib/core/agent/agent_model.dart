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

/// 流式工具调用回调类型。
///
/// 在 LLM 生成工具参数（input_json_delta）时触发，让 UI 能即时显示
/// "运行中" 的工具卡片，无需等待整个 LLM 响应结束。
typedef AgentToolCallStartCallback = void Function(
  String toolCallId,
  String toolName,
);

typedef AgentToolCallDeltaCallback = void Function(
  String toolCallId,
  String partialJson,
);

typedef AgentToolCallStopCallback = void Function(
  String toolCallId,
  String fullJson,
);

abstract class AgentModel {
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
    /// 流式工具调用回调（可选）。
    ///
    /// - [onToolCallStart]：LLM 开始生成某个工具调用时触发（已收到 id + name）。
    /// - [onToolCallDelta]：每收到一段 input_json_delta 时触发，参数为累积的 partial JSON。
    /// - [onToolCallStop]：工具调用的 input JSON 流式结束时触发，参数为完整 JSON 字符串。
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  });

  void dispose() {}
}

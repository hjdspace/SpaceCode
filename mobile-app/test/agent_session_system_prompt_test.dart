import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_loop.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';

class _SuffixModel extends AgentModel {
  String? capturedSystemPrompt;

  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    capturedSystemPrompt = systemPrompt;
    return const AgentModelResponse(text: 'done');
  }
}

class _SuffixPlugin extends AgentPlugin {
  final String suffix;
  _SuffixPlugin(this.suffix);

  @override
  String buildSystemPromptSuffix() => suffix;
}

void main() {
  test('AgentSession concatenates plugin systemPrompt suffix', () async {
    final model = _SuffixModel();
    final session = AgentSession(
      model: model,
      systemPrompt: 'BASE',
      plugins: [_SuffixPlugin('\nSUFFIX_A')],
    );

    await session.run(
      'hi',
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
    );

    expect(model.capturedSystemPrompt, 'BASE\nSUFFIX_A');
  });

  test('AgentSession forwards onDelta to onEvent', () async {
    final model = _DeltaModel();
    final session = AgentSession(model: model, systemPrompt: 'BASE');
    final deltas = <String>[];

    await session.run(
      'hi',
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      onEvent: (event) {
        if (event.type == AgentEventType.assistantDelta && event.delta != null) {
          deltas.add(event.delta!);
        }
      },
    );

    expect(deltas, ['Hel', 'lo']);
  });
}

class _DeltaModel extends AgentModel {
  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
  }) async {
    onDelta?.call('Hel');
    onDelta?.call('lo');
    return const AgentModelResponse(text: 'Hello');
  }
}

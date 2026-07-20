import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';

void main() {
  group('ChatMessage.timelineEvents', () {
    test('hasTimeline is false when timelineEvents is null', () {
      final msg = ChatMessage(id: 'm1', role: MessageRole.assistant);
      expect(msg.hasTimeline, isFalse);
    });

    test('hasTimeline is false when timelineEvents is empty', () {
      final msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: const [],
      );
      expect(msg.hasTimeline, isFalse);
    });

    test('hasTimeline is true when timelineEvents is non-empty', () {
      final msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.text,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.completed,
            content: 'hi',
          ),
        ],
      );
      expect(msg.hasTimeline, isTrue);
    });

    test('toJson serializes timelineEvents when non-null', () {
      final msg = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.toolCall,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.running,
            toolCallId: 'tc1',
          ),
        ],
      );
      final json = msg.toJson();
      expect(json['timelineEvents'], isA<List>());
      expect((json['timelineEvents'] as List).length, 1);
    });

    test('fromJson returns null timelineEvents when field is absent (backward compat)',
        () {
      final json = {
        'id': 'm1',
        'role': 'assistant',
        'content': 'hi',
        'isStreaming': false,
        'timestamp': DateTime(2026, 7, 21).toIso8601String(),
      };
      final msg = ChatMessage.fromJson(json);
      expect(msg.timelineEvents, isNull);
      expect(msg.hasTimeline, isFalse);
    });

    test('fromJson roundtrip preserves timelineEvents', () {
      final original = ChatMessage(
        id: 'm1',
        role: MessageRole.assistant,
        content: 'hello',
        isStreaming: false,
        toolCalls: const [
          ToolCall(id: 'tc1', toolName: 'list_files', input: '{}'),
        ],
        timelineEvents: [
          TimelineEvent(
            id: 'e1',
            type: TimelineEventType.text,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.completed,
            content: 'hello',
          ),
          TimelineEvent(
            id: 'e2',
            type: TimelineEventType.toolCall,
            timestamp: DateTime(2026, 7, 21),
            status: TimelineEventStatus.running,
            toolCallId: 'tc1',
          ),
        ],
      );
      final decoded = ChatMessage.fromJson(original.toJson());
      expect(decoded.timelineEvents?.length, 2);
      expect(decoded.timelineEvents![0].content, 'hello');
      expect(decoded.timelineEvents![1].toolCallId, 'tc1');
    });
  });
}

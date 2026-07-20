import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';

void main() {
  group('TimelineEvent', () {
    test('copyWith does not modify the original instance', () {
      final original = TimelineEvent(
        id: 'evt-1',
        type: TimelineEventType.text,
        timestamp: DateTime(2026, 7, 21),
        status: TimelineEventStatus.running,
        content: 'hello',
      );
      final copied = original.copyWith(
        status: TimelineEventStatus.completed,
        content: 'hello world',
      );
      expect(original.status, TimelineEventStatus.running);
      expect(original.content, 'hello');
      expect(copied.status, TimelineEventStatus.completed);
      expect(copied.content, 'hello world');
      expect(copied.id, 'evt-1');
      expect(copied.type, TimelineEventType.text);
    });

    test('toJson/fromJson roundtrip preserves all fields', () {
      final ts = DateTime(2026, 7, 21, 10, 30);
      final original = TimelineEvent(
        id: 'evt-2',
        type: TimelineEventType.toolCall,
        timestamp: ts,
        status: TimelineEventStatus.completed,
        toolCallId: 'tc-abc',
      );
      final decoded = TimelineEvent.fromJson(original.toJson());
      expect(decoded.id, 'evt-2');
      expect(decoded.type, TimelineEventType.toolCall);
      expect(decoded.status, TimelineEventStatus.completed);
      expect(decoded.toolCallId, 'tc-abc');
      expect(decoded.timestamp.toIso8601String(), ts.toIso8601String());
    });

    test('fromJson handles missing optional fields with defaults', () {
      final decoded = TimelineEvent.fromJson({
        'id': 'evt-3',
        'type': 'text',
        'status': 'running',
        'timestamp': DateTime(2026, 1, 1).toIso8601String(),
      });
      expect(decoded.content, isNull);
      expect(decoded.toolCallId, isNull);
      expect(decoded.metadata, isNull);
    });

    test('metadata roundtrip preserves map structure', () {
      final original = TimelineEvent(
        id: 'evt-4',
        type: TimelineEventType.metadata,
        timestamp: DateTime(2026, 7, 21),
        status: TimelineEventStatus.completed,
        metadata: {'model': 'gpt-4', 'tokens': 42},
      );
      final decoded = TimelineEvent.fromJson(original.toJson());
      expect(decoded.metadata, {'model': 'gpt-4', 'tokens': 42});
    });
  });
}

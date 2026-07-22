import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';
import 'package:spacecode_mobile/features/chat/timeline_assembler.dart';

void main() {
  group('TimelineAssembler', () {
    test('appendTextDelta creates a new running text event on first delta', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('Hello');
      expect(assembler.events.length, 1);
      expect(assembler.events.first.type, TimelineEventType.text);
      expect(assembler.events.first.status, TimelineEventStatus.running);
      expect(assembler.events.first.content, 'Hello');
    });

    test('appendTextDelta accumulates content into the current text event', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('Hello');
      assembler.appendTextDelta(' world');
      expect(assembler.events.length, 1);
      expect(assembler.events.first.content, 'Hello world');
    });

    test('addToolCall closes the current text event and appends toolCall event', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('thinking...');
      const toolCall = ToolCall(
        id: 'tc-1',
        toolName: 'list_files',
        input: '{"path":"."}',
      );
      assembler.addToolCall(toolCall);

      expect(assembler.events.length, 2);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].status, TimelineEventStatus.completed);
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[1].status, TimelineEventStatus.running);
      expect(assembler.events[1].toolCallId, 'tc-1');
    });

    test('text after toolCall creates a NEW text event (time ordering)', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('before');
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.appendTextDelta('after');

      expect(assembler.events.length, 3);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].content, 'before');
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[2].type, TimelineEventType.text);
      expect(assembler.events[2].content, 'after');
      expect(assembler.events[2].status, TimelineEventStatus.running);
    });

    test('completeToolCall updates status to completed', () {
      final assembler = TimelineAssembler();
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.completeToolCall('tc-1', ToolCallStatus.completed);

      expect(assembler.events.first.status, TimelineEventStatus.completed);
    });

    test('completeToolCall updates status to error when tool result is error', () {
      final assembler = TimelineAssembler();
      const toolCall = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      assembler.addToolCall(toolCall);
      assembler.completeToolCall('tc-1', ToolCallStatus.error);

      expect(assembler.events.first.status, TimelineEventStatus.error);
    });

    test('empty content text event is removed when closed', () {
      final assembler = TimelineAssembler();
      // 仅追加空 delta（不会创建事件，因为 delta 为空时直接 return）
      assembler.appendTextDelta('');
      assembler.completeTurn();
      expect(assembler.events, isEmpty);
    });

    test('non-empty text event is marked completed on completeTurn', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('partial');
      assembler.completeTurn();
      expect(assembler.events.length, 1);
      expect(assembler.events.first.status, TimelineEventStatus.completed);
    });

    test('multiple toolCalls preserve time ordering', () {
      final assembler = TimelineAssembler();
      assembler.appendTextDelta('intro');
      const tc1 = ToolCall(id: 'tc-1', toolName: 'list_files', input: '');
      const tc2 = ToolCall(id: 'tc-2', toolName: 'read_file', input: '');
      assembler.addToolCall(tc1);
      assembler.appendTextDelta('middle');
      assembler.addToolCall(tc2);
      assembler.appendTextDelta('end');
      assembler.completeTurn();

      expect(assembler.events.length, 5);
      expect(assembler.events[0].type, TimelineEventType.text);
      expect(assembler.events[0].content, 'intro');
      expect(assembler.events[1].type, TimelineEventType.toolCall);
      expect(assembler.events[1].toolCallId, 'tc-1');
      expect(assembler.events[2].type, TimelineEventType.text);
      expect(assembler.events[2].content, 'middle');
      expect(assembler.events[3].type, TimelineEventType.toolCall);
      expect(assembler.events[3].toolCallId, 'tc-2');
      expect(assembler.events[4].type, TimelineEventType.text);
      expect(assembler.events[4].content, 'end');
    });

    test('appendReasoningDelta creates a separate reasoning event', () {
      final assembler = TimelineAssembler();
      assembler.appendReasoningDelta('thinking...');
      assembler.appendTextDelta('answer');
      assembler.completeTurn();

      expect(assembler.events.length, 2);
      expect(assembler.events[0].type, TimelineEventType.reasoning);
      expect(assembler.events[0].content, 'thinking...');
      expect(assembler.events[1].type, TimelineEventType.text);
      expect(assembler.events[1].content, 'answer');
    });
  });
}

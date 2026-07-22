import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/chat/models/timeline_event.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';
import 'package:spacecode_mobile/features/chat/widgets/message_bubble.dart';

void main() {
  testWidgets('legacy path renders content text when timelineEvents is null',
      (tester) async {
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'hello world',
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('hello world'), findsOneWidget);
  });

  testWidgets('timeline path renders text events in order', (tester) async {
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'beforeafter',
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'before',
        ),
        TimelineEvent(
          id: 'e2',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'after',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('before'), findsOneWidget);
    expect(find.text('after'), findsOneWidget);
  });

  testWidgets('timeline path renders toolCall card between text events',
      (tester) async {
    const toolCall = ToolCall(
      id: 'tc1',
      toolName: 'list_files',
      input: '{"path":"."}',
      output: 'file1.txt',
      status: ToolCallStatus.completed,
    );
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.assistant,
      content: 'beforeafter',
      toolCalls: const [toolCall],
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'before',
        ),
        TimelineEvent(
          id: 'e2',
          type: TimelineEventType.toolCall,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          toolCallId: 'tc1',
        ),
        TimelineEvent(
          id: 'e3',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'after',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );

    // 文本按顺序渲染
    expect(find.text('before'), findsOneWidget);
    expect(find.text('after'), findsOneWidget);
    // 工具调用卡片存在
    expect(find.text('list_files'), findsOneWidget);
  });

  testWidgets('user message always uses legacy path', (tester) async {
    final msg = ChatMessage(
      id: 'm1',
      role: MessageRole.user,
      content: 'my question',
      timelineEvents: [
        TimelineEvent(
          id: 'e1',
          type: TimelineEventType.text,
          timestamp: DateTime(2026, 7, 21),
          status: TimelineEventStatus.completed,
          content: 'should not show',
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MessageBubble(message: msg))),
    );
    expect(find.text('my question'), findsOneWidget);
    expect(find.text('should not show'), findsNothing);
  });
}

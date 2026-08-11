import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/widgets/code_block.dart';
import 'package:spacecode_mobile/features/chat/widgets/markdown_renderer.dart';

void main() {
  testWidgets('renders a streaming fenced code block without framework errors',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: MarkdownRenderer(
            content: '```dart\nvoid main() {}\n```',
            isStreaming: true,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(CodeBlock), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('stays safe while a fenced code block grows across deltas',
      (tester) async {
    const deltas = [
      '```dart\n',
      '```dart\nfinal answer = 42;',
      '```dart\nfinal answer = 42;\n```',
    ];

    for (final content in deltas) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MarkdownRenderer(content: content, isStreaming: true),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'content: $content');
    }
  });
}

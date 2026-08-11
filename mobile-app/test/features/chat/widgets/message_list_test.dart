import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/chat_controller.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/chat/widgets/message_list.dart';

void main() {
  Future<ProviderContainer> pumpMessageList(WidgetTester tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: Scaffold(body: MessageList())),
      ),
    );
    await tester.pumpAndSettle();
    return container;
  }

  testWidgets('renders empty state when no messages', (tester) async {
    await pumpMessageList(tester);
    expect(find.text('开始对话'), findsOneWidget);
  });

  testWidgets('renders messages after provider updates', (tester) async {
    final container = await pumpMessageList(tester);
    final notifier = container.read(chatProvider.notifier);
    notifier.newSession();
    notifier.addMessageForTest(
      ChatMessage(id: 'm1', role: MessageRole.user, content: 'hello'),
    );
    await tester.pumpAndSettle();
    expect(find.text('hello'), findsOneWidget);
  });

  testWidgets('does not throw after widget is disposed', (tester) async {
    final container = await pumpMessageList(tester);
    final notifier = container.read(chatProvider.notifier);

    // Dispose the MessageList by replacing the widget tree.
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: Scaffold(body: SizedBox())),
      ),
    );
    await tester.pumpAndSettle();

    // Updating the provider after disposal should not trigger setState on
    // the already-disposed MessageList state.
    notifier.newSession();
    notifier.addMessageForTest(
      ChatMessage(id: 'm2', role: MessageRole.user, content: 'after dispose'),
    );
    await tester.pumpAndSettle();
  });
}

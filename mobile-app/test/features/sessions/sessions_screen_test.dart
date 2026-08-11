import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/features/chat/chat_controller.dart';
import 'package:spacecode_mobile/features/chat/models/message.dart';
import 'package:spacecode_mobile/features/sessions/sessions_screen.dart';

void main() {
  setUp(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'sessions.title': '历史会话',
        'sessions.newSession': '新建会话',
        'sessions.newChat': '新对话',
        'sessions.newChatSubtitle': '开始新的聊天',
        'sessions.messageCount': '{count} 条消息',
        'sessions.justNow': '刚刚',
        'sessions.uncategorized': '未分类',
      },
    );
    SharedPreferences.setMockInitialValues({
      'chat_history': jsonEncode({
        'currentSessionId': 'active-session',
        'sessions': [
          _sessionJson('active-session', '当前会话', '2026-07-24T12:00:00.000'),
          _sessionJson('history-session', '历史会话 A', '2026-07-24T12:01:00.000'),
        ],
      }),
    });
  });

  testWidgets(
      'switching a history session waits for its state update before closing the drawer',
      (tester) async {
    final scaffoldKey = GlobalKey<ScaffoldState>();
    late _DelayedChatNotifier chatNotifier;
    final container = ProviderContainer(overrides: [
      chatProvider.overrideWith((ref) {
        chatNotifier = _DelayedChatNotifier(ref);
        return chatNotifier;
      }),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: Scaffold(
            key: scaffoldKey,
            drawer: const Drawer(child: SessionsScreen()),
            body: Builder(
              builder: (context) => IconButton(
                icon: const Icon(Icons.menu),
                onPressed: () => Scaffold.of(context).openDrawer(),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.menu));
    await tester.pumpAndSettle();
    expect(find.text('历史会话 A'), findsOneWidget);

    // Simulate a streaming LLM event while the session drawer is visible.
    container.read(chatProvider.notifier).addMessageForTest(
          ChatMessage(
            id: 'streaming-message',
            role: MessageRole.assistant,
            content: 'streaming',
            isStreaming: true,
          ),
        );
    await tester.pump();

    await tester.tap(find.text('历史会话 A'));
    await tester.pump(const Duration(milliseconds: 500));

    expect(chatNotifier.switchStarted, isTrue);
    expect(scaffoldKey.currentState!.isDrawerOpen, isTrue);

    chatNotifier.completeSwitch();
    await tester.pumpAndSettle();

    expect(container.read(chatProvider).currentSessionId, 'history-session');
    expect(scaffoldKey.currentState!.isDrawerOpen, isFalse);
    expect(find.text('历史会话 A'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

class _DelayedChatNotifier extends ChatNotifier {
  final _switchCompleter = Completer<void>();
  bool switchStarted = false;

  _DelayedChatNotifier(super.ref);

  @override
  Future<void> switchToSession(String sessionId) async {
    switchStarted = true;
    await _switchCompleter.future;
    state = state.copyWith(currentSessionId: sessionId);
  }

  void completeSwitch() => _switchCompleter.complete();
}

Map<String, Object> _sessionJson(String id, String title, String updatedAt) => {
      'id': id,
      'title': title,
      'createdAt': updatedAt,
      'updatedAt': updatedAt,
      'messageCount': 0,
      'messages': <Object>[],
    };

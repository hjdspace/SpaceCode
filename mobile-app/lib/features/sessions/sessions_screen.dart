import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../chat/chat_controller.dart';
import 'session_tile.dart';

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('会话'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: '新建会话',
            onPressed: () {
              ref.read(chatProvider.notifier).newSession();
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        children: [
          SessionTile(
            title: '新对话',
            subtitle: '开始新的对话',
            isActive: true,
            onTap: () => Navigator.of(context).pop(),
          ),
          const Divider(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(
              '历史会话',
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          // Placeholder for session list — will be populated from WS data
          Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                children: [
                  Icon(
                    Icons.history_rounded,
                    size: 36,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.15),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '暂无历史会话',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

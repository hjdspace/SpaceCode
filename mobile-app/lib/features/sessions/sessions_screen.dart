import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../chat/chat_controller.dart';
import 'session_tile.dart';

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final chatState = ref.watch(chatProvider);
    final sessions = chatState.sessions;
    final currentId = chatState.currentSessionId;

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
            isActive: currentId == null,
            onTap: () {
              ref.read(chatProvider.notifier).newSession();
              Navigator.of(context).pop();
            },
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
          if (sessions.isEmpty)
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
            )
          else
            ...sessions.map((s) => Dismissible(
                  key: ValueKey(s.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: theme.colorScheme.error,
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 16),
                    child: Icon(Icons.delete_outline,
                        color: theme.colorScheme.onError),
                  ),
                  onDismissed: (_) {
                    ref.read(chatProvider.notifier).deleteSession(s.id);
                  },
                  child: SessionTile(
                    title: s.title,
                    subtitle: _formatSubtitle(s),
                    isActive: s.id == currentId,
                    onTap: () {
                      ref.read(chatProvider.notifier).switchToSession(s.id);
                      Navigator.of(context).pop();
                    },
                  ),
                )),
        ],
      ),
    );
  }

  String _formatSubtitle(dynamic s) {
    final parts = <String>[];
    if (s.projectPath != null && s.projectPath!.isNotEmpty) {
      parts.add(_basename(s.projectPath!));
    }
    parts.add('${s.messageCount} 条消息');
    final delta = DateTime.now().difference(s.updatedAt);
    if (delta.inMinutes < 1) {
      parts.add('刚刚');
    } else if (delta.inHours < 1) {
      parts.add('${delta.inMinutes}分钟前');
    } else if (delta.inDays < 1) {
      parts.add('${delta.inHours}小时前');
    } else if (delta.inDays < 7) {
      parts.add('${delta.inDays}天前');
    } else {
      parts.add('${s.updatedAt.month}/${s.updatedAt.day}');
    }
    return parts.join(' · ');
  }

  String _basename(String path) {
    // 同时支持 Windows 反斜杠和 POSIX 正斜杠
    final normalized = path.replaceAll('\\', '/');
    final idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(idx + 1) : normalized;
  }
}

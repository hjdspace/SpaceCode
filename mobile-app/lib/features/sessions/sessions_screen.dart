import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/storage/chat_history_storage.dart';
import '../../../core/workspace/workspace_target.dart';
import '../chat/chat_controller.dart';
import 'session_tile.dart';

/// 会话按项目分组后的数据模型。
class _SessionGroup {
  /// 分组显示名称（项目名或"未分类"）。
  final String displayName;

  /// 分组排序用的 key（workspaceTarget 的标识）。
  final String groupKey;

  /// 该分组下的会话列表（按 updatedAt 降序）。
  final List<SessionSummaryItem> sessions;

  /// 是否为云端（GitHub）项目。
  final bool isCloud;

  /// 副标题（云端项目显示仓库名，本地项目显示路径）。
  final String? subtitle;

  _SessionGroup({
    required this.displayName,
    required this.groupKey,
    required this.sessions,
    required this.isCloud,
    this.subtitle,
  });
}

/// 包装 SessionSummary 以携带额外排序信息。
class SessionSummaryItem {
  final SessionSummary summary;
  SessionSummaryItem(this.summary);
}

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final chatState = ref.watch(chatProvider);
    final sessions = chatState.sessions;
    final currentId = chatState.currentSessionId;

    // 按项目分组
    final groups = _groupSessionsByProject(sessions);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text(I18n.t('sessions.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: I18n.t('sessions.newSession'),
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
          // 新对话入口
          SessionTile(
            title: I18n.t('sessions.newChat'),
            subtitle: I18n.t('sessions.newChatSubtitle'),
            isActive: currentId == null,
            onTap: () {
              ref.read(chatProvider.notifier).newSession();
              Navigator.of(context).pop();
            },
          ),
          const Divider(height: 16),

          // 历史会话分组列表
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
                      I18n.t('sessions.empty'),
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
            ...groups.map((group) => _buildGroupSection(context, ref, group, currentId)),
        ],
      ),
    );
  }

  /// 构建单个项目分组的 section：标题 + 会话列表。
  Widget _buildGroupSection(
    BuildContext context,
    WidgetRef ref,
    _SessionGroup group,
    String? currentId,
  ) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 分组标题栏
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Row(
            children: [
              Icon(
                group.isCloud ? Icons.cloud_outlined : Icons.folder_outlined,
                size: 14,
                color: group.isCloud
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  group.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: group.isCloud
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (group.subtitle != null) ...[
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    group.subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        // 该分组下的会话列表
        ...group.sessions.map((item) => Dismissible(
              key: ValueKey(item.summary.id),
              direction: DismissDirection.endToStart,
              background: Container(
                color: theme.colorScheme.error,
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.only(right: 16),
                child: Icon(Icons.delete_outline,
                    color: theme.colorScheme.onError),
              ),
              onDismissed: (_) {
                ref.read(chatProvider.notifier).deleteSession(item.summary.id);
              },
              child: SessionTile(
                title: item.summary.title,
                subtitle: _formatSubtitle(item.summary),
                isActive: item.summary.id == currentId,
                onTap: () async {
                  // 必须先 await 状态更新完成再 pop，否则 Drawer 关闭动画期间
                  // SessionsScreen（ConsumerWidget）正在卸载，switchToSession
                  // 的 state.copyWith 会通知已卸载的 widget 重建，触发
                  // InheritedElement.unmount 的 '_dependents.isEmpty' 断言失败。
                  await ref
                      .read(chatProvider.notifier)
                      .switchToSession(item.summary.id);
                  if (context.mounted) {
                    Navigator.of(context).pop();
                  }
                },
              ),
            )),
      ],
    );
  }

  /// 将会话列表按项目分组。
  ///
  /// 分组规则：
  /// - 有 workspaceTarget 的会话按 target 分组（本地按 localPath，GitHub 按 repository）
  /// - 无 workspaceTarget 但有 projectPath 的按 projectPath 分组
  /// - 都没有的归入"未分类"
  /// - 每个分组内按 updatedAt 降序排列
  /// - 分组间按最新会话时间降序排列
  List<_SessionGroup> _groupSessionsByProject(List<SessionSummary> sessions) {
    final groupMap = <String, List<SessionSummary>>{};

    for (final s in sessions) {
      final key = _groupKeyForSession(s);
      groupMap.putIfAbsent(key, () => []).add(s);
    }

    // 为每个分组构建元信息
    final groups = groupMap.entries.map((entry) {
      final key = entry.key;
      final groupSessions = entry.value
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

      // 从第一个会话推断分组信息
      final first = groupSessions.first;
      final target = first.workspaceTarget;

      String displayName;
      bool isCloud = false;
      String? subtitle;

      if (target != null) {
        if (target.mode == WorkspaceMode.github) {
          isCloud = true;
          // GitHub 仓库全名如 "user/repo"，只取 repo 部分
          final repo = target.repository ?? '';
          final repoParts = repo.split('/');
          displayName = repoParts.isNotEmpty ? repoParts.last : repo;
          if (repoParts.length > 1) {
            subtitle = repoParts.first;
          }
        } else {
          // 本地模式
          displayName = target.localPath != null
              ? _basename(target.localPath!)
              : I18n.t('sessions.uncategorized');
          subtitle = target.localPath;
        }
      } else if (first.projectPath != null && first.projectPath!.isNotEmpty) {
        displayName = _basename(first.projectPath!);
        subtitle = first.projectPath;
      } else {
        displayName = I18n.t('sessions.uncategorized');
      }

      return _SessionGroup(
        displayName: displayName,
        groupKey: key,
        sessions: groupSessions.map((s) => SessionSummaryItem(s)).toList(),
        isCloud: isCloud,
        subtitle: subtitle != displayName ? subtitle : null,
      );
    }).toList();

    // 分组间按最新会话时间降序排列
    groups.sort((a, b) {
      final aTime = a.sessions.first.summary.updatedAt;
      final bTime = b.sessions.first.summary.updatedAt;
      return bTime.compareTo(aTime);
    });

    return groups;
  }

  /// 为会话生成分组 key。
  String _groupKeyForSession(SessionSummary s) {
    final target = s.workspaceTarget;
    if (target != null) {
      if (target.mode == WorkspaceMode.github) {
        return 'github:${target.repository ?? ''}';
      }
      return 'local:${target.localPath ?? ''}';
    }
    if (s.projectPath != null && s.projectPath!.isNotEmpty) {
      return 'local:${s.projectPath}';
    }
    return 'uncategorized';
  }

  String _formatSubtitle(SessionSummary s) {
    final parts = <String>[];
    parts.add(I18n.t('sessions.messageCount', {'count': s.messageCount.toString()}));
    final delta = DateTime.now().difference(s.updatedAt);
    if (delta.inMinutes < 1) {
      parts.add(I18n.t('sessions.justNow'));
    } else if (delta.inHours < 1) {
      parts.add(I18n.t('sessions.minutesAgo', {'count': delta.inMinutes.toString()}));
    } else if (delta.inDays < 1) {
      parts.add(I18n.t('sessions.hoursAgo', {'count': delta.inHours.toString()}));
    } else if (delta.inDays < 7) {
      parts.add(I18n.t('sessions.daysAgo', {'count': delta.inDays.toString()}));
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

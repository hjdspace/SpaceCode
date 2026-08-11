import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/connection/connection_service.dart';
import '../../core/connection/connection_state.dart' as conn;
import '../../core/i18n/strings.dart';
import '../../core/workspace/file_explorer_service.dart';
import '../../core/workspace/workspace_target.dart';
import '../files/file_preview_screen.dart';
import 'chat_controller.dart';
import 'widgets/message_list.dart';
import 'widgets/chat_input.dart';
import 'models/permission_request.dart';
import 'widgets/permission_card.dart';
import '../sessions/sessions_screen.dart';

class ChatScreen extends ConsumerWidget {
  /// 用于在文件预览回调中关闭 Drawer。
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  ChatScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chatState = ref.watch(chatProvider);
    final connectionInfo = ref.watch(connectionProvider);

    return Scaffold(
      key: _scaffoldKey,
      appBar: AppBar(
        leading: Builder(builder: (innerContext) {
          return IconButton(
            icon: const Icon(Icons.menu_rounded),
            onPressed: () {
              Scaffold.of(innerContext).openDrawer();
            },
          );
        }),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'SpaceCode',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (chatState.currentSessionId == null)
              Text(
                '新对话',
                style: TextStyle(
                  fontSize: 11,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.5),
                ),
              )
            else if (chatState.projectPath != null &&
                chatState.projectPath!.isNotEmpty)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.folder_outlined,
                    size: 11,
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.5),
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      _basename(chatState.projectPath!),
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.5),
                      ),
                    ),
                  ),
                ],
              )
            else if (chatState.currentAgent != null)
              Text(
                chatState.currentAgent!,
                style: TextStyle(
                  fontSize: 11,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.5),
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.terminal_outlined),
            tooltip: I18n.t('terminal.title'),
            onPressed: () => context.push('/terminal'),
          ),
          IconButton(
            icon: const Icon(Icons.extension_outlined),
            tooltip: I18n.t('skills.title'),
            onPressed: () => context.push('/skills'),
          ),
          _ConnectionIndicator(state: connectionInfo.state),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () {
              context.push('/settings');
            },
          ),
        ],
      ),
      drawer: Drawer(
        // 嵌套 Navigator：文件管理页在 Drawer 内 push，覆盖会话列表，
        // 返回时回到会话列表而不是关闭整个 Drawer。
        child: Navigator(
          onGenerateRoute: (_) => MaterialPageRoute(
            builder: (_) => SessionsScreen(
              onClose: () => _scaffoldKey.currentState?.closeDrawer(),
              onPreviewFile: (workspace, entry) =>
                  _handlePreviewFile(context, workspace, entry),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          const Expanded(child: MessageList()),
          if (chatState.pendingPermissions.isNotEmpty)
            _PermissionSheet(permissions: chatState.pendingPermissions),
          const ChatInput(),
        ],
      ),
    );
  }

  /// 提取路径的 basename 用于 AppBar 显示。
  /// 同时支持 Windows 反斜杠和 POSIX 正斜杠。
  static String _basename(String path) {
    final normalized = path.replaceAll('\\', '/');
    final idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(idx + 1) : normalized;
  }

  /// 文件预览回调：关闭 Drawer 并在根 Navigator push 预览页。
  ///
  /// [context] 是 ChatScreen build 方法的 context，用于定位根 Navigator。
  /// 关闭 Drawer 与 push 预览页在同一帧执行：预览页立即覆盖整个屏幕，
  /// Drawer 在底层继续关闭动画（不可见）。
  void _handlePreviewFile(
    BuildContext context,
    WorkspaceTarget workspace,
    FileEntry entry,
  ) {
    _scaffoldKey.currentState?.closeDrawer();
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(
        builder: (_) => FilePreviewScreen(
          workspace: workspace,
          entry: entry,
        ),
      ),
    );
  }
}

class _ConnectionIndicator extends StatelessWidget {
  final conn.ConnectionState state;

  const _ConnectionIndicator({required this.state});

  Color _color() {
    switch (state) {
      case conn.ConnectionState.connected:
        return const Color(0xff5db872);
      case conn.ConnectionState.connecting:
        return const Color(0xffd4a017);
      case conn.ConnectionState.disconnected:
        return const Color(0xff6c6a64);
      case conn.ConnectionState.error:
        return const Color(0xffc64545);
    }
  }

  String _tooltip() {
    switch (state) {
      case conn.ConnectionState.connected:
        return '已连接';
      case conn.ConnectionState.connecting:
        return '连接中...';
      case conn.ConnectionState.disconnected:
        return '未连接';
      case conn.ConnectionState.error:
        return '连接错误';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: _tooltip(),
      child: Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: _color(),
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

class _PermissionSheet extends ConsumerWidget {
  final List<PermissionRequest> permissions;

  const _PermissionSheet({required this.permissions});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (permissions.isEmpty) return const SizedBox.shrink();
    final request = permissions.first;

    return PermissionCard(
      request: request,
      onAllow: () =>
          ref.read(chatProvider.notifier).allowPermission(request.toolUseId),
      onDeny: () =>
          ref.read(chatProvider.notifier).denyPermission(request.toolUseId),
    );
  }
}

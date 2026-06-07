import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/connection/connection_service.dart';
import '../../core/connection/connection_state.dart' as conn;
import '../../core/connection/qr_scanner_page.dart';
import '../../core/theme/theme_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _urlController = TextEditingController();

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connectionInfo = ref.watch(connectionProvider);
    final currentTheme = ref.watch(currentThemeProvider);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: ListView(
        children: [
          // 自定义 header：返回箭头 + 标题
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                GestureDetector(
                  onTap: () => context.pop(),
                  child: Icon(Icons.arrow_back_ios, size: 20, color: theme.colorScheme.onSurface),
                ),
                const SizedBox(width: 10),
                Text(
                  '设置',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: theme.colorScheme.onSurface.withValues(alpha: 0.08)),

          // 连接分组
          _sectionHeader('连接'),
          _connectionTile(connectionInfo, theme),
          _disconnectTile(connectionInfo, theme),

          // 外观分组
          _sectionHeader('外观'),
          _themeSelector(currentTheme, theme),

          // 聊天分组
          _sectionHeader('聊天'),
          _navTile('默认 Agent', '默认助手', theme),
          _navTile('权限模式', '默认', theme),
          _navTile('流式输出', '开启', theme),

          // 关于分组
          _sectionHeader('关于'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'SpaceCode Mobile',
                  style: TextStyle(fontSize: 14, color: theme.colorScheme.onSurface),
                ),
                const SizedBox(height: 2),
                Text(
                  'v0.1.0',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _connectionTile(conn.ConnectionInfo connectionInfo, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.cardColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _connectionColor(connectionInfo.state),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _connectionLabel(connectionInfo.state),
                  style: TextStyle(
                    color: theme.colorScheme.onSurface,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
            if (connectionInfo.clientInfo != null) ...[
              const SizedBox(height: 4),
              Text(
                '设备: ${connectionInfo.clientInfo}',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  fontSize: 12,
                ),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _urlController,
              style: TextStyle(color: theme.colorScheme.onSurface, fontSize: 14),
              decoration: InputDecoration(
                hintText: 'ws://host:port',
                hintStyle: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
                ),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.qr_code_scanner_rounded),
                  onPressed: () async {
                    final result = await Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const QRScannerPage()),
                    );
                    if (result != null && result is String) {
                      _urlController.text = result;
                    }
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _disconnectTile(conn.ConnectionInfo connectionInfo, ThemeData theme) {
    if (connectionInfo.state != conn.ConnectionState.connected) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: () {
              if (_urlController.text.isNotEmpty) {
                ref.read(connectionProvider.notifier).connect(_urlController.text);
              }
            },
            style: FilledButton.styleFrom(
              backgroundColor: theme.colorScheme.primary,
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text('连接', style: TextStyle(fontWeight: FontWeight.w600)),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: () => ref.read(connectionProvider.notifier).disconnect(),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xffc64545),
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          child: const Text('断开连接', style: TextStyle(fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  Widget _themeSelector(AppTheme currentTheme, ThemeData theme) {
    final themes = [
      (AppTheme.light, '浅色', const Color(0xfff8f9fb), const Color(0xff0d9488)),
      (AppTheme.dark, '深色', const Color(0xff0d0d0d), const Color(0xff3b82f6)),
      (AppTheme.anthropic, 'Anthropic', const Color(0xfffaf9f5), const Color(0xffcc785c)),
      (AppTheme.anthropicDark, 'Anthropic 深色', const Color(0xff181715), const Color(0xffcc785c)),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: themes.map((item) {
          final (appTheme, label, bgColor, accentColor) = item;
          final isSelected = currentTheme == appTheme;
          return Expanded(
            child: GestureDetector(
              onTap: () => ref.read(themeProvider.notifier).setTheme(appTheme),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Column(
                  children: [
                    Container(
                      height: 48,
                      decoration: BoxDecoration(
                        color: bgColor,
                        borderRadius: BorderRadius.circular(8),
                        border: isSelected
                            ? Border.all(color: accentColor, width: 2)
                            : Border.all(
                                color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
                                width: 1,
                              ),
                      ),
                      child: isSelected
                          ? Center(
                              child: Icon(Icons.check, size: 18, color: accentColor),
                            )
                          : null,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 11,
                        color: isSelected
                            ? theme.colorScheme.onSurface
                            : theme.colorScheme.onSurface.withValues(alpha: 0.5),
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _navTile(String title, String value, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
            ),
          ),
        ),
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 0),
          title: Text(
            title,
            style: TextStyle(fontSize: 14, color: theme.colorScheme.onSurface),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 14,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                Icons.chevron_right,
                size: 18,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _connectionColor(conn.ConnectionState state) {
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

  String _connectionLabel(conn.ConnectionState state) {
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
}

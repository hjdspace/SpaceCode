import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/connection/connection_service.dart';
import '../../core/connection/connection_state.dart' as conn;
import '../../core/connection/qr_scanner_page.dart';
import '../../core/protocol/protocol.dart';
import '../../core/theme/theme_service.dart';
import '../chat/chat_controller.dart';

/// 手机端偏好设置（默认 Agent / 权限模式 / 流式输出）
/// 持久化到 SharedPreferences；权限模式会同步到桌面端 engine
class MobilePreferences {
  static const _kDefaultAgent = 'pref_default_agent_id';
  static const _kDefaultAgentName = 'pref_default_agent_name';
  static const _kPermissionMode = 'pref_permission_mode';
  static const _kStreamingEnabled = 'pref_streaming_enabled';

  static Future<String?> getDefaultAgentId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kDefaultAgent);
  }

  static Future<String?> getDefaultAgentName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kDefaultAgentName);
  }

  static Future<void> setDefaultAgent(String id, String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kDefaultAgent, id);
    await prefs.setString(_kDefaultAgentName, name);
  }

  static Future<String> getPermissionMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kPermissionMode) ?? 'default';
  }

  static Future<void> setPermissionMode(String mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPermissionMode, mode);
  }

  static Future<bool> getStreamingEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kStreamingEnabled) ?? true;
  }

  static Future<void> setStreamingEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kStreamingEnabled, enabled);
  }
}

/// 权限模式选项
const _permissionModes = <(String, String, String)>[
  ('default', '默认', '每次工具调用前询问'),
  ('plan', '计划模式', '只读，不执行任何写操作'),
  ('acceptEdits', '自动接受编辑', '自动允许文件编辑'),
  ('bypassPermissions', '跳过权限', '所有工具调用自动允许（危险）'),
];

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _urlController = TextEditingController();
  String? _defaultAgentName;
  String _permissionMode = 'default';
  bool _streamingEnabled = true;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final agentName = await MobilePreferences.getDefaultAgentName();
    final permMode = await MobilePreferences.getPermissionMode();
    final streaming = await MobilePreferences.getStreamingEnabled();
    if (!mounted) return;
    setState(() {
      _defaultAgentName = agentName;
      _permissionMode = permMode;
      _streamingEnabled = streaming;
    });
  }

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
          _navTile(
            title: '默认 Agent',
            value: _defaultAgentName ?? '未设置',
            theme: theme,
            onTap: _showAgentPicker,
          ),
          _navTile(
            title: '权限模式',
            value: _permissionModeLabel(_permissionMode),
            theme: theme,
            onTap: _showPermissionModePicker,
          ),
          _navTile(
            title: '流式输出',
            value: _streamingEnabled ? '开启' : '关闭',
            theme: theme,
            onTap: _showStreamingPicker,
          ),

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

  Widget _navTile({
    required String title,
    required String value,
    required ThemeData theme,
    required VoidCallback onTap,
  }) {
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
          onTap: onTap,
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

  /// 默认 Agent 选择器：复用 chat_input 中的 Agent 列表
  void _showAgentPicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        final theme = Theme.of(sheetContext);
        const agents = <(String, String, String, IconData, Color)>[
          ('code', 'Code Agent', '代码编写与调试', Icons.code_rounded, Color(0xffcc785c)),
          ('architect', 'Architect Agent', '架构设计与分析', Icons.architecture_rounded, Color(0xff5db8a6)),
        ];
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '选择默认 Agent',
                style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              for (final agent in agents)
                () {
                  final (id, name, desc, icon, color) = agent;
                  final isSelected = _defaultAgentName == name;
                  return ListTile(
                    leading: Icon(icon, color: color),
                    title: Text(name, style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(desc,
                        style: TextStyle(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.5))),
                    trailing: isSelected
                        ? Icon(Icons.check_circle_rounded,
                            color: theme.colorScheme.primary, size: 20)
                        : null,
                    onTap: () async {
                      await MobilePreferences.setDefaultAgent(id, name);
                      // 同时同步到当前会话
                      ref.read(chatProvider.notifier).setAgent(id, name);
                      if (!sheetContext.mounted) return;
                      setState(() => _defaultAgentName = name);
                      Navigator.pop(sheetContext);
                    },
                  );
                }(),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  /// 权限模式选择器：选中后同步到桌面端 engine
  void _showPermissionModePicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        final theme = Theme.of(sheetContext);
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '权限模式',
                style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '影响当前会话的工具调用权限（重启会话后生效）',
                style: TextStyle(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 12),
              for (final mode in _permissionModes)
                () {
                  final (id, name, desc) = mode;
                  final isSelected = _permissionMode == id;
                  return ListTile(
                    title: Text(name, style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(desc,
                        style: TextStyle(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.5))),
                    trailing: isSelected
                        ? Icon(Icons.check_circle_rounded,
                            color: theme.colorScheme.primary, size: 20)
                        : null,
                    onTap: () async {
                      await MobilePreferences.setPermissionMode(id);
                      // 同步到桌面端当前会话
                      final chatState = ref.read(chatProvider);
                      final sid = chatState.currentSessionId;
                      if (sid != null) {
                        ref.read(connectionProvider.notifier).send(MobileRequest(
                              type: RequestType.setPermissionMode,
                              data: {'sessionId': sid, 'mode': id},
                            ));
                      }
                      if (!sheetContext.mounted) return;
                      setState(() => _permissionMode = id);
                      Navigator.pop(sheetContext);
                    },
                  );
                }(),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  /// 流式输出选择器：仅 UI 状态持久化（engine 默认流式）
  void _showStreamingPicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        final theme = Theme.of(sheetContext);
        final options = <(bool, String, String)>[
          (true, '开启', '流式显示 LLM 响应（推荐）'),
          (false, '关闭', '等待完整响应后显示'),
        ];
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '流式输出',
                style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              for (final opt in options)
                () {
                  final (val, name, desc) = opt;
                  final isSelected = _streamingEnabled == val;
                  return ListTile(
                    title: Text(name, style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(desc,
                        style: TextStyle(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.5))),
                    trailing: isSelected
                        ? Icon(Icons.check_circle_rounded,
                            color: theme.colorScheme.primary, size: 20)
                        : null,
                    onTap: () async {
                      await MobilePreferences.setStreamingEnabled(val);
                      if (!sheetContext.mounted) return;
                      setState(() => _streamingEnabled = val);
                      Navigator.pop(sheetContext);
                    },
                  );
                }(),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  String _permissionModeLabel(String mode) {
    for (final (id, name, _) in _permissionModes) {
      if (id == mode) return name;
    }
    return '默认';
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

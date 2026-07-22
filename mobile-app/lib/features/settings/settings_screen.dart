import 'dart:convert';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../core/agent/local_agent_service.dart';
import '../../core/connection/connection_service.dart';
import '../../core/connection/connection_state.dart' as conn;
import '../../core/connection/qr_scanner_page.dart';
import '../../core/protocol/protocol.dart';
import '../../core/theme/theme_service.dart';
import '../../core/config/mobile_config.dart';
import '../../core/github/github_service.dart';
import '../../core/github/github_browser_auth.dart';
import '../../core/github/clone_notifier.dart';
import '../../core/github/clone_progress.dart';
import '../../core/i18n/strings.dart';
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

/// 权限模式选项（id + i18n key + 描述 i18n key）
const _permissionModeKeys = <(String, String, String)>[
  ('default', 'permission.mode.default', 'permission.mode.description.default'),
  ('plan', 'permission.mode.plan', 'permission.mode.description.plan'),
  ('acceptEdits', 'permission.mode.acceptEdits', 'permission.mode.description.acceptEdits'),
  ('bypassPermissions', 'permission.mode.bypassPermissions', 'permission.mode.description.bypassPermissions'),
];

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _urlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  final _baseUrlController = TextEditingController();
  final _modelController = TextEditingController();
  final _agentService = LocalAgentService();
  List<String> _availableModels = const [];
  bool _loadingModels = false;
  String? _defaultAgentName;
  String _permissionMode = 'default';
  bool _streamingEnabled = true;
  String _version = '';

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final agentName = await MobilePreferences.getDefaultAgentName();
    final permMode = await MobilePreferences.getPermissionMode();
    final streaming = await MobilePreferences.getStreamingEnabled();
    final config = await ref.read(mobileConfigProvider.notifier).load();
    final packageInfo = await PackageInfo.fromPlatform();
    if (!mounted) return;
    _apiKeyController.text = config.apiKey;
    _baseUrlController.text = config.baseUrl;
    _modelController.text = config.model;
    setState(() {
      _defaultAgentName = agentName;
      _permissionMode = permMode;
      _streamingEnabled = streaming;
      _version = 'v${packageInfo.version}';
    });
    // 若已配置 API Key 和 Base URL，自动拉取一次模型列表
    if (config.apiKey.isNotEmpty && config.baseUrl.isNotEmpty) {
      _refreshModels();
    }
  }

  Future<void> _refreshModels() async {
    if (_loadingModels) return;
    setState(() => _loadingModels = true);
    try {
      final models = await _agentService.listModels(
        baseUrl: _baseUrlController.text,
        apiKey: _apiKeyController.text,
      );
      if (!mounted) return;
      setState(() {
        _availableModels = models;
        _loadingModels = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _loadingModels = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString().replaceFirst('Bad state: ', ''))),
      );
    }
  }

  /// 加载指定 locale 的字符串表到 I18n（与 main.dart 中一致，避免跨文件导出）。
  Future<void> _initI18n(String localeCode) async {
    final locale = localeCode == 'en' ? AppLocale.en : AppLocale.zh;
    final path = locale == AppLocale.en
        ? 'lib/core/i18n/locales/en.json'
        : 'lib/core/i18n/locales/zh.json';
    try {
      final json = await rootBundle.loadString(path);
      final decoded = jsonDecode(json) as Map<String, dynamic>;
      I18n.init(locale, decoded.map((k, v) => MapEntry(k, v.toString())));
    } catch (_) {
      // 加载失败保持默认
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _apiKeyController.dispose();
    _baseUrlController.dispose();
    _modelController.dispose();
    _agentService.dispose();
    super.dispose();
  }

  // ============================================================
  //  方案 A：分组卡片布局（iOS Settings 风格）
  //  间距系统：4 / 8 / 12 / 16 / 24 / 32 px
  //  卡片：bg-elevated, 14px radius, border 0.08 alpha
  //  分区头：大写 + 字间距 0.8, textSecondary
  // ============================================================

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connectionInfo = ref.watch(connectionProvider);
    final currentTheme = ref.watch(currentThemeProvider);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 48),
        children: [
          // 大标题 header
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Row(
              children: [
                GestureDetector(
                  onTap: () => context.pop(),
                  child: Icon(Icons.arrow_back_ios,
                      size: 20, color: theme.colorScheme.primary),
                ),
                const SizedBox(width: 12),
                Text(
                  '设置',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),

          // 连接分组
          _sectionTitle('连接'),
          _connectionCard(connectionInfo, theme),

          // 引擎分组
          _sectionTitle('手机 Agent 引擎'),
          _engineCard(theme),

          // Github 分组
          _sectionTitle('Github'),
          _githubCard(theme),
          // Clone 进度（条件显示，独立卡片）
          Consumer(builder: (context, ref, _) {
            final cloneState = ref.watch(cloneProvider);
            if (cloneState.status == CloneStatus.idle) {
              return const SizedBox.shrink();
            }
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
              child: _CloneTaskCard(state: cloneState),
            );
          }),

          // 外观分组
          _sectionTitle('外观'),
          _appearanceCard(currentTheme, theme),

          // 聊天分组
          _sectionTitle('聊天'),
          _chatCard(theme),

          // 关于分组
          _sectionTitle('关于'),
          _aboutCard(theme),
        ],
      ),
    );
  }

  /// 分区标题：大写 + 字间距，textSecondary 色
  Widget _sectionTitle(String title) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 8),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.8,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
        ),
      ),
    );
  }

  /// 卡片容器：统一圆角 14px + border
  Widget _card({required List<Widget> children}) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        ),
      ),
      child: Column(children: children),
    );
  }

  /// 卡片内导航行（带底部分隔线）
  Widget _cardNavRow({
    required String title,
    required String value,
    required ThemeData theme,
    required VoidCallback onTap,
    bool showDivider = true,
  }) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: showDivider
            ? BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
                  ),
                ),
              )
            : null,
        child: Row(
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 14,
                color: theme.colorScheme.onSurface,
              ),
            ),
            const Spacer(),
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
    );
  }

  /// 带标签的表单字段
  Widget _labeledField({
    required String label,
    required Widget child,
    required ThemeData theme,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.6,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          ),
        ),
        const SizedBox(height: 6),
        child,
      ],
    );
  }

  // --- 连接卡片 ---

  Widget _connectionCard(conn.ConnectionInfo connectionInfo, ThemeData theme) {
    final isConnected =
        connectionInfo.state == conn.ConnectionState.connected;
    return _card(
      children: [
        // 状态行
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Row(
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
        ),
        if (connectionInfo.clientInfo != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: Text(
              '设备: ${connectionInfo.clientInfo}',
              style: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
          ),
        // URL 输入
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
          child: TextField(
            controller: _urlController,
            style:
                TextStyle(color: theme.colorScheme.onSurface, fontSize: 14),
            decoration: InputDecoration(
              hintText: 'ws://host:port',
              hintStyle: TextStyle(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
              ),
              suffixIcon: IconButton(
                icon: const Icon(Icons.qr_code_scanner_rounded),
                onPressed: () async {
                  final result = await Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => const QRScannerPage()),
                  );
                  if (result != null && result is String) {
                    _urlController.text = result;
                  }
                },
              ),
            ),
          ),
        ),
        // 连接/断开按钮
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isConnected
                  ? () =>
                      ref.read(connectionProvider.notifier).disconnect()
                  : () {
                      if (_urlController.text.isNotEmpty) {
                        ref
                            .read(connectionProvider.notifier)
                            .connect(_urlController.text);
                      }
                    },
              style: FilledButton.styleFrom(
                backgroundColor: isConnected
                    ? const Color(0xffc64545)
                    : theme.colorScheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Text(
                isConnected ? '断开连接' : '连接',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // --- 引擎卡片 ---

  Widget _engineCard(ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        ),
      ),
      child: Column(
        children: [
          // API Key
          _labeledField(
            label: 'API Key',
            theme: theme,
            child: TextField(
              controller: _apiKeyController,
              obscureText: true,
              style: const TextStyle(fontSize: 14),
              decoration: const InputDecoration(
                hintText: '用于手机端内置 Agent',
              ),
            ),
          ),
          const SizedBox(height: 12),
          // Base URL
          _labeledField(
            label: 'Base URL',
            theme: theme,
            child: TextField(
              controller: _baseUrlController,
              style: const TextStyle(fontSize: 14),
              decoration: const InputDecoration(
                hintText: 'https://api.openai.com/v1',
              ),
            ),
          ),
          const SizedBox(height: 12),
          // 模型
          _labeledField(
            label: '模型',
            theme: theme,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _buildModelField()),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: _loadingModels ? null : _refreshModels,
                  icon: _loadingModels
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 20),
                  tooltip: '从 API 获取模型列表',
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          // 保存按钮
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () async {
                await ref.read(mobileConfigProvider.notifier).save(
                      apiKey: _apiKeyController.text,
                      baseUrl: _baseUrlController.text,
                      model: _modelController.text,
                    );
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('手机 Agent 配置已保存')));
                }
              },
              icon: const Icon(Icons.save_outlined, size: 17),
              label: const Text('保存配置'),
              style: FilledButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // --- Github 卡片 ---

  Widget _githubCard(ThemeData theme) {
    final config = ref.watch(mobileConfigProvider);
    final connected = config.githubLogin.isNotEmpty;
    return _card(
      children: [
        // 连接 / 断开 Github
        InkWell(
          onTap: _authenticateGithub,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
                ),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: connected
                        ? const Color(0x1a5db8a6)
                        : theme.colorScheme.onSurface
                            .withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    connected
                        ? Icons.verified_outlined
                        : Icons.login_outlined,
                    size: 16,
                    color: connected
                        ? const Color(0xff5db8a6)
                        : theme.colorScheme.onSurface
                            .withValues(alpha: 0.5),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    connected
                        ? '已连接 @${config.githubLogin}'
                        : '连接 Github',
                    style: TextStyle(
                      fontSize: 14,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                if (connected)
                  GestureDetector(
                    onTap: () =>
                        ref.read(mobileConfigProvider.notifier).clearGithub(),
                    child: const Text(
                      '断开',
                      style: TextStyle(
                        fontSize: 14,
                        color: Color(0xffc64545),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        // Clone 仓库
        InkWell(
          onTap: connected ? _cloneGithubRepository : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: const Color(0x1ae8a55a),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.download_outlined,
                    size: 16,
                    color: Color(0xffe8a55a),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '手动 Clone 仓库到本地',
                    style: TextStyle(
                      fontSize: 14,
                      color: connected
                          ? theme.colorScheme.onSurface
                          : theme.colorScheme.onSurface
                              .withValues(alpha: 0.4),
                    ),
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // --- 外观卡片（主题 + 语言） ---

  Widget _appearanceCard(AppTheme currentTheme, ThemeData theme) {
    final themes = [
      (AppTheme.light, '浅色', const Color(0xfff8f9fb), const Color(0xff0d9488)),
      (AppTheme.dark, '深色', const Color(0xff0d0d0d), const Color(0xff3b82f6)),
      (AppTheme.anthropic, 'Anthropic', const Color(0xfffaf9f5), const Color(0xffcc785c)),
      (AppTheme.anthropicDark, 'A-Dark', const Color(0xff181715), const Color(0xffcc785c)),
    ];

    return _card(
      children: [
        // 主题色块网格
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: themes.map((item) {
              final (appTheme, label, bgColor, accentColor) = item;
              final isSelected = currentTheme == appTheme;
              return Expanded(
                child: GestureDetector(
                  onTap: () =>
                      ref.read(themeProvider.notifier).setTheme(appTheme),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Column(
                      children: [
                        Container(
                          height: 56,
                          decoration: BoxDecoration(
                            color: bgColor,
                            borderRadius: BorderRadius.circular(10),
                            border: isSelected
                                ? Border.all(color: accentColor, width: 2)
                                : Border.all(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.08),
                                    width: 1,
                                  ),
                          ),
                          child: isSelected
                              ? Align(
                                  alignment: Alignment.topRight,
                                  child: Padding(
                                    padding: const EdgeInsets.only(
                                        top: 6, right: 6),
                                    child: Container(
                                      width: 16,
                                      height: 16,
                                      decoration: BoxDecoration(
                                        color: accentColor,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(Icons.check,
                                          size: 10, color: bgColor),
                                    ),
                                  ),
                                )
                              : null,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          label,
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: isSelected
                                ? FontWeight.w600
                                : FontWeight.normal,
                            color: isSelected
                                ? theme.colorScheme.onSurface
                                : theme.colorScheme.onSurface
                                    .withValues(alpha: 0.5),
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
        ),
        // 语言行
        Container(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
              ),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurface
                        .withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.language,
                    size: 16,
                    color: theme.colorScheme.onSurface
                        .withValues(alpha: 0.5),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    I18n.t('settings.language'),
                    style: TextStyle(
                      fontSize: 14,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                DropdownButton<String>(
                  value: ref.watch(mobileConfigProvider).appLocale,
                  underline: const SizedBox(),
                  items: [
                    DropdownMenuItem(
                      value: 'zh',
                      child: Text(I18n.t('settings.languageZh')),
                    ),
                    DropdownMenuItem(
                      value: 'en',
                      child: Text(I18n.t('settings.languageEn')),
                    ),
                  ],
                  onChanged: (value) async {
                    if (value == null) return;
                    await ref
                        .read(mobileConfigProvider.notifier)
                        .saveLocale(value);
                    await _initI18n(value);
                    setState(() {});
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // --- 聊天卡片 ---

  Widget _chatCard(ThemeData theme) {
    return _card(
      children: [
        _cardNavRow(
          title: '默认 Agent',
          value: _defaultAgentName ?? '未设置',
          theme: theme,
          onTap: _showAgentPicker,
          showDivider: true,
        ),
        _cardNavRow(
          title: '权限模式',
          value: _permissionModeLabel(_permissionMode),
          theme: theme,
          onTap: _showPermissionModePicker,
          showDivider: true,
        ),
        _cardNavRow(
          title: '流式输出',
          value: _streamingEnabled ? '开启' : '关闭',
          theme: theme,
          onTap: _showStreamingPicker,
          showDivider: false,
        ),
      ],
    );
  }

  // --- 关于卡片 ---

  Widget _aboutCard(ThemeData theme) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        ),
      ),
      child: Column(
        children: [
          Text(
            'SpaceCode Mobile',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            _version.isEmpty ? '' : _version,
            style: TextStyle(
              fontSize: 12,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModelField() {
    return TextField(
      controller: _modelController,
      style: const TextStyle(fontSize: 14),
      decoration: InputDecoration(
        labelText: '模型',
        hintText: _availableModels.isEmpty
            ? 'gpt-4o-mini（点右侧刷新拉取列表）'
            : '从下拉选择或手动输入',
        suffixIcon: _availableModels.isEmpty
            ? null
            : PopupMenuButton<String>(
                icon: const Icon(Icons.arrow_drop_down, size: 20),
                tooltip: '选择模型',
                constraints: const BoxConstraints(maxHeight: 320),
                itemBuilder: (_) => _availableModels
                    .map((m) => PopupMenuItem<String>(
                          value: m,
                          child: Text(
                            m,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ))
                    .toList(),
                onSelected: (value) {
                  _modelController.text = value;
                  _modelController.selection = TextSelection.fromPosition(
                      TextPosition(offset: value.length));
                },
              ),
      ),
    );
  }

  Future<void> _authenticateGithub() async {
    try {
      final auth = await authenticateGithubInBrowser(context);
      if (auth == null || !mounted) return;
      await ref
          .read(mobileConfigProvider.notifier)
          .saveGithub(token: auth.token, login: auth.login);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Github 已连接：@${auth.login}')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', ''))));
      }
    }
  }

  Future<void> _cloneGithubRepository() async {
    final token = ref.read(mobileConfigProvider).githubToken;
    final service = GithubService(token: token);
    try {
      final repos = await service.listRepositories();
      if (!mounted) return;
      final repo = await showModalBottomSheet<GithubRepository>(
        context: context,
        builder: (sheetContext) => ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(16),
          children: [
            const Text('选择要 Clone 的仓库',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            ...repos.map((item) => ListTile(
                  title: Text(item.fullName),
                  subtitle: Text('默认分支：${item.defaultBranch}'),
                  onTap: () => Navigator.pop(sheetContext, item),
                )),
          ],
        ),
      );
      if (repo == null || !mounted) return;
      final branches = await service.listBranches(repo.fullName);
      if (!mounted) return;
      final branch = await showDialog<String>(
        context: context,
        builder: (dialogContext) => SimpleDialog(
          title: const Text('选择分支'),
          children: branches
              .map((item) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(dialogContext, item),
                    child: Text(item),
                  ))
              .toList(),
        ),
      );
      if (branch == null || !mounted) return;
      // 让用户选择系统目录（如 Download），解析 SAF URI 为真实路径
      final pickedDir = await FilePicker.platform.getDirectoryPath(
        dialogTitle: '选择 Clone 目标目录',
      );
      if (pickedDir == null || !mounted) return;
      // 解析 SAF content:// URI 为真实文件系统路径
      final basePath = _safUriToPath(pickedDir);
      if (basePath == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('无法解析所选目录路径，请选择主存储下的目录（如 Download）')));
        }
        return;
      }
      final repoName = repo.fullName.split('/').last;
      // 修复字符串插值：$basePath$Platform.pathSeparator$repoName 会被误解析
      // 正确写法用 ${Platform.pathSeparator}
      final target = '$basePath${Platform.pathSeparator}$repoName';
      // 尝试创建目录，Android 11+ 可能 Permission denied
      // 若失败则 fallback 到 APP 专属外部存储目录，保留用户选的目录名作为子目录
      String actualTarget = target;
      try {
        await Directory(target).create(recursive: true);
      } catch (_) {
        // fallback：<externalStorage>/Android/data/<pkg>/files/<用户选的目录名>/<仓库名>/
        final extDir = await getExternalStorageDirectory();
        if (extDir == null) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('无法访问外部存储目录，clone 失败')));
          }
          return;
        }
        final selectedDirName = basePath.split(Platform.pathSeparator).last;
        actualTarget =
            '${extDir.path}${Platform.pathSeparator}$selectedDirName${Platform.pathSeparator}$repoName';
        await Directory(actualTarget).create(recursive: true);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                '系统权限限制，已克隆到 APP 专属目录：$actualTarget'),
            duration: const Duration(seconds: 6),
          ));
        }
      }
      // 若已存在则先清空（重新 clone）
      final existingDir = Directory(actualTarget);
      if (await existingDir.exists()) {
        await existingDir.delete(recursive: true);
      }

      // 交给后台 CloneNotifier，立即返回（不阻塞 UI）
      try {
        await ref.read(cloneProvider.notifier).startClone(
              repository: repo.fullName,
              branch: branch,
              targetDirectory: actualTarget,
              useTermux: false,
            );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(error.message)));
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error.toString())));
      }
    } finally {
      service.dispose();
    }
  }

  /// 将 SAF content:// URI 解析为真实文件系统路径。
  ///
  /// 支持格式：
  /// - content://com.android.externalstorage.documents/tree/primary%3ADownload
  ///   → /storage/emulated/0/Download
  /// - content://com.android.externalstorage.documents/tree/XXXX-XXXX%3ADownload
  ///   → /storage/XXXX-XXXX/Download
  /// - 已是真实路径（/storage/...）→ 原样返回
  /// 无法识别返回 null。
  String? _safUriToPath(String uri) {
    // 已是真实路径
    if (uri.startsWith('/')) return uri;

    final decoded = Uri.decodeFull(uri);
    final match = RegExp(r'tree/(.+)').firstMatch(decoded);
    if (match == null) return null;
    final treePath = match.group(1)!;

    if (treePath.startsWith('primary:')) {
      // 主存储：primary:Download → /storage/emulated/0/Download
      final subPath = treePath.substring('primary:'.length);
      return subPath.isEmpty
          ? '/storage/emulated/0'
          : '/storage/emulated/0/$subPath';
    }

    // SD 卡或其他存储：XXXX-XXXX:Download → /storage/XXXX-XXXX/Download
    final colonIndex = treePath.indexOf(':');
    if (colonIndex > 0) {
      final storageId = treePath.substring(0, colonIndex);
      final subPath = treePath.substring(colonIndex + 1);
      return subPath.isEmpty
          ? '/storage/$storageId'
          : '/storage/$storageId/$subPath';
    }
    return null;
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
          (
            'code',
            'Code Agent',
            '代码编写与调试',
            Icons.code_rounded,
            Color(0xffcc785c)
          ),
          (
            'architect',
            'Architect Agent',
            '架构设计与分析',
            Icons.architecture_rounded,
            Color(0xff5db8a6)
          ),
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
                    title: Text(name,
                        style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(desc,
                        style: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.5))),
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
              for (final mode in _permissionModeKeys)
                () {
                  final (id, nameKey, descKey) = mode;
                  final isSelected = _permissionMode == id;
                  return ListTile(
                    title: Text(I18n.t(nameKey),
                        style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(I18n.t(descKey),
                        style: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.5))),
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
                        ref
                            .read(connectionProvider.notifier)
                            .send(MobileRequest(
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
                    title: Text(name,
                        style: TextStyle(color: theme.colorScheme.onSurface)),
                    subtitle: Text(desc,
                        style: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.5))),
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
    for (final (id, nameKey, _) in _permissionModeKeys) {
      if (id == mode) return I18n.t(nameKey);
    }
    return I18n.t('permission.mode.default');
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

class _CloneTaskCard extends ConsumerWidget {
  final CloneState state;

  const _CloneTaskCard({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        ),
      ),
      child: _buildContent(context, ref, theme),
    );
  }

  Widget _buildContent(BuildContext context, WidgetRef ref, ThemeData theme) {
    switch (state.status) {
      case CloneStatus.running:
        return _buildRunning(context, ref, theme);
      case CloneStatus.done:
        return _buildDone(context, ref, theme);
      case CloneStatus.error:
        return _buildError(context, ref, theme);
      case CloneStatus.idle:
        return const SizedBox.shrink();
    }
  }

  Widget _buildRunning(BuildContext context, WidgetRef ref, ThemeData theme) {
    final progress = state.progress;
    final phase = progress?.phase ?? ClonePhase.downloading;
    final percent = phase == ClonePhase.extracting
        ? progress?.extractPercent
        : progress?.downloadPercent;
    final label = phase == ClonePhase.extracting ? '解压中' : '下载中';
    final detail = phase == ClonePhase.extracting
        ? '文件 ${progress?.processedFiles ?? 0}/${progress?.totalFiles ?? '?'}'
        : '${_formatBytes(progress?.receivedBytes ?? 0)}'
            '/${progress?.totalBytes == null ? '?' : _formatBytes(progress!.totalBytes!)}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '$label：${state.repositoryName ?? ''}',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).cancel(),
              child: const Text('取消'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: percent,
          backgroundColor: theme.colorScheme.surface,
        ),
        const SizedBox(height: 4),
        Text(
          percent == null
              ? '$label中… ($detail)'
              : '$label ${(percent * 100).toStringAsFixed(0)}% ($detail)',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ],
    );
  }

  Widget _buildDone(BuildContext context, WidgetRef ref, ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.check_circle_rounded,
                color: Color(0xff5db872), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${state.repositoryName ?? ''} 已克隆',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => _copyPath(context, state.resultPath),
              child: const Text('复制路径'),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).reset(),
              child: const Text('清除'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        SelectableText(
          '路径：${state.resultPath ?? ''}',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ],
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.error_rounded,
                color: Color(0xffc64545), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${state.repositoryName ?? ''} 克隆失败',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(cloneProvider.notifier).reset(),
              child: const Text('清除'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          state.errorMessage ?? '未知错误',
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.error,
          ),
        ),
      ],
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _copyPath(BuildContext context, String? path) async {
    if (path == null) return;
    await Clipboard.setData(ClipboardData(text: path));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('路径已复制：$path'),
          duration: const Duration(seconds: 4),
        ),
      );
    }
  }
}

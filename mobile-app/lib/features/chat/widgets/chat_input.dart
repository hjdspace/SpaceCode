import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/config/mobile_config.dart';
import '../../../core/github/github_browser_auth.dart';
import '../../../core/github/github_service.dart';
import '../../../core/skills/skill_registry.dart';
import '../../../core/workspace/workspace_target.dart';
import '../chat_controller.dart';
import 'skill_command_menu.dart';

class ChatInput extends ConsumerStatefulWidget {
  const ChatInput({super.key});

  @override
  ConsumerState<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends ConsumerState<ChatInput> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  OverlayEntry? _commandMenuOverlay;
  int _commandSelectedIndex = 0;
  List<CommandMenuItem> _commandItems = const [];

  bool get _canSend =>
      _controller.text.trim().isNotEmpty && !ref.read(chatProvider).isLoading;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    _hideCommandMenu();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    ref.read(chatProvider.notifier).sendMessage(text);
    _controller.clear();
    _focusNode.requestFocus();
  }

  void _onInputChanged() {
    final text = _controller.text;
    if (text.startsWith('/') && !text.contains(' ')) {
      _showCommandMenu(text);
    } else {
      _hideCommandMenu();
    }
  }

  void _showCommandMenu(String prefix) {
    final registry = ref.read(skillRegistryProvider);
    final allItems = <CommandMenuItem>[
      const CommandMenuItem(
        command: '/new',
        description: '新建会话',
      ),
      const CommandMenuItem(
        command: '/settings',
        description: '打开设置',
      ),
      const CommandMenuItem(
        command: '/skills',
        description: '管理技能',
      ),
      ...registry.skills.map((s) => CommandMenuItem(
            command: '/skill:${s.name}',
            description: s.description,
          )),
    ];
    final filtered = prefix == '/'
        ? allItems
        : allItems
            .where((item) => item.command.startsWith(prefix))
            .toList();
    if (filtered.isEmpty) {
      _hideCommandMenu();
      return;
    }
    setState(() {
      _commandItems = filtered;
      _commandSelectedIndex = 0;
    });
    if (_commandMenuOverlay == null) {
      _commandMenuOverlay = OverlayEntry(
        builder: (context) => _buildPositionedMenu(),
      );
      Overlay.of(context).insert(_commandMenuOverlay!);
    } else {
      _commandMenuOverlay!.markNeedsBuild();
    }
  }

  Widget _buildPositionedMenu() {
    final renderBox = context.findRenderObject() as RenderBox?;
    final size = renderBox?.size ?? Size.zero;
    return Stack(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: _hideCommandMenu,
          child: const SizedBox.expand(),
        ),
        Positioned(
          bottom: size.height + 8,
          left: 12,
          right: 12,
          child: SkillCommandMenu(
            items: _commandItems,
            selectedIndex: _commandSelectedIndex,
            onSelected: _selectCommand,
          ),
        ),
      ],
    );
  }

  void _selectCommand(int index) {
    final item = _commandItems[index];
    _controller.text = '${item.command} ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    _hideCommandMenu();
    _focusNode.requestFocus();
  }

  void _hideCommandMenu() {
    _commandMenuOverlay?.remove();
    _commandMenuOverlay = null;
  }

  bool _handleKeyEvent(KeyEvent event) {
    if (_commandMenuOverlay == null) return false;
    if (event is! KeyDownEvent) return false;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown) {
      setState(() {
        _commandSelectedIndex =
            (_commandSelectedIndex + 1) % _commandItems.length;
      });
      _commandMenuOverlay?.markNeedsBuild();
      return true;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      setState(() {
        _commandSelectedIndex = (_commandSelectedIndex - 1) %
            _commandItems.length;
      });
      _commandMenuOverlay?.markNeedsBuild();
      return true;
    }
    if (key == LogicalKeyboardKey.escape) {
      _hideCommandMenu();
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chatState = ref.watch(chatProvider);
    final isLoading = chatState.isLoading;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        border: Border(
          top: BorderSide(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                GestureDetector(
                  onTap: () {
                    _showAgentPicker(context);
                  },
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color:
                            theme.colorScheme.onSurface.withValues(alpha: 0.1),
                      ),
                    ),
                    child: Icon(
                      Icons.smart_toy_outlined,
                      size: 18,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    constraints: const BoxConstraints(maxHeight: 120),
                    child: Focus(
                      onKeyEvent: (node, event) {
                        if (_handleKeyEvent(event)) {
                          return KeyEventResult.handled;
                        }
                        return KeyEventResult.ignored;
                      },
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        maxLines: null,
                        textInputAction: TextInputAction.newline,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 15,
                        ),
                        decoration: InputDecoration(
                          hintText: '输入消息...',
                          hintStyle: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.4),
                          ),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) {
                          if (_commandMenuOverlay != null) {
                            _selectCommand(_commandSelectedIndex);
                          } else {
                            _send();
                          }
                        },
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (isLoading)
                  GestureDetector(
                    onTap: () => ref.read(chatProvider.notifier).abort(),
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: const Color(0xffc64545).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.stop_rounded,
                        size: 18,
                        color: Color(0xffc64545),
                      ),
                    ),
                  )
                else
                  GestureDetector(
                    onTap: _canSend ? _send : null,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: _canSend
                            ? theme.colorScheme.primary
                            : theme.colorScheme.onSurface
                                .withValues(alpha: 0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.arrow_upward_rounded,
                        size: 18,
                        color: _canSend
                            ? const Color(0xff181715)
                            : theme.colorScheme.onSurface
                                .withValues(alpha: 0.3),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            _WorkspaceToolbar(
              target: chatState.workspaceTarget,
              onLocal: _chooseLocalDirectory,
              onGithub: _chooseGithubRepository,
              onBranch: _chooseGithubBranch,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _chooseLocalDirectory() async {
    final path = await FilePicker.platform
        .getDirectoryPath(dialogTitle: '选择 Agent 工作目录');
    if (path != null && mounted) {
      ref
          .read(chatProvider.notifier)
          .setWorkspaceTarget(WorkspaceTarget.local(path));
    }
  }

  Future<void> _chooseGithubRepository() async {
    var config = ref.read(mobileConfigProvider);
    if (config.githubToken.isEmpty) {
      final auth = await authenticateGithubInBrowser(context);
      if (auth == null || !mounted) return;
      await ref.read(mobileConfigProvider.notifier).saveGithub(
            token: auth.token,
            login: auth.login,
          );
      if (!mounted) return;
      config = ref.read(mobileConfigProvider);
    }
    final service = GithubService(token: config.githubToken);
    try {
      final repo = await showModalBottomSheet<GithubRepository>(
        context: context,
        isScrollControlled: true,
        builder: (sheetContext) => FutureBuilder<List<GithubRepository>>(
          future: service.listRepositories(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const SizedBox(
                  height: 220,
                  child: Center(child: CircularProgressIndicator()));
            }
            if (snapshot.hasError) {
              return SizedBox(
                  height: 220,
                  child: Center(child: Text('读取仓库失败：${snapshot.error}')));
            }
            final repositories = snapshot.data ?? const <GithubRepository>[];
            return SafeArea(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.all(16),
                children: [
                  const Text('选择 Github 仓库',
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  ...repositories.map((repo) => ListTile(
                        leading: Icon(
                            repo.isPrivate ? Icons.lock_outline : Icons.public),
                        title: Text(repo.fullName),
                        subtitle: Text('默认分支：${repo.defaultBranch}'),
                        onTap: () => Navigator.pop(sheetContext, repo),
                      )),
                ],
              ),
            );
          },
        ),
      );
      if (repo == null || !mounted) return;
      final branches = await service.listBranches(repo.fullName);
      if (!mounted) return;
      final branch = await showDialog<String>(
        context: context,
        builder: (dialogContext) => SimpleDialog(
          title: Text('选择 ${repo.name} 分支'),
          children: branches
              .map((name) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(dialogContext, name),
                    child: Text(name),
                  ))
              .toList(),
        ),
      );
      if (branch != null && mounted) {
        ref.read(chatProvider.notifier).setWorkspaceTarget(
              WorkspaceTarget.github(repository: repo.fullName, branch: branch),
            );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      service.dispose();
    }
  }

  Future<void> _chooseGithubBranch() async {
    final target = ref.read(chatProvider).workspaceTarget;
    if (target?.mode != WorkspaceMode.github || target?.repository == null) {
      await _chooseGithubRepository();
      return;
    }
    final config = ref.read(mobileConfigProvider);
    final service = GithubService(token: config.githubToken);
    try {
      final branches = await service.listBranches(target!.repository!);
      if (!mounted) return;
      final branch = await showDialog<String>(
        context: context,
        builder: (dialogContext) => SimpleDialog(
          title: const Text('选择分支'),
          children: branches
              .map((name) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(dialogContext, name),
                    child: Text(name),
                  ))
              .toList(),
        ),
      );
      if (branch != null && mounted) {
        ref.read(chatProvider.notifier).setWorkspaceTarget(
              WorkspaceTarget.github(
                  repository: target.repository!, branch: branch),
            );
      }
    } finally {
      service.dispose();
    }
  }

  void _showAgentPicker(BuildContext context) {
    final chatState = ref.read(chatProvider);
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) => _AgentPickerSheet(
        currentAgent: chatState.currentAgent,
        onSelected: (agentId, agentName) {
          ref.read(chatProvider.notifier).setAgent(agentId, agentName);
          Navigator.pop(sheetContext);
        },
      ),
    );
  }
}

class _WorkspaceToolbar extends StatelessWidget {
  final WorkspaceTarget? target;
  final VoidCallback onLocal;
  final VoidCallback onGithub;
  final VoidCallback onBranch;

  const _WorkspaceToolbar(
      {required this.target,
      required this.onLocal,
      required this.onGithub,
      required this.onBranch});

  @override
  Widget build(BuildContext context) {
    final isGithub = target?.mode == WorkspaceMode.github;
    final modeLabel = target?.mode == WorkspaceMode.local ? '本地' : '云端';
    return Row(
      children: [
        PopupMenuButton<WorkspaceMode>(
          initialValue: target?.mode,
          onSelected: (mode) =>
              mode == WorkspaceMode.local ? onLocal() : onGithub(),
          itemBuilder: (context) => const [
            PopupMenuItem(value: WorkspaceMode.github, child: Text('云端')),
            PopupMenuItem(value: WorkspaceMode.local, child: Text('本地')),
          ],
          child: _ContextChip(
            icon: isGithub ? Icons.cloud_outlined : Icons.folder_outlined,
            label: modeLabel,
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: InkWell(
            onTap: onGithub,
            borderRadius: BorderRadius.circular(8),
            child: _ContextChip(
              icon: Icons.account_tree_outlined,
              label: target?.repository ?? '选择 Github 仓库',
              expanded: true,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: InkWell(
            onTap: isGithub ? onBranch : onLocal,
            borderRadius: BorderRadius.circular(8),
            child: _ContextChip(
              icon: isGithub
                  ? Icons.call_split_outlined
                  : Icons.folder_open_outlined,
              label: isGithub
                  ? (target?.branch ?? 'Github分支')
                  : (target?.localPath ?? '选择目录'),
              expanded: true,
            ),
          ),
        ),
      ],
    );
  }
}

class _ContextChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool expanded;

  const _ContextChip(
      {required this.icon, required this.label, this.expanded = false});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final child = Row(
        mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: theme.colorScheme.primary),
          const SizedBox(width: 5),
          Flexible(
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12))),
        ]);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(8)),
      child: child,
    );
  }
}

class _AgentPickerSheet extends StatelessWidget {
  final String? currentAgent;
  final void Function(String agentId, String agentName) onSelected;

  const _AgentPickerSheet(
      {required this.currentAgent, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    const agents = <(String, String, String, IconData, Color)>[
      ('code', 'Code Agent', '代码编写与调试', Icons.code_rounded, Color(0xffcc785c)),
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
            '选择 Agent',
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
              final isSelected = currentAgent == name;
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
                onTap: () => onSelected(id, name),
              );
            }(),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

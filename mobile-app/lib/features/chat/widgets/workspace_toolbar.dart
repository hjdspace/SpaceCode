import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/mobile_config.dart';
import '../../../core/github/github_browser_auth.dart';
import '../../../core/github/github_service.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/workspace/recent_projects_service.dart';
import '../../../core/workspace/workspace_target.dart';
import '../chat_controller.dart';

class WorkspaceToolbar extends ConsumerStatefulWidget {
  const WorkspaceToolbar({super.key});

  @override
  ConsumerState<WorkspaceToolbar> createState() => _WorkspaceToolbarState();
}

class _WorkspaceToolbarState extends ConsumerState<WorkspaceToolbar> {
  // ── GitHub ──────────────────────────────────────────────────────────

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
            if (!snapshot.hasData && !snapshot.hasError) {
              return const SizedBox(
                height: 220,
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (snapshot.hasError) {
              return SizedBox(
                height: 220,
                child: Center(
                  child: Text(
                    '${I18n.t('chat.workspaceSelectRepository')}: ${snapshot.error}',
                  ),
                ),
              );
            }
            final repositories = snapshot.data ?? const <GithubRepository>[];
            return SafeArea(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    I18n.t('chat.workspaceSelectRepository'),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...repositories.map(
                    (repo) => ListTile(
                      leading: Icon(
                        repo.isPrivate ? Icons.lock_outline : Icons.public,
                      ),
                      title: Text(repo.fullName),
                      subtitle: Text(
                        '${I18n.t('chat.workspaceBranchDefault')}: ${repo.defaultBranch}',
                      ),
                      onTap: () => Navigator.pop(sheetContext, repo),
                    ),
                  ),
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
          title: Text(I18n.t('chat.workspaceSelectBranch')),
          children: branches
              .map(
                (name) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(dialogContext, name),
                  child: Text(name),
                ),
              )
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
          title: Text(I18n.t('chat.workspaceSelectBranch')),
          children: branches
              .map(
                (name) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(dialogContext, name),
                  child: Text(name),
                ),
              )
              .toList(),
        ),
      );
      if (branch != null && mounted) {
        ref.read(chatProvider.notifier).setWorkspaceTarget(
              WorkspaceTarget.github(
                repository: target.repository!,
                branch: branch,
              ),
            );
      }
    } finally {
      service.dispose();
    }
  }

  // ── Local ───────────────────────────────────────────────────────────

  Future<void> _chooseLocalDirectory() async {
    final path = await FilePicker.platform.getDirectoryPath(
      dialogTitle: I18n.t('chat.workspaceSelectLocal'),
    );
    if (path == null || !mounted) return;
    ref
        .read(chatProvider.notifier)
        .setWorkspaceTarget(WorkspaceTarget.local(path));
    await RecentProjectsService.recordProject(path);
    setState(() {});
  }

  /// 弹出底部抽屉，显示最近打开的项目列表 + "打开文件夹"按钮。
  Future<void> _showLocalProjectPicker() async {
    final recentProjects = await RecentProjectsService.getRecentProjects();
    if (!mounted) return;

    final theme = Theme.of(context);
    final target = ref.read(chatProvider).workspaceTarget;
    final currentPath = target?.localPath;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 标题栏
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Row(
                  children: [
                    Icon(Icons.history, size: 18,
                        color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      I18n.t('chat.workspaceRecentProjects'),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: () => Navigator.pop(sheetContext),
                      child: Icon(Icons.close, size: 20,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5)),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              // 项目列表
              if (recentProjects.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 20, vertical: 32),
                  child: Column(
                    children: [
                      Icon(Icons.folder_open_outlined, size: 40,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.3)),
                      const SizedBox(height: 8),
                      Text(
                        I18n.t('chat.workspaceNoRecentProjects'),
                        style: TextStyle(
                          fontSize: 14,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5),
                        ),
                      ),
                    ],
                  ),
                )
              else
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.4,
                  ),
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: recentProjects.length,
                    itemBuilder: (context, index) {
                      final path = recentProjects[index];
                      final name = RecentProjectsService.projectDisplayName(path);
                      final isCurrent = currentPath != null &&
                          RecentProjectsService.normalizePathKey(path) ==
                              RecentProjectsService.normalizePathKey(currentPath);
                      return ListTile(
                        leading: Icon(
                          isCurrent
                              ? Icons.check_circle
                              : Icons.folder_outlined,
                          size: 20,
                          color: isCurrent
                              ? theme.colorScheme.primary
                              : theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                        ),
                        title: Text(
                          name,
                          style: TextStyle(
                            fontWeight: isCurrent
                                ? FontWeight.w600
                                : FontWeight.normal,
                          ),
                        ),
                        subtitle: Text(
                          path,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.4),
                          ),
                        ),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          ref.read(chatProvider.notifier).setWorkspaceTarget(
                                WorkspaceTarget.local(path),
                              );
                          RecentProjectsService.recordProject(path);
                          setState(() {});
                        },
                      );
                    },
                  ),
                ),
              const Divider(height: 1),
              // 打开文件夹按钮
              ListTile(
                leading: Icon(Icons.create_new_folder_outlined,
                    size: 22, color: theme.colorScheme.primary),
                title: Text(
                  I18n.t('chat.workspaceOpenFolder'),
                  style: TextStyle(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _chooseLocalDirectory();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  // ── Build ───────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final target = ref.watch(chatProvider).workspaceTarget;
    final isGithub = target?.mode == WorkspaceMode.github;
    final hasTarget = target != null;
    final modeLabel = isGithub
        ? I18n.t('chat.workspaceGithub')
        : hasTarget
            ? I18n.t('chat.workspaceLocal')
            : I18n.t('chat.workspaceNone');

    // ── GitHub 模式：保持原有三组件布局 ──
    if (isGithub) {
      return Row(
        children: [
          PopupMenuButton<WorkspaceMode>(
            initialValue: target?.mode,
            onSelected: (mode) => mode == WorkspaceMode.local
                ? _chooseLocalDirectory()
                : _chooseGithubRepository(),
            itemBuilder: (context) => [
              PopupMenuItem(
                value: WorkspaceMode.github,
                child: Text(I18n.t('chat.workspaceGithub')),
              ),
              PopupMenuItem(
                value: WorkspaceMode.local,
                child: Text(I18n.t('chat.workspaceLocal')),
              ),
            ],
            child: _ContextChip(
              icon: Icons.cloud_outlined,
              label: modeLabel,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: InkWell(
              onTap: _chooseGithubRepository,
              borderRadius: BorderRadius.circular(8),
              child: _ContextChip(
                icon: Icons.account_tree_outlined,
                label: target?.repository ??
                    I18n.t('chat.workspaceRepository'),
                expanded: true,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: InkWell(
              onTap: _chooseGithubBranch,
              borderRadius: BorderRadius.circular(8),
              child: _ContextChip(
                icon: Icons.call_split_outlined,
                label: target?.branch ??
                    I18n.t('chat.workspaceBranchDefault'),
                expanded: true,
              ),
            ),
          ),
        ],
      );
    }

    // ── 本地模式 / 未选择模式 ──
    // 左侧：模式切换（本地/云端）
    // 右侧：项目目录下拉（显示项目名，点击展开最近项目列表）
    final projectName = target?.localPath != null
        ? RecentProjectsService.projectDisplayName(target!.localPath!)
        : I18n.t('chat.workspaceDirectory');

    return Row(
      children: [
        PopupMenuButton<WorkspaceMode>(
          initialValue: target?.mode,
          onSelected: (mode) => mode == WorkspaceMode.local
              ? _chooseLocalDirectory()
              : _chooseGithubRepository(),
          itemBuilder: (context) => [
            PopupMenuItem(
              value: WorkspaceMode.github,
              child: Text(I18n.t('chat.workspaceGithub')),
            ),
            PopupMenuItem(
              value: WorkspaceMode.local,
              child: Text(I18n.t('chat.workspaceLocal')),
            ),
          ],
          child: _ContextChip(
            icon: Icons.computer_outlined,
            label: I18n.t('chat.workspaceLocal'),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: InkWell(
            onTap: _showLocalProjectPicker,
            borderRadius: BorderRadius.circular(8),
            child: _ContextChip(
              icon: Icons.folder_outlined,
              label: projectName,
              expanded: true,
              trailing: Icon(
                Icons.arrow_drop_down,
                size: 18,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
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
  final Widget? trailing;

  const _ContextChip({
    required this.icon,
    required this.label,
    this.expanded = false,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final child = Row(
      mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: theme.colorScheme.primary),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12),
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 2),
          trailing!,
        ],
      ],
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: child,
    );
  }
}

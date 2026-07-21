import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/mobile_config.dart';
import '../../../core/github/github_browser_auth.dart';
import '../../../core/github/github_service.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/workspace/workspace_target.dart';
import '../chat_controller.dart';

class WorkspaceToolbar extends ConsumerStatefulWidget {
  const WorkspaceToolbar({super.key});

  @override
  ConsumerState<WorkspaceToolbar> createState() => _WorkspaceToolbarState();
}

class _WorkspaceToolbarState extends ConsumerState<WorkspaceToolbar> {
  Future<void> _chooseLocalDirectory() async {
    final path = await FilePicker.platform.getDirectoryPath(
      dialogTitle: I18n.t('chat.workspaceSelectLocal'),
    );
    if (path == null || !mounted) return;
    ref
        .read(chatProvider.notifier)
        .setWorkspaceTarget(WorkspaceTarget.local(path));
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

  @override
  Widget build(BuildContext context) {
    final target = ref.watch(chatProvider).workspaceTarget;
    final isGithub = target?.mode == WorkspaceMode.github;
    final hasTarget = target != null;
    final modeLabel = isGithub
        ? I18n.t('chat.workspaceGithub')
        : hasTarget
            ? I18n.t('chat.workspaceLocal')
            : I18n.t('chat.workspaceNone');

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
            icon: isGithub ? Icons.cloud_outlined : Icons.folder_outlined,
            label: modeLabel,
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: InkWell(
            onTap: isGithub ? _chooseGithubRepository : _chooseLocalDirectory,
            borderRadius: BorderRadius.circular(8),
            child: _ContextChip(
              icon: isGithub
                  ? Icons.account_tree_outlined
                  : Icons.folder_open_outlined,
              label: isGithub
                  ? (target?.repository ?? I18n.t('chat.workspaceRepository'))
                  : (target?.localPath ?? I18n.t('chat.workspaceDirectory')),
              expanded: true,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: InkWell(
            onTap: isGithub ? _chooseGithubBranch : _chooseLocalDirectory,
            borderRadius: BorderRadius.circular(8),
            child: _ContextChip(
              icon: Icons.call_split_outlined,
              label: isGithub
                  ? (target?.branch ?? I18n.t('chat.workspaceBranchDefault'))
                  : I18n.t('chat.workspaceLocal'),
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

  const _ContextChip({
    required this.icon,
    required this.label,
    this.expanded = false,
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

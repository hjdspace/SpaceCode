import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_index.dart';
import '../../core/skills/local_library_notifier.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

/// 库技能详情页：展示 SKILL.md 全文，支持安装/卸载。
///
/// [loadContent] 回调用于读取 SKILL.md 内容（从 rootBundle）。
/// 测试时可注入 mock 回调。
class LocalLibraryDetailPage extends ConsumerStatefulWidget {
  final String skillName;
  final Future<String> Function() loadContent;

  const LocalLibraryDetailPage({
    super.key,
    required this.skillName,
    required this.loadContent,
  });

  @override
  ConsumerState<LocalLibraryDetailPage> createState() =>
      _LocalLibraryDetailPageState();
}

class _LocalLibraryDetailPageState
    extends ConsumerState<LocalLibraryDetailPage> {
  late Future<String> _contentFuture;

  @override
  void initState() {
    super.initState();
    _contentFuture = widget.loadContent();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(localLibraryProvider);
    final registry = ref.watch(skillRegistryProvider);
    final isInstalled = state.isInstalled(widget.skillName);
    Skill? installedSkill;
    for (final s in registry.skills) {
      if (s.name == widget.skillName) {
        installedSkill = s;
        break;
      }
    }
    final isGithub = installedSkill?.source == SkillSourceKind.github;

    return FutureBuilder<String>(
      future: _contentFuture,
      builder: (context, snapshot) {
        return Scaffold(
          appBar: AppBar(
            title: Text(widget.skillName),
            actions: [
              if (!isInstalled)
                TextButton.icon(
                  icon: const Icon(Icons.download_outlined),
                  label: Text(I18n.t('skills.install')),
                  onPressed: () async {
                    LocalLibrarySkill? libSkill;
                    for (final s in state.skills) {
                      if (s.name == widget.skillName) {
                        libSkill = s;
                        break;
                      }
                    }
                    if (libSkill != null) {
                      await ref
                          .read(localLibraryProvider.notifier)
                          .install(libSkill);
                    }
                  },
                )
              else if (!isGithub)
                TextButton.icon(
                  icon: const Icon(Icons.delete_outline),
                  label: Text(I18n.t('skills.uninstall')),
                  onPressed: () => _confirmDelete(context),
                ),
            ],
          ),
          body: snapshot.hasData
              ? Markdown(data: snapshot.data!)
              : snapshot.hasError
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          '加载失败：${snapshot.error}',
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : const Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(I18n.t('skills.uninstall')),
        content: Text(I18n.t('skills.uninstallConfirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(I18n.t('skills.uninstall')),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await ref
          .read(localLibraryProvider.notifier)
          .uninstall(widget.skillName);
      if (context.mounted) {
        Navigator.of(context).canPop()
            ? Navigator.of(context).pop()
            : context.go('/skills');
      }
    }
  }
}

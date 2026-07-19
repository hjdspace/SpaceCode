import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

class SkillDetailPage extends ConsumerStatefulWidget {
  final String skillName;

  const SkillDetailPage({super.key, required this.skillName});

  @override
  ConsumerState<SkillDetailPage> createState() => _SkillDetailPageState();
}

class _SkillDetailPageState extends ConsumerState<SkillDetailPage> {
  late Future<String> _contentFuture;

  @override
  void initState() {
    super.initState();
    _contentFuture = _loadContent();
  }

  Future<String> _loadContent() async {
    final state = ref.read(skillRegistryProvider);
    final skill = state.find(widget.skillName);
    if (skill == null) {
      throw StateError('Skill not found');
    }
    if (skill.source == SkillSourceKind.bundled) {
      return await rootBundle.loadString(skill.filePath);
    }
    return await File(skill.filePath).readAsString();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(skillRegistryProvider);
    final skill = state.find(widget.skillName);
    if (skill == null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.skillName)),
        body: const Center(child: Text('Skill not found')),
      );
    }
    return FutureBuilder<String>(
      future: _contentFuture,
      builder: (context, snapshot) {
        return Scaffold(
          appBar: AppBar(
            title: Text(skill.name),
            actions: [
              if (skill.source == SkillSourceKind.user ||
                  skill.source == SkillSourceKind.github)
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: I18n.t('skills.delete'),
                  onPressed: () => _confirmDelete(context, skill),
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
                            color: Theme.of(context).colorScheme.error,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : const Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    Skill skill,
  ) async {
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
      await ref.read(skillRegistryProvider.notifier).uninstall(skill.name);
      if (context.mounted) {
        Navigator.of(context).canPop()
            ? Navigator.of(context).pop()
            : context.go('/skills');
      }
    }
  }
}

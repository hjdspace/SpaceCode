import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

class SkillDetailPage extends ConsumerWidget {
  final String skillName;

  const SkillDetailPage({super.key, required this.skillName});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(skillRegistryProvider);
    final skill = state.find(skillName);
    if (skill == null) {
      return Scaffold(
        appBar: AppBar(title: Text(skillName)),
        body: const Center(child: Text('Skill not found')),
      );
    }
    return FutureBuilder<String>(
      future: _loadContent(skill),
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
                  onPressed: () => _confirmDelete(context, ref, skill),
                ),
            ],
          ),
          body: snapshot.hasData
              ? Markdown(data: snapshot.data!)
              : const Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Future<String> _loadContent(Skill skill) async {
    if (skill.source == SkillSourceKind.bundled) {
      return await rootBundle.loadString(skill.filePath);
    }
    return await File(skill.filePath).readAsString();
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
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
            child: const Text('取消'),
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
      if (context.mounted) Navigator.of(context).pop();
    }
  }
}

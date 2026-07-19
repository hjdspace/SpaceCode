import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

class SkillCard extends ConsumerWidget {
  final Skill skill;
  final bool enabled;
  final VoidCallback? onTap;

  const SkillCard({
    super.key,
    required this.skill,
    required this.enabled,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        leading: Icon(_sourceIcon(skill.source, theme)),
        title: Text(
          skill.name,
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
        subtitle: Text(
          skill.description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
        ),
        trailing: Switch(
          value: enabled,
          onChanged: (_) =>
              ref.read(skillRegistryProvider.notifier).toggleEnabled(skill.name),
        ),
        onTap: onTap,
      ),
    );
  }

  IconData _sourceIcon(SkillSourceKind source, ThemeData theme) {
    switch (source) {
      case SkillSourceKind.bundled:
        return Icons.shield_outlined;
      case SkillSourceKind.user:
        return Icons.person_outline;
      case SkillSourceKind.github:
        return Icons.cloud_download_outlined;
      case SkillSourceKind.desktopSync:
        return Icons.sync_outlined;
    }
  }
}

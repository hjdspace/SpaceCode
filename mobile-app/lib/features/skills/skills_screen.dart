import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import 'skill_card.dart';
import 'skill_install_dialog.dart';

class SkillsScreen extends ConsumerWidget {
  const SkillsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(skillRegistryProvider);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(I18n.t('skills.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.download_outlined),
            tooltip: I18n.t('skills.install'),
            onPressed: () => showDialog(
              context: context,
              builder: (_) => const SkillInstallDialog(),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.read(skillRegistryProvider.notifier).refresh(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(skillRegistryProvider.notifier).refresh(),
        child: state.loading && state.skills.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : state.skills.isEmpty
                ? ListView(
                    children: [
                      const SizedBox(height: 120),
                      Center(
                        child: Text(
                          I18n.t('skills.empty'),
                          style: TextStyle(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.5),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    itemCount: state.skills.length,
                    itemBuilder: (context, index) {
                      final skill = state.skills[index];
                      final enabled =
                          !state.disabledNames.contains(skill.name);
                      return SkillCard(
                        skill: skill,
                        enabled: enabled,
                        onTap: () => context.push(
                          '/skills/${skill.name}',
                          extra: skill.name,
                        ),
                      );
                    },
                  ),
      ),
    );
  }
}

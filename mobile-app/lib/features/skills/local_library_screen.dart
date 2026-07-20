import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_index.dart';
import '../../core/skills/local_library_notifier.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';
import 'local_library_card.dart';

/// 本地技能库浏览页：列表 + 搜索 + 分类筛选。
class LocalLibraryScreen extends ConsumerStatefulWidget {
  const LocalLibraryScreen({super.key});

  @override
  ConsumerState<LocalLibraryScreen> createState() => _LocalLibraryScreenState();
}

class _LocalLibraryScreenState extends ConsumerState<LocalLibraryScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(localLibraryProvider);
    final theme = Theme.of(context);

    return Scaffold(
      body: _buildBody(context, state, theme),
    );
  }

  Widget _buildBody(
      BuildContext context, LocalLibraryState state, ThemeData theme) {
    if (state.loading && state.skills.isEmpty) {
      // 用 TickerMode 禁用动画，避免测试中 pumpAndSettle 因持续动画超时。
      return const Center(
        child: TickerMode(
          enabled: false,
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (state.error != null && state.skills.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                state.error!,
                style: TextStyle(color: theme.colorScheme.error),
                textAlign: TextAlign.center,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () =>
                  ref.read(localLibraryProvider.notifier).refresh(),
            ),
          ],
        ),
      );
    }

    if (state.skills.isEmpty) {
      return Center(
        child: Text(
          I18n.t('skills.libraryNoSkills'),
          style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
        ),
      );
    }

    final filtered = state.filteredSkills;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: I18n.t('skills.librarySearchHint'),
              prefixIcon: const Icon(Icons.search),
              border: const OutlineInputBorder(),
              isDense: true,
              suffixIcon: _searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        ref
                            .read(localLibraryProvider.notifier)
                            .setSearchQuery('');
                      },
                    )
                  : null,
            ),
            onChanged: (value) =>
                ref.read(localLibraryProvider.notifier).setSearchQuery(value),
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: LocalLibraryCategories.allValues.map((cat) {
              final selected = state.selectedCategory == cat;
              final label = I18n.t('skills.category${_capitalize(cat)}');
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) =>
                      ref.read(localLibraryProvider.notifier).setCategory(cat),
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 8),
        if (filtered.isEmpty)
          Expanded(
            child: Center(
              child: Text(
                I18n.t('skills.libraryEmpty'),
                style: TextStyle(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
              ),
            ),
          )
        else
          Expanded(
            child: RefreshIndicator(
              onRefresh: () =>
                  ref.read(localLibraryProvider.notifier).refresh(),
              child: ListView.builder(
                itemCount: filtered.length,
                itemBuilder: (context, index) {
                  final skill = filtered[index];
                  final status = _resolveStatus(state, skill);
                  return LocalLibraryCard(
                    skill: skill,
                    installStatus: status,
                    onInstall: () {
                      () async {
                        try {
                          await ref
                              .read(localLibraryProvider.notifier)
                              .install(skill);
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('安装失败：$e')),
                            );
                          }
                        }
                      }();
                    },
                    onUninstall: () {
                      () async {
                        try {
                          await ref
                              .read(localLibraryProvider.notifier)
                              .uninstall(skill.name);
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('卸载失败：$e')),
                            );
                          }
                        }
                      }();
                    },
                    onTap: () => context.push('/skills/library/${skill.name}'),
                  );
                },
              ),
            ),
          ),
      ],
    );
  }

  InstallStatus _resolveStatus(
      LocalLibraryState state, LocalLibrarySkill skill) {
    if (!state.isInstalled(skill.name)) {
      return InstallStatus.notInstalled;
    }
    // 检查 SkillRegistry 中该技能的 source 区分 user 和 github
    final registry = ref.read(skillRegistryProvider);
    Skill? installed;
    for (final s in registry.skills) {
      if (s.name == skill.name) {
        installed = s;
        break;
      }
    }
    if (installed?.source == SkillSourceKind.github) {
      return InstallStatus.installedGithub;
    }
    return InstallStatus.installedUser;
  }

  String _capitalize(String s) {
    if (s.isEmpty) return s;
    // 'ai-ml' → 'AiMl'
    return s
        .split('-')
        .map((part) =>
            part.isEmpty ? part : part[0].toUpperCase() + part.substring(1))
        .join();
  }
}

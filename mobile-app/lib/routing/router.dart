import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/skills/local_library_index.dart';
import '../core/skills/local_library_notifier.dart';
import '../features/chat/chat_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/skills/local_library_detail_page.dart';
import '../features/skills/skill_detail_page.dart';
import '../features/skills/skills_screen.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const ChatScreen(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsScreen(),
    ),
    GoRoute(
      path: '/skills',
      builder: (context, state) => const SkillsScreen(),
    ),
    GoRoute(
      path: '/skills/library/:name',
      builder: (context, state) {
        final name = state.pathParameters['name']!;
        return Consumer(
          builder: (context, ref, _) {
            final libState = ref.watch(localLibraryProvider);
            LocalLibrarySkill? skill;
            for (final s in libState.skills) {
              if (s.name == name) {
                skill = s;
                break;
              }
            }
            return LocalLibraryDetailPage(
              skillName: name,
              loadContent: () async {
                if (skill == null) {
                  throw StateError('Skill not found in library: $name');
                }
                return await rootBundle.loadString(skill.assetPath);
              },
            );
          },
        );
      },
    ),
    GoRoute(
      path: '/skills/:name',
      builder: (context, state) =>
          SkillDetailPage(skillName: state.pathParameters['name']!),
    ),
  ],
);

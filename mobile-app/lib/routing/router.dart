import 'package:go_router/go_router.dart';
import '../features/chat/chat_screen.dart';
import '../features/settings/settings_screen.dart';
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
      path: '/skills/:name',
      builder: (context, state) =>
          SkillDetailPage(skillName: state.pathParameters['name']!),
    ),
  ],
);

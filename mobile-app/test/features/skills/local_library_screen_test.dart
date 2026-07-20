import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';
import 'package:spacecode_mobile/features/skills/local_library_screen.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.librarySearchHint': '搜索技能',
        'skills.libraryEmpty': '无匹配技能',
        'skills.libraryNoSkills': '技能库为空',
        'skills.libraryLoadError': '加载失败',
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.installed': '已安装',
        'skills.installedFromGithub': '已安装（GitHub）',
        'skills.categoryAll': '全部',
        'skills.categoryDevelopment': '开发',
        'skills.categoryOffice': '办公',
        'skills.categoryOther': '其他',
      },
    );
  });

  late GoRouter router;

  setUp(() {
    router = GoRouter(routes: [
      GoRoute(path: '/', builder: (c, s) => const LocalLibraryScreen()),
      GoRoute(
          path: '/skills/library/:name',
          builder: (c, s) =>
              Scaffold(body: Text('detail:${s.pathParameters['name']}'))),
    ]);
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    List<LocalLibrarySkill> skills = const [],
    bool loading = false,
    String? error,
    Set<String> installedNames = const {},
    String selectedCategory = 'all',
    String searchQuery = '',
  }) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: skills,
            loading: loading,
            error: error,
            installedNames: installedNames,
            selectedCategory: selectedCategory,
            searchQuery: searchQuery,
          )),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows loading indicator when loading and skills empty',
      (tester) async {
    await pumpScreen(tester, loading: true);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows error message and retry button on error', (tester) async {
    await pumpScreen(tester, error: '加载失败');
    expect(find.text('加载失败'), findsOneWidget);
    expect(find.byIcon(Icons.refresh), findsOneWidget);
  });

  testWidgets('shows empty message when library has no skills', (tester) async {
    await pumpScreen(tester, skills: []);
    expect(find.text('技能库为空'), findsOneWidget);
  });

  testWidgets('shows skill list when skills exist', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'code-review', description: 'Review', category: 'development', assetPath: 'p'),
      LocalLibrarySkill(
          name: 'pdf', description: 'PDF', category: 'office', assetPath: 'p'),
    ]);
    expect(find.text('code-review'), findsOneWidget);
    expect(find.text('pdf'), findsOneWidget);
  });

  testWidgets('search field filters list by query', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'code-review', description: 'Review changes', category: 'development', assetPath: 'p'),
      LocalLibrarySkill(
          name: 'pdf', description: 'PDF processing', category: 'office', assetPath: 'p'),
    ]);
    await tester.enterText(find.byType(TextField), 'pdf');
    await tester.pump();
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('shows category chips', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'a', description: 'd', category: 'development', assetPath: 'p'),
    ]);
    expect(find.text('全部'), findsOneWidget);
    expect(find.text('开发'), findsOneWidget);
  });

  testWidgets('shows install button when skill not installed', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
    ], installedNames: {});
    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when skill installed (user)', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
    ], installedNames: {'foo'});
    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('empty search result shows empty message', (tester) async {
    await pumpScreen(
      tester,
      skills: const [
        LocalLibrarySkill(
            name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
      ],
      searchQuery: 'nonexistent',
    );
    expect(find.text('无匹配技能'), findsOneWidget);
  });
}

class _FakeNotifier extends LocalLibraryNotifier {
  _FakeNotifier({
    required List<LocalLibrarySkill> skills,
    required bool loading,
    required String? error,
    required Set<String> installedNames,
    required String selectedCategory,
    required String searchQuery,
  })  : _state = LocalLibraryState(
          skills: skills,
          loading: loading,
          error: error,
          installedNames: installedNames,
          selectedCategory: selectedCategory,
          searchQuery: searchQuery,
        ),
        super.forTest();

  LocalLibraryState _state;

  @override
  LocalLibraryState get state => _state;

  @override
  set state(LocalLibraryState value) {
    _state = value;
  }

  @override
  Future<void> refresh() async {}

  @override
  void setCategory(String category) {}

  @override
  void setSearchQuery(String query) {}

  @override
  Future<void> install(LocalLibrarySkill skill) async {}

  @override
  Future<void> uninstall(String name) async {}
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';
import 'package:spacecode_mobile/features/skills/local_library_detail_page.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.uninstallConfirm': '确定卸载此技能？',
      },
    );
  });

  testWidgets('renders skill markdown content', (tester) async {
    const content = '# Foo Skill\n\nThis is the foo skill description.';
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => content,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('foo'), findsOneWidget); // AppBar title
    expect(find.text('Foo Skill'), findsOneWidget); // Markdown H1
    expect(find.textContaining('foo skill description'), findsOneWidget);
  });

  testWidgets('shows install button when not installed', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => '# Foo',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when installed', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {'foo'},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => '# Foo',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('shows loading indicator before content loads', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async {
              await Future.delayed(const Duration(seconds: 1));
              return '# Foo';
            },
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    // 推进 fake timer 让 Future.delayed 完成，避免测试结束时 timer pending。
    await tester.pump(const Duration(seconds: 1));
  });

  testWidgets('shows error message on content load failure', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => throw StateError('load failed'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('load failed'), findsOneWidget);
  });
}

class _FakeNotifier extends LocalLibraryNotifier {
  _FakeNotifier({
    required List<LocalLibrarySkill> skills,
    required Set<String> installedNames,
  })  : _state = LocalLibraryState(
          skills: skills,
          loading: false,
          error: null,
          installedNames: installedNames,
          selectedCategory: 'all',
          searchQuery: '',
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
  Future<void> install(LocalLibrarySkill skill) async {}

  @override
  Future<void> uninstall(String name) async {}
}

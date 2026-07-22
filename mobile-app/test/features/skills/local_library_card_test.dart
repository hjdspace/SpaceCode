import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/features/skills/local_library_card.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.installed': '已安装',
        'skills.installedFromGithub': '已安装（GitHub）',
      },
    );
  });

  Future<void> pumpCard(
    WidgetTester tester, {
    required LocalLibrarySkill skill,
    required InstallStatus installStatus,
    VoidCallback? onInstall,
    VoidCallback? onUninstall,
    VoidCallback? onTap,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LocalLibraryCard(
            skill: skill,
            installStatus: installStatus,
            onInstall: onInstall,
            onUninstall: onUninstall,
            onTap: onTap,
          ),
        ),
      ),
    );
  }

  testWidgets('displays skill name and description', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'code-review',
      description: 'Review the changes since a fixed point',
      category: 'development',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.notInstalled);

    expect(find.text('code-review'), findsOneWidget);
    expect(find.text('Review the changes since a fixed point'), findsOneWidget);
  });

  testWidgets('shows install button when not installed', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.notInstalled);

    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when installed from user', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.installedUser);

    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('shows "installed from GitHub" text when installed from github', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.installedGithub);

    expect(find.text('已安装（GitHub）'), findsOneWidget);
  });

  testWidgets('onInstall callback is triggered', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: '', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.notInstalled,
      onInstall: () => tapped = true,
    );

    await tester.tap(find.text('安装'));
    expect(tapped, true);
  });

  testWidgets('onUninstall callback is triggered', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: '', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.installedUser,
      onUninstall: () => tapped = true,
    );

    await tester.tap(find.text('卸载'));
    expect(tapped, true);
  });

  testWidgets('onTap callback triggered on card tap', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: 'desc', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.notInstalled,
      onTap: () => tapped = true,
    );

    await tester.tap(find.text('foo'));
    expect(tapped, true);
  });
}

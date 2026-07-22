import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spacecode_mobile/core/config/mobile_config.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/features/chat/providers/model_provider.dart';
import 'package:spacecode_mobile/features/chat/widgets/chat_input.dart';

void main() {
  setUpAll(() {
    SharedPreferences.setMockInitialValues({});
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'chat.inputHint': '输入消息...',
        'chat.send': '发送',
        'chat.mentionFile': '选择文件',
        'chat.mentionFolder': '选择文件夹',
        'chat.mentionImage': '选择图片',
        'chat.skillsPill': '技能',
        'chat.shortcutPill': '快捷',
        'chat.modelTitle': '选择模型',
        'chat.commandNew': '新建会话',
        'chat.commandSettings': '打开设置',
        'chat.commandSkills': '管理技能',
        'chat.groupCommands': '常用',
        'chat.groupSkills': '技能',
        'chat.attachmentFile': '文件',
        'chat.attachmentFolder': '文件夹',
        'chat.attachmentImage': '图片',
        'chat.workspaceNone': '未选择工作区',
        'chat.workspaceLocal': '本地',
        'chat.workspaceGithub': '云端',
        'chat.workspaceDirectory': '选择工作目录',
        'chat.workspaceRecentProjects': '最近打开的项目',
        'chat.workspaceNoRecentProjects': '暂无最近打开的项目',
        'chat.workspaceOpenFolder': '打开文件夹',
        'chat.workspaceSelectLocal': '选择本地目录',
        'chat.workspaceSelectRepository': '选择 GitHub 仓库',
        'chat.workspaceSelectBranch': '选择分支',
        'chat.workspaceRepository': 'Github 仓库',
        'chat.workspaceBranch': 'Github 分支',
        'chat.workspaceBranchDefault': '默认分支',
      },
    );
  });

  Future<void> pumpChatInput(WidgetTester tester) async {
    final container = ProviderContainer(overrides: [
      mobileConfigProvider.overrideWith((ref) => _FakeMobileConfigNotifier()),
      modelServiceProvider.overrideWith((ref) => _FakeModelService()),
      skillRegistryProvider.overrideWith(
        (ref) => _FakeSkillRegistryNotifier(ref),
      ),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: Scaffold(body: ChatInput())),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('renders TextField and send button', (tester) async {
    await pumpChatInput(tester);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
  });

  testWidgets('shows MentionPicker after typing @', (tester) async {
    await pumpChatInput(tester);
    await tester.enterText(find.byType(TextField), '@');
    await tester.pumpAndSettle();
    expect(find.text('选择文件'), findsOneWidget);
    expect(find.text('选择文件夹'), findsOneWidget);
    expect(find.text('选择图片'), findsOneWidget);
  });

  testWidgets('shows CommandMenu after typing /', (tester) async {
    await pumpChatInput(tester);
    await tester.enterText(find.byType(TextField), '/');
    await tester.pumpAndSettle();
    expect(find.text('常用'), findsOneWidget);
    expect(find.text('新建会话'), findsOneWidget);
    expect(find.text('打开设置'), findsOneWidget);
    expect(find.text('管理技能'), findsOneWidget);
  });
}

class _FakeMobileConfigNotifier extends MobileConfigNotifier {
  _FakeMobileConfigNotifier();

  @override
  Future<MobileConfig> load() async => state;
}

class _FakeModelService extends ModelService {
  _FakeModelService() : super(apiKey: '', baseUrl: '');

  @override
  Future<List<String>> fetchModels() async => ModelService.defaultModels;
}

class _FakeSkillRegistryNotifier extends SkillRegistryNotifier {
  _FakeSkillRegistryNotifier(super.ref);

  @override
  Future<void> refresh() async {}
}

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spacecode_mobile/core/storage/chat_history_storage.dart';
import 'package:spacecode_mobile/core/workspace/workspace_target.dart';

void main() {
  test('persists the workspace selected for a chat session', () async {
    SharedPreferences.setMockInitialValues({});
    final storage = ChatHistoryStorage();

    await storage.saveSession(
      sessionId: 'session-1',
      title: 'Agent task',
      messages: const [],
      workspaceTarget: const WorkspaceTarget.github(
        repository: 'spacecode/mobile',
        branch: 'feature/agent',
        localPath: '/workspace/mobile',
      ),
    );

    final restored = (await storage.loadAll()).sessions.single.workspaceTarget;
    expect(restored?.mode, WorkspaceMode.github);
    expect(restored?.repository, 'spacecode/mobile');
    expect(restored?.branch, 'feature/agent');
    expect(restored?.localPath, '/workspace/mobile');
  });
}

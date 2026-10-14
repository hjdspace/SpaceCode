import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/permission_request.dart';

/// 回应权限请求时，桌面按 requestId 匹配 pending 请求、本地 Agent 按 toolUseId
/// 认领 —— 两个 id 必须在桌面 push 里分别存活，否则答复会落到
/// "No pending permission request with id=..."。
void main() {
  final request = PermissionRequest(
    sessionId: 'session-aaaa-1111',
    requestId: 'permission-request-77',
    toolUseId: 'tool-call-1',
    toolName: 'Bash',
    input: '{"command":"ls"}',
  );

  group('PermissionRequestWire', () {
    test('desktopResponse 用 requestId，不用 toolUseId', () {
      expect(request.desktopResponse, {
        'sessionId': 'session-aaaa-1111',
        'requestId': 'permission-request-77',
      });
      expect(request.desktopResponse.containsValue('tool-call-1'), isFalse);
    });

    test('desktopResponse 用请求自带的 sessionId', () {
      final other = PermissionRequest(
        sessionId: 'session-bbbb-2222',
        requestId: 'permission-request-88',
        toolUseId: 'tool-call-2',
        toolName: 'Read',
        input: '',
      );
      expect(other.desktopResponse['sessionId'], 'session-bbbb-2222');
    });

    test('localResponseKey 用 toolUseId', () {
      expect(request.localResponseKey, 'tool-call-1');
    });

    test('本地 Agent 模式下 requestId 缺省为空串', () {
      final localOnly = PermissionRequest(
        sessionId: 'session-cccc-3333',
        toolUseId: 'tool-call-3',
        toolName: 'Write',
        input: '',
      );
      expect(localOnly.requestId, '');
      expect(localOnly.desktopResponse['requestId'], '');
    });
  });
}

class PermissionRequest {
  final String sessionId;

  /// 桌面授权接口按这个 id 匹配 pending 请求，与 [toolUseId] 是两个不同的 id；
  /// 本地 Agent 模式没有桌面 requestId，此处为空串。
  final String requestId;
  final String toolUseId;
  final String toolName;
  final String input;

  PermissionRequest({
    required this.sessionId,
    this.requestId = '',
    required this.toolUseId,
    required this.toolName,
    required this.input,
  });
}

/// 回应权限请求时两条链路用的键不同。
extension PermissionRequestWire on PermissionRequest {
  /// 桌面协同（WS）：桌面 pending 表按 requestId 存，sessionId 用请求自带的。
  Map<String, String> get desktopResponse => {
        'sessionId': sessionId,
        'requestId': requestId,
      };

  /// 本地 Agent：LocalAgentService 按 toolUseId 认领。
  String get localResponseKey => toolUseId;
}

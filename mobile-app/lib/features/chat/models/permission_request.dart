class PermissionRequest {
  final String sessionId;
  final String toolUseId;
  final String toolName;
  final String input;

  PermissionRequest({
    required this.sessionId,
    required this.toolUseId,
    required this.toolName,
    required this.input,
  });
}

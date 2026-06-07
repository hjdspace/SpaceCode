/// 客户端 → 桌面端 请求类型
enum RequestType {
  connect('connect'),
  sendMessage('send_message'),
  abort('abort'),
  allowPermission('allow_permission'),
  denyPermission('deny_permission'),
  submitToolAnswer('submit_tool_answer'),
  listSessions('list_sessions'),
  restoreSession('restore_session'),
  newSession('new_session'),
  switchSession('switch_session'),
  listAgents('list_agents'),
  getSettings('get_settings');

  const RequestType(this.value);
  final String value;
}

/// 桌面端 → 客户端 推送类型
enum PushType {
  connected('connected'),
  streamEvent('stream_event'),
  assistant('assistant'),
  toolUse('tool_use'),
  toolResult('tool_result'),
  permissionRequest('permission_request'),
  result('result'),
  sessionsList('sessions_list'),
  agentsList('agents_list'),
  settingsSync('settings_sync'),
  themeSync('theme_sync'),
  themeChanged('theme_changed'),
  error('error'),
  pong('pong');

  const PushType(this.value);
  final String value;

  static PushType fromString(String value) {
    return PushType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => PushType.error,
    );
  }
}

/// WS 请求消息
class MobileRequest {
  final RequestType type;
  final String? id;
  final Map<String, dynamic>? data;

  MobileRequest({required this.type, this.id, this.data});

  Map<String, dynamic> toJson() => {
    'type': type.value,
    if (id != null) 'id': id,
    if (data != null) 'data': data,
  };
}

/// WS 推送消息
class MobilePush {
  final PushType type;
  final Map<String, dynamic>? data;

  MobilePush({required this.type, this.data});

  factory MobilePush.fromJson(Map<String, dynamic> json) {
    return MobilePush(
      type: PushType.fromString(json['type'] as String),
      data: json['data'] as Map<String, dynamic>?,
    );
  }
}

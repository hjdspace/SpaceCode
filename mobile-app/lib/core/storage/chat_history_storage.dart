// 持久化手机端聊天历史。
//
// 数据结构（SharedPreferences key: 'chat_history'）：
//   {
//     "currentSessionId": "uuid",
//     "sessions": [
//       {
//         "id": "uuid",
//         "title": "首条用户消息前 30 字符",
//         "createdAt": "ISO8601",
//         "updatedAt": "ISO8601",
//         "projectPath": "D:/AI/SpaceCode",
//         "messages": [ChatMessage.toJson, ...]
//       }
//     ]
//   }
//
// 设计权衡：
//   - 直接存储所有会话的完整消息列表，避免分库查询
//   - 每次保存整体序列化，简单可靠（手机端会话数量有限）
//   - 异步保存 + 失败静默，不影响 UI
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../features/chat/models/message.dart';
import '../workspace/workspace_target.dart';

class SessionSummary {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? projectPath;
  final WorkspaceTarget? workspaceTarget;
  final int messageCount;

  const SessionSummary({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    this.projectPath,
    this.workspaceTarget,
    required this.messageCount,
  });

  factory SessionSummary.fromJson(Map<String, dynamic> json) => SessionSummary(
    id: json['id'] as String? ?? '',
    title: json['title'] as String? ?? '新对话',
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
    updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ?? DateTime.now(),
    projectPath: json['projectPath'] as String?,
    workspaceTarget: json['workspaceTarget'] is Map<String, dynamic>
        ? WorkspaceTarget.fromJson(
            json['workspaceTarget'] as Map<String, dynamic>)
        : null,
    messageCount: json['messageCount'] as int? ?? 0,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
    'projectPath': projectPath,
    'workspaceTarget': workspaceTarget?.toJson(),
    'messageCount': messageCount,
  };
}

class _StoredSession {
  final SessionSummary summary;
  final List<ChatMessage> messages;

  const _StoredSession({required this.summary, required this.messages});

  Map<String, dynamic> toJson() => {
    ...summary.toJson(),
    'messages': messages.map((m) => m.toJson()).toList(),
  };
}

class ChatHistoryData {
  final String? currentSessionId;
  final List<SessionSummary> sessions;

  const ChatHistoryData({
    this.currentSessionId,
    this.sessions = const [],
  });
}

class ChatHistoryStorage {
  static const _kKey = 'chat_history';

  Future<ChatHistoryData> loadAll() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      if (raw == null || raw.isEmpty) return const ChatHistoryData();

      final json = jsonDecode(raw) as Map<String, dynamic>;
      final sessionsRaw = json['sessions'] as List<dynamic>? ?? [];
      final sessions = sessionsRaw
          .map((s) => SessionSummary.fromJson(s as Map<String, dynamic>))
          .toList()
        // 按 updatedAt 倒序，最近使用的会话排在最前
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

      return ChatHistoryData(
        currentSessionId: json['currentSessionId'] as String?,
        sessions: sessions,
      );
    } catch (_) {
      return const ChatHistoryData();
    }
  }

  Future<List<ChatMessage>> loadMessages(String sessionId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      if (raw == null || raw.isEmpty) return [];

      final json = jsonDecode(raw) as Map<String, dynamic>;
      final sessions = json['sessions'] as List<dynamic>? ?? [];
      for (final s in sessions) {
        final m = s as Map<String, dynamic>;
        if (m['id'] == sessionId) {
          final msgs = m['messages'] as List<dynamic>? ?? [];
          return msgs
              .map((j) => ChatMessage.fromJson(j as Map<String, dynamic>))
              .toList();
        }
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  /// 保存单个会话（upsert：若已存在同 id 则替换，否则插入）。
  /// currentSessionId 一并更新。
  Future<void> saveSession({
    required String sessionId,
    required String title,
    required List<ChatMessage> messages,
    String? projectPath,
    WorkspaceTarget? workspaceTarget,
    DateTime? createdAt,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      Map<String, dynamic> root = {};
      if (raw != null && raw.isNotEmpty) {
        root = jsonDecode(raw) as Map<String, dynamic>;
      }
      final sessionsRaw = (root['sessions'] as List<dynamic>? ?? [])
          .map((s) => s as Map<String, dynamic>)
          .toList();

      final now = DateTime.now();
      final existingIdx = sessionsRaw.indexWhere((s) => s['id'] == sessionId);
      final created = existingIdx >= 0
          ? (DateTime.tryParse(sessionsRaw[existingIdx]['createdAt'] as String? ?? '') ?? now)
          : (createdAt ?? now);

      final stored = _StoredSession(
        summary: SessionSummary(
          id: sessionId,
          title: title,
          createdAt: created,
          updatedAt: now,
          projectPath: projectPath,
          workspaceTarget: workspaceTarget,
          messageCount: messages.length,
        ),
        messages: messages,
      );

      if (existingIdx >= 0) {
        sessionsRaw[existingIdx] = stored.toJson();
      } else {
        sessionsRaw.add(stored.toJson());
      }

      root['sessions'] = sessionsRaw;
      root['currentSessionId'] = sessionId;

      await prefs.setString(_kKey, jsonEncode(root));
    } catch (_) {
      // 持久化失败不影响 UI
    }
  }

  Future<void> setCurrentSessionId(String? sessionId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      Map<String, dynamic> root = {};
      if (raw != null && raw.isNotEmpty) {
        root = jsonDecode(raw) as Map<String, dynamic>;
      }
      root['currentSessionId'] = sessionId;
      await prefs.setString(_kKey, jsonEncode(root));
    } catch (_) {}
  }

  Future<void> deleteSession(String sessionId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      if (raw == null || raw.isEmpty) return;
      final root = jsonDecode(raw) as Map<String, dynamic>;
      final sessions = (root['sessions'] as List<dynamic>? ?? [])
          .where((s) => (s as Map<String, dynamic>)['id'] != sessionId)
          .toList();
      root['sessions'] = sessions;
      if (root['currentSessionId'] == sessionId) {
        root['currentSessionId'] = sessions.isEmpty ? null : sessions.first['id'];
      }
      await prefs.setString(_kKey, jsonEncode(root));
    } catch (_) {}
  }
}

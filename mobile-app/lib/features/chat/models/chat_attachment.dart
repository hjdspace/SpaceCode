import 'package:flutter/foundation.dart';

/// 聊天附件类型。
enum ChatAttachmentKind { file, folder, image }

/// 聊天输入框的附件数据模型。
///
/// 用于在用户发送消息前附加文件、文件夹或图片，并可在本地 Agent 模式下
/// 将附件上下文拼入 prompt。
@immutable
class ChatAttachment {
  final ChatAttachmentKind kind;
  final String name;
  final String path;
  final String? contentBase64;

  const ChatAttachment({
    required this.kind,
    required this.name,
    required this.path,
    this.contentBase64,
  });

  /// 带 emoji 的展示文本，例如 "📄 main.dart"。
  String get displayLabel {
    final emoji = switch (kind) {
      ChatAttachmentKind.file => '📄',
      ChatAttachmentKind.folder => '📁',
      ChatAttachmentKind.image => '🖼️',
    };
    return '$emoji $name';
  }

  /// 用于拼入本地 Agent prompt 的附件上下文。
  String get promptContext {
    final kindLabel = switch (kind) {
      ChatAttachmentKind.file => '文件',
      ChatAttachmentKind.folder => '文件夹',
      ChatAttachmentKind.image => '图片',
    };
    final buffer = StringBuffer()
      ..writeln('附件类型：$kindLabel')
      ..writeln('名称：$name')
      ..writeln('路径：$path');
    if (contentBase64 != null && contentBase64!.isNotEmpty) {
      buffer.writeln('Base64 内容：$contentBase64');
    }
    return buffer.toString().trimRight();
  }

  ChatAttachment copyWith({
    ChatAttachmentKind? kind,
    String? name,
    String? path,
    String? contentBase64,
  }) =>
      ChatAttachment(
        kind: kind ?? this.kind,
        name: name ?? this.name,
        path: path ?? this.path,
        contentBase64: contentBase64 ?? this.contentBase64,
      );
}

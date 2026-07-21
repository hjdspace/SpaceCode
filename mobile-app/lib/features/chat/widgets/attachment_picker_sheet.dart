import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/i18n/strings.dart';
import '../models/chat_attachment.dart';

/// 附件选择底部抽屉。
///
/// 通过 [showModalBottomSheet] 弹出，返回用户选择的 [ChatAttachment] 列表。
/// 若用户取消或选择失败，返回空列表。
class AttachmentPickerSheet extends StatelessWidget {
  const AttachmentPickerSheet({super.key});

  Future<void> _pickFiles(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(allowMultiple: true);
    final attachments = <ChatAttachment>[];
    if (result != null) {
      for (final file in result.files) {
        final path = file.path;
        if (path != null && path.isNotEmpty) {
          attachments.add(ChatAttachment(
            kind: ChatAttachmentKind.file,
            name: file.name,
            path: path,
          ));
        }
      }
    }
    if (context.mounted) {
      Navigator.pop(context, attachments);
    }
  }

  Future<void> _pickFolder(BuildContext context) async {
    final path = await FilePicker.platform.getDirectoryPath();
    final attachments = <ChatAttachment>[];
    if (path != null && path.isNotEmpty) {
      attachments.add(ChatAttachment(
        kind: ChatAttachmentKind.folder,
        name: _basename(path),
        path: path,
      ));
    }
    if (context.mounted) {
      Navigator.pop(context, attachments);
    }
  }

  Future<void> _pickImages(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: true,
    );
    final attachments = <ChatAttachment>[];
    if (result != null) {
      for (final file in result.files) {
        final path = file.path;
        if (path != null && path.isNotEmpty) {
          attachments.add(ChatAttachment(
            kind: ChatAttachmentKind.image,
            name: file.name,
            path: path,
          ));
        }
      }
    }
    if (context.mounted) {
      Navigator.pop(context, attachments);
    }
  }

  String _basename(String path) {
    final index = path.lastIndexOf(RegExp(r'[/\\]'));
    return index < 0 ? path : path.substring(index + 1);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            ListTile(
              leading: Icon(
                Icons.insert_drive_file_outlined,
                color: theme.colorScheme.primary,
              ),
              title: Text(
                I18n.t('chat.attachmentFile'),
                style: TextStyle(color: theme.colorScheme.onSurface),
              ),
              onTap: () => _pickFiles(context),
            ),
            ListTile(
              leading: Icon(
                Icons.folder_outlined,
                color: theme.colorScheme.primary,
              ),
              title: Text(
                I18n.t('chat.attachmentFolder'),
                style: TextStyle(color: theme.colorScheme.onSurface),
              ),
              onTap: () => _pickFolder(context),
            ),
            ListTile(
              leading: Icon(
                Icons.image_outlined,
                color: theme.colorScheme.primary,
              ),
              title: Text(
                I18n.t('chat.attachmentImage'),
                style: TextStyle(color: theme.colorScheme.onSurface),
              ),
              onTap: () => _pickImages(context),
            ),
          ],
        ),
      ),
    );
  }
}

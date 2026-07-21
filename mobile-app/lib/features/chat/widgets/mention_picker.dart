import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../../../../core/i18n/strings.dart';
import '../models/chat_attachment.dart';

/// @ mention 选择浮层。
///
/// 通过 [OverlayEntry] 或 [showDialog] 等方式展示，用户选择文件、文件夹或图片后，
/// 通过 [onSelected] 回调单个 [ChatAttachment] 并自动关闭浮层。
class MentionPicker extends StatelessWidget {
  final ValueChanged<ChatAttachment> onSelected;

  const MentionPicker({super.key, required this.onSelected});

  Future<void> _pickFile(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(allowMultiple: false);
    final file = result?.files.firstOrNull;
    final path = file?.path;
    if (path == null || path.isEmpty) return;

    onSelected(ChatAttachment(
      kind: ChatAttachmentKind.file,
      name: file!.name,
      path: path,
    ));

    if (context.mounted) {
      Navigator.pop(context);
    }
  }

  Future<void> _pickFolder(BuildContext context) async {
    final path = await FilePicker.platform.getDirectoryPath();
    if (path == null || path.isEmpty) return;

    onSelected(ChatAttachment(
      kind: ChatAttachmentKind.folder,
      name: _basename(path),
      path: path,
    ));

    if (context.mounted) {
      Navigator.pop(context);
    }
  }

  Future<void> _pickImage(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    final file = result?.files.firstOrNull;
    final path = file?.path;
    if (path == null || path.isEmpty) return;

    onSelected(ChatAttachment(
      kind: ChatAttachmentKind.image,
      name: file!.name,
      path: path,
    ));

    if (context.mounted) {
      Navigator.pop(context);
    }
  }

  String _basename(String path) {
    final index = path.lastIndexOf(RegExp(r'[/\\]'));
    return index < 0 ? path : path.substring(index + 1);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      color: theme.colorScheme.surface,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 220),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(
                  Icons.insert_drive_file_outlined,
                  color: theme.colorScheme.primary,
                ),
                title: Text(I18n.t('chat.mentionFile')),
                onTap: () => _pickFile(context),
              ),
              const Divider(height: 1),
              ListTile(
                leading: Icon(
                  Icons.folder_outlined,
                  color: theme.colorScheme.primary,
                ),
                title: Text(I18n.t('chat.mentionFolder')),
                onTap: () => _pickFolder(context),
              ),
              const Divider(height: 1),
              ListTile(
                leading: Icon(
                  Icons.image_outlined,
                  color: theme.colorScheme.primary,
                ),
                title: Text(I18n.t('chat.mentionImage')),
                onTap: () => _pickImage(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

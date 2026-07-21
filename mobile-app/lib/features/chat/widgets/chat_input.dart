import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'package:go_router/go_router.dart';
import 'package:speech_to_text/speech_to_text.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/skills/skill_registry.dart';
import '../chat_controller.dart';
import '../models/chat_attachment.dart';
import 'command_menu.dart';
import 'mention_picker.dart';
import 'model_selector.dart';

class ChatInput extends ConsumerStatefulWidget {
  const ChatInput({super.key});

  @override
  ConsumerState<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends ConsumerState<ChatInput> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _speech = SpeechToText();
  OverlayEntry? _commandMenuOverlay;
  OverlayEntry? _mentionOverlay;
  int _commandSelectedIndex = 0;
  List<CommandMenuItem> _commandItems = const [];
  bool _speechAvailable = false;
  bool _isListening = false;

  bool get _canSend =>
      _controller.text.trim().isNotEmpty && !ref.read(chatProvider).isLoading;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onInputChanged);
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    try {
      final available = await _speech.initialize(
        onError: (_) => setState(() => _isListening = false),
        onStatus: (status) {
          if (status == 'done' || status == 'notListening') {
            setState(() => _isListening = false);
          }
        },
      );
      if (mounted) {
        setState(() => _speechAvailable = available);
      }
    } catch (_) {
      setState(() => _speechAvailable = false);
    }
  }

  @override
  void dispose() {
    _hideCommandMenu();
    _hideMentionPicker();
    _controller.dispose();
    _focusNode.dispose();
    _speech.cancel();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final notifier = ref.read(chatProvider.notifier);
    notifier.sendMessage(text, attachments: notifier.currentAttachments());
    _controller.clear();
    _focusNode.requestFocus();
  }

  void _onInputChanged() {
    final text = _controller.text;
    final selection = _controller.selection;

    if (text.startsWith('/') && !text.contains(' ')) {
      _showCommandMenu(text);
    } else {
      _hideCommandMenu();
    }

    _checkMentionTrigger(text, selection);
  }

  void _checkMentionTrigger(String text, TextSelection selection) {
    final cursor = selection.baseOffset;
    if (cursor <= 0 || cursor > text.length) {
      _hideMentionPicker();
      return;
    }
    final charBefore = text[cursor - 1];
    if (charBefore != '@') {
      _hideMentionPicker();
      return;
    }
    final prevIndex = cursor - 2;
    if (prevIndex >= 0) {
      final prevChar = text[prevIndex];
      if (prevChar != ' ' && prevChar != '\n') {
        _hideMentionPicker();
        return;
      }
    }
    _showMentionPicker();
  }

  void _showCommandMenu(String prefix) {
    final registry = ref.read(skillRegistryProvider);
    final allItems = <CommandMenuItem>[
      CommandMenuItem(
        command: '/new',
        description: I18n.t('chat.commandNew'),
        group: I18n.t('chat.groupCommands'),
      ),
      CommandMenuItem(
        command: '/settings',
        description: I18n.t('chat.commandSettings'),
        group: I18n.t('chat.groupCommands'),
      ),
      CommandMenuItem(
        command: '/skills',
        description: I18n.t('chat.commandSkills'),
        group: I18n.t('chat.groupCommands'),
      ),
      ...registry.skills.map((s) => CommandMenuItem(
            command: '/skill:${s.name}',
            description: s.description,
            group: I18n.t('chat.groupSkills'),
          )),
    ];
    final filtered = prefix == '/'
        ? allItems
        : allItems.where((item) => item.command.startsWith(prefix)).toList();
    if (filtered.isEmpty) {
      _hideCommandMenu();
      return;
    }
    setState(() {
      _commandItems = filtered;
      _commandSelectedIndex = 0;
    });
    if (_commandMenuOverlay == null) {
      _commandMenuOverlay = OverlayEntry(
        builder: (context) => _buildPositionedMenu(),
      );
      Overlay.of(context).insert(_commandMenuOverlay!);
    } else {
      _commandMenuOverlay!.markNeedsBuild();
    }
  }

  Widget _buildPositionedMenu() {
    final renderBox = context.findRenderObject() as RenderBox?;
    final size = renderBox?.size ?? Size.zero;
    return Stack(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: _hideCommandMenu,
          child: const SizedBox.expand(),
        ),
        Positioned(
          bottom: size.height + 8,
          left: 12,
          right: 12,
          child: CommandMenu(
            items: _commandItems,
            selectedIndex: _commandSelectedIndex,
            onSelected: _selectCommand,
          ),
        ),
      ],
    );
  }

  Widget _buildPositionedMentionPicker() {
    final renderBox = context.findRenderObject() as RenderBox?;
    final size = renderBox?.size ?? Size.zero;
    return Stack(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: _hideMentionPicker,
          child: const SizedBox.expand(),
        ),
        Positioned(
          bottom: size.height + 8,
          left: 12,
          right: 12,
          child: MentionPicker(
            onSelected: _selectMention,
          ),
        ),
      ],
    );
  }

  void _selectCommand(int index) {
    final item = _commandItems[index];
    _controller.text = '${item.command} ';
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: _controller.text.length),
    );
    _hideCommandMenu();
    _focusNode.requestFocus();
  }

  void _selectMention(ChatAttachment attachment) {
    ref.read(chatProvider.notifier).addAttachment(attachment);
    _hideMentionPicker();
    _focusNode.requestFocus();
  }

  void _hideCommandMenu() {
    _commandMenuOverlay?.remove();
    _commandMenuOverlay = null;
  }

  void _showMentionPicker() {
    if (_mentionOverlay != null) return;
    _mentionOverlay = OverlayEntry(
      builder: (context) => _buildPositionedMentionPicker(),
    );
    Overlay.of(context).insert(_mentionOverlay!);
  }

  void _hideMentionPicker() {
    _mentionOverlay?.remove();
    _mentionOverlay = null;
  }

  bool _handleKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent) return false;
    final key = event.logicalKey;

    if (_commandMenuOverlay != null) {
      if (key == LogicalKeyboardKey.arrowDown) {
        setState(() {
          _commandSelectedIndex =
              (_commandSelectedIndex + 1) % _commandItems.length;
        });
        _commandMenuOverlay?.markNeedsBuild();
        return true;
      }
      if (key == LogicalKeyboardKey.arrowUp) {
        setState(() {
          _commandSelectedIndex =
              (_commandSelectedIndex - 1) % _commandItems.length;
        });
        _commandMenuOverlay?.markNeedsBuild();
        return true;
      }
      if (key == LogicalKeyboardKey.enter) {
        _selectCommand(_commandSelectedIndex);
        return true;
      }
      if (key == LogicalKeyboardKey.escape) {
        _hideCommandMenu();
        return true;
      }
    }

    if (_mentionOverlay != null && key == LogicalKeyboardKey.escape) {
      _hideMentionPicker();
      return true;
    }

    return false;
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(allowMultiple: false);
    final file = result?.files.firstOrNull;
    final path = file?.path;
    if (path == null || path.isEmpty) return;
    ref.read(chatProvider.notifier).addAttachment(
          ChatAttachment(
            kind: ChatAttachmentKind.file,
            name: file!.name,
            path: path,
          ),
        );
  }

  Future<void> _pickImage() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    final file = result?.files.firstOrNull;
    final path = file?.path;
    if (path == null || path.isEmpty) return;
    ref.read(chatProvider.notifier).addAttachment(
          ChatAttachment(
            kind: ChatAttachmentKind.image,
            name: file!.name,
            path: path,
          ),
        );
  }

  void _insertShortcutSlash() {
    final text = _controller.text;
    final newText = text.isEmpty ? '/' : '$text/';
    _controller.text = newText;
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: newText.length),
    );
    _focusNode.requestFocus();
  }

  Future<void> _toggleListening() async {
    if (!_speechAvailable) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('语音输入不可用')),
      );
      return;
    }
    if (_isListening) {
      await _speech.stop();
      if (mounted) setState(() => _isListening = false);
      return;
    }
    try {
      final available = await _speech.initialize(
        onError: (_) => setState(() => _isListening = false),
        onStatus: (status) {
          if (status == 'done' || status == 'notListening') {
            setState(() => _isListening = false);
          }
        },
      );
      if (!available) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('无法使用语音识别')),
          );
        }
        return;
      }
      await _speech.listen(
        onResult: (result) {
          final text = result.recognizedWords;
          _controller.text = text;
          _controller.selection = TextSelection.fromPosition(
            TextPosition(offset: text.length),
          );
        },
        listenOptions: SpeechListenOptions(
          partialResults: true,
          cancelOnError: true,
        ),
      );
      if (mounted) setState(() => _isListening = true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('语音输入失败：$error')),
        );
      }
    }
  }

  void _removeAttachment(ChatAttachment attachment) {
    ref.read(chatProvider.notifier).removeAttachment(attachment);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chatState = ref.watch(chatProvider);
    final isLoading = chatState.isLoading;
    final attachments = chatState.currentAttachments;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        border: Border(
          top: BorderSide(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
            ),
          ),
          color: theme.colorScheme.surface,
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (attachments.isNotEmpty) ...[
                  _AttachmentChips(
                    attachments: attachments,
                    onRemove: _removeAttachment,
                  ),
                  const SizedBox(height: 8),
                ],
                Focus(
                  onKeyEvent: (node, event) {
                    if (_handleKeyEvent(event)) {
                      return KeyEventResult.handled;
                    }
                    return KeyEventResult.ignored;
                  },
                  child: TextField(
                    controller: _controller,
                    focusNode: _focusNode,
                    maxLines: null,
                    textInputAction: TextInputAction.newline,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                    ),
                    decoration: InputDecoration(
                      hintText: I18n.t('chat.inputHint'),
                      hintStyle: TextStyle(
                        color: theme.colorScheme.onSurface
                            .withValues(alpha: 0.4),
                      ),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      isDense: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) {
                      if (_commandMenuOverlay != null) {
                        _selectCommand(_commandSelectedIndex);
                      } else {
                        _send();
                      }
                    },
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            _ToolIconButton(
                              icon: Icons.insert_drive_file_outlined,
                              onTap: _pickFile,
                            ),
                            _ToolIconButton(
                              icon: Icons.image_outlined,
                              onTap: _pickImage,
                            ),
                            _PillButton(
                              icon: Icons.auto_awesome_outlined,
                              label: I18n.t('chat.skillsPill'),
                              iconColor: const Color(0xff4caf50),
                              onTap: () => context.go('/skills'),
                            ),
                            _PillButton(
                              icon: Icons.bolt_outlined,
                              label: I18n.t('chat.shortcutPill'),
                              iconColor: const Color(0xffffb300),
                              onTap: _insertShortcutSlash,
                            ),
                            const SizedBox(width: 6),
                            Container(
                              width: 1,
                              height: 18,
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.15),
                            ),
                            const SizedBox(width: 6),
                            ModelSelector(
                              onSelected: ref.read(chatProvider.notifier).setModel,
                            ),
                            _ToolIconButton(
                              icon: _isListening ? Icons.mic : Icons.mic_none_outlined,
                              onTap: _toggleListening,
                              color: _isListening
                                  ? theme.colorScheme.primary
                                  : theme.colorScheme.onSurface.withValues(alpha: 0.6),
                            ),
                            _ToolIconButton(
                              icon: Icons.settings_outlined,
                              onTap: () => context.go('/settings'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    GestureDetector(
                      onTap: isLoading
                          ? () => ref.read(chatProvider.notifier).abort()
                          : _canSend
                              ? _send
                              : null,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: isLoading
                              ? const Color(0xffc64545).withValues(alpha: 0.15)
                              : _canSend
                                  ? const Color(0xff7c3aed)
                                  : theme.colorScheme.onSurface
                                      .withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          isLoading
                              ? Icons.stop_rounded
                              : Icons.arrow_upward_rounded,
                          size: 18,
                          color: isLoading
                              ? const Color(0xffc64545)
                              : _canSend
                                  ? Colors.white
                                  : theme.colorScheme.onSurface
                                      .withValues(alpha: 0.3),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AttachmentChips extends StatelessWidget {
  final List<ChatAttachment> attachments;
  final ValueChanged<ChatAttachment> onRemove;

  const _AttachmentChips({
    required this.attachments,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: attachments.map((attachment) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: theme.colorScheme.primary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                attachment.displayLabel,
                style: TextStyle(
                  fontSize: 12,
                  color: theme.colorScheme.onSurface,
                ),
              ),
              const SizedBox(width: 6),
              GestureDetector(
                onTap: () => onRemove(attachment),
                child: Icon(
                  Icons.close_rounded,
                  size: 14,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _ToolIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final Color? color;

  const _ToolIconButton({
    required this.icon,
    this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(
          icon,
          size: 20,
          color: color ?? theme.colorScheme.onSurface.withValues(alpha: 0.6),
        ),
      ),
    );
  }
}

class _PillButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color iconColor;
  final VoidCallback? onTap;

  const _PillButton({
    required this.icon,
    required this.label,
    required this.iconColor,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: iconColor),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: theme.colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_to_text.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/skills/skill_registry.dart';
import '../chat_controller.dart';
import '../models/chat_attachment.dart';
import 'attachment_picker_sheet.dart';
import 'command_menu.dart';
import 'mention_picker.dart';
import 'model_selector.dart';
import 'workspace_toolbar.dart';

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

  void _insertShortcutSlash() {
    final text = _controller.text;
    final newText = text.isEmpty ? '/' : '$text/';
    _controller.text = newText;
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: newText.length),
    );
    _focusNode.requestFocus();
  }

  Future<void> _showAttachmentMenu() async {
    final result = await showModalBottomSheet<List<ChatAttachment>>(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => AttachmentPickerSheet(
        onAction: (action) {
          switch (action) {
            case AttachmentPickerAction.skills:
              context.go('/skills');
            case AttachmentPickerAction.shortcut:
              _insertShortcutSlash();
          }
        },
      ),
    );
    final attachments = result ?? const <ChatAttachment>[];
    if (attachments.isEmpty) return;
    final notifier = ref.read(chatProvider.notifier);
    for (final attachment in attachments) {
      notifier.addAttachment(attachment);
    }
  }

  Future<void> _toggleListening() async {
    if (_isListening) {
      await _speech.stop();
      if (mounted) setState(() => _isListening = false);
      return;
    }

    // 主动请求录音权限（Android 6.0+ 需要运行时请求）
    final micStatus = await Permission.microphone.request();
    if (micStatus != PermissionStatus.granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('需要麦克风权限才能使用语音输入'),
            action: SnackBarAction(
              label: '去设置',
              onPressed: () => openAppSettings(),
            ),
          ),
        );
      }
      return;
    }

    try {
      // 每次点击都重新 initialize，避免首次初始化失败后无法重试
      if (!_speechAvailable) {
        final available = await _speech.initialize(
          onError: (_) {
            if (mounted) setState(() => _isListening = false);
          },
          onStatus: (status) {
            if (status == 'done' || status == 'notListening') {
              if (mounted) setState(() => _isListening = false);
            }
          },
        );
        if (!available) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('无法使用语音识别，请检查设备是否支持')),
            );
          }
          return;
        }
        if (mounted) setState(() => _speechAvailable = true);
      }

      await _speech.listen(
        onResult: (result) {
          if (!mounted) return;
          final text = result.recognizedWords;
          if (text.isEmpty) return;
          setState(() {
            final current = _controller.text;
            if (current.isEmpty) {
              _controller.text = text;
            } else {
              _controller.text = '$current $text';
            }
            _controller.selection = TextSelection.fromPosition(
              TextPosition(offset: _controller.text.length),
            );
          });
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
    final showContinue = chatState.canContinue && !isLoading;

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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (showContinue) ...[
              _ContinueBanner(
                onTap: () =>
                    ref.read(chatProvider.notifier).continueLastTurn(),
              ),
              const SizedBox(height: 8),
            ],
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
                side: BorderSide(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
                ),
              ),
              color: theme.scaffoldBackgroundColor,
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
                          filled: false,
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
                        _ToolIconButton(
                          icon: Icons.add_rounded,
                          onTap: _showAttachmentMenu,
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
                          icon: _isListening
                              ? Icons.mic
                              : Icons.mic_none_outlined,
                          onTap: _toggleListening,
                          color: _isListening
                              ? theme.colorScheme.primary
                              : theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                        ),
                        const Spacer(),
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
                                  ? const Color(0xffc64545)
                                      .withValues(alpha: 0.15)
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
            const SizedBox(height: 6),
            const WorkspaceToolbar(),
          ],
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

/// "继续上次任务"横幅：上次因 maxTurns 截断时显示在输入框上方。
///
/// 点击调用 [ChatNotifier.continueLastTurn]，复用历史再次发起 Agent 调用。
class _ContinueBanner extends StatelessWidget {
  final VoidCallback onTap;

  const _ContinueBanner({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xff7c3aed).withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: const Color(0xff7c3aed).withValues(alpha: 0.4),
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.play_arrow_rounded,
              size: 18,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                I18n.t('chat.continueLastTurn'),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.primary,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_rounded,
              size: 16,
              color: theme.colorScheme.primary.withValues(alpha: 0.7),
            ),
          ],
        ),
      ),
    );
  }
}

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/agent/binary_resolver.dart';
import '../../core/i18n/strings.dart';
import '../chat/chat_controller.dart';
import 'terminal_session.dart';

/// 交互式终端页面。
///
/// 功能：
/// - 在当前 workspace 目录下执行 shell 命令
/// - 流式显示 stdout（默认色）/ stderr（红色）
/// - 命令完成后显示退出码与耗时
/// - 支持上/下键切换历史命令
/// - 支持中断当前运行中的命令（Ctrl+C 按钮）
/// - 离开页面时若有命令运行，弹确认对话框
class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key});

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  TerminalSession? _session;
  final TextEditingController _inputController = TextEditingController();
  final FocusNode _inputFocus = FocusNode();
  final ScrollController _scrollController = ScrollController();
  final List<_TerminalLine> _lines = [];
  final List<String> _history = [];
  int _historyIndex = -1;
  StreamSubscription<TerminalOutput>? _subscription;
  bool _running = false;

  @override
  void initState() {
    super.initState();
    _inputController.addListener(_onInputChanged);
  }

  void _onInputChanged() {
    setState(() {});
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _inputController.removeListener(_onInputChanged);
    _inputController.dispose();
    _inputFocus.dispose();
    _scrollController.dispose();
    _session?.dispose();
    super.dispose();
  }

  String? get _workspacePath {
    final chatState = ref.read(chatProvider);
    final target = chatState.workspaceTarget;
    return target?.localPath;
  }

  void _ensureSession() {
    if (_session != null) return;
    final path = _workspacePath;
    if (path == null) return;
    final env = BinaryResolver.instance.isInitialized
        ? BinaryResolver.instance.environment
        : Platform.environment;
    _session = TerminalSession(
      workingDirectory: path,
      environment: env,
    );
    _subscription = _session!.output.listen(_onOutput);
  }

  void _onOutput(TerminalOutput event) {
    setState(() {
      switch (event.type) {
        case TerminalOutputType.stdout:
          _lines.add(_TerminalLine.stdout(event.text));
          break;
        case TerminalOutputType.stderr:
          _lines.add(_TerminalLine.stderr(event.text));
          break;
        case TerminalOutputType.exit:
          _lines.add(_TerminalLine.exit(
            event.exitCode ?? 0,
            event.durationMs,
          ));
          _running = false;
          break;
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 80),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _submit() async {
    final command = _inputController.text.trim();
    if (command.isEmpty || _running) return;
    _ensureSession();
    if (_session == null) return;
    _history.add(command);
    _historyIndex = _history.length;
    setState(() {
      _lines.add(_TerminalLine.command(command));
      _running = true;
    });
    _inputController.clear();
    await _session!.execute(command);
  }

  void _navigateHistory(int direction) {
    if (_history.isEmpty) return;
    final newIndex = (_historyIndex + direction).clamp(0, _history.length);
    if (newIndex == _historyIndex) return;
    _historyIndex = newIndex;
    _inputController.text =
        newIndex == _history.length ? '' : _history[newIndex];
    _inputController.selection = TextSelection.fromPosition(
      TextPosition(offset: _inputController.text.length),
    );
  }

  Future<void> _interrupt() async {
    await _session?.interrupt();
  }

  void _clear() {
    setState(_lines.clear);
  }

  Future<void> _sendToAgent() async {
    final command = _inputController.text.trim();
    if (command.isEmpty) return;
    final navigator = Navigator.of(context);
    ref.read(chatProvider.notifier).sendMessage(command);
    if (mounted) {
      navigator.maybePop();
    }
  }

  Future<bool> _confirmExit() async {
    if (!_running) return true;
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(I18n.t('terminal.commandRunning')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(I18n.t('terminal.keepRunning')),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(I18n.t('terminal.confirmAbort')),
          ),
        ],
      ),
    );
    if (result == true) {
      await _session?.interrupt();
    }
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final path = _workspacePath;
    final theme = Theme.of(context);
    final hasWorkspace = path != null;

    return PopScope(
      canPop: !_running,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        final allow = await _confirmExit();
        if (allow && mounted) {
          navigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xff1e1e1e),
        appBar: AppBar(
          backgroundColor: const Color(0xff252526),
          foregroundColor: Colors.white,
          title: Text(
            hasWorkspace
                ? _basename(path)
                : I18n.t('terminal.title'),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.clear_all),
              tooltip: I18n.t('terminal.clear'),
              onPressed: _clear,
            ),
            IconButton(
              icon: const Icon(Icons.send_outlined),
              tooltip: I18n.t('terminal.sendToAgent'),
              onPressed: _running ? null : _sendToAgent,
            ),
          ],
        ),
        body: hasWorkspace
            ? Column(
                children: [
                  Expanded(child: _buildOutputArea(theme)),
                  _buildInputArea(theme),
                ],
              )
            : Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    I18n.t('terminal.noWorkspace'),
                    style: const TextStyle(color: Colors.white70),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
      ),
    );
  }

  Widget _buildOutputArea(ThemeData theme) {
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: _lines.length,
      itemBuilder: (ctx, index) {
        final line = _lines[index];
        return _TerminalLineView(line: line);
      },
    );
  }

  Widget _buildInputArea(ThemeData theme) {
    return Container(
      color: const Color(0xff252526),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          const Padding(
            padding: EdgeInsets.only(right: 8),
            child: Text(
              '\$',
              style: TextStyle(
                color: Color(0xff7cb34c),
                fontFamily: 'monospace',
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          Expanded(
            child: KeyboardListener(
              focusNode: _inputFocus,
              onKeyEvent: (event) {
                if (event is KeyDownEvent) {
                  if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
                    _navigateHistory(-1);
                  } else if (event.logicalKey ==
                      LogicalKeyboardKey.arrowDown) {
                    _navigateHistory(1);
                  }
                }
              },
              child: TextField(
                controller: _inputController,
                style: const TextStyle(
                  color: Colors.white,
                  fontFamily: 'monospace',
                  fontSize: 13,
                ),
                decoration: InputDecoration(
                  hintText: I18n.t('terminal.inputHint'),
                  hintStyle: const TextStyle(color: Colors.white38),
                  isDense: true,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 8),
                ),
                onSubmitted: (_) => _submit(),
              ),
            ),
          ),
          if (_running)
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined, color: Colors.redAccent),
              tooltip: I18n.t('terminal.interrupt'),
              onPressed: _interrupt,
            )
          else
            IconButton(
              icon: const Icon(Icons.play_arrow, color: Colors.greenAccent),
              onPressed: _inputController.text.trim().isEmpty ? null : _submit,
            ),
        ],
      ),
    );
  }

  static String _basename(String path) {
    final normalized = path.replaceAll('\\', '/');
    final idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(idx + 1) : normalized;
  }
}

/// 终端中一行内容。
class _TerminalLine {
  final _TerminalLineKind kind;
  final String text;
  final int? exitCode;
  final int? durationMs;

  const _TerminalLine._({
    required this.kind,
    required this.text,
    this.exitCode,
    this.durationMs,
  });

  factory _TerminalLine.command(String text) =>
      _TerminalLine._(kind: _TerminalLineKind.command, text: text);

  factory _TerminalLine.stdout(String text) =>
      _TerminalLine._(kind: _TerminalLineKind.stdout, text: text);

  factory _TerminalLine.stderr(String text) =>
      _TerminalLine._(kind: _TerminalLineKind.stderr, text: text);

  factory _TerminalLine.exit(int code, int durationMs) => _TerminalLine._(
        kind: _TerminalLineKind.exit,
        text: '',
        exitCode: code,
        durationMs: durationMs,
      );
}

enum _TerminalLineKind { command, stdout, stderr, exit }

class _TerminalLineView extends StatelessWidget {
  final _TerminalLine line;

  const _TerminalLineView({required this.line});

  @override
  Widget build(BuildContext context) {
    switch (line.kind) {
      case _TerminalLineKind.command:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(
            '\$ ${line.text}',
            style: const TextStyle(
              color: Color(0xff7cb34c),
              fontFamily: 'monospace',
              fontSize: 13,
              fontStyle: FontStyle.italic,
            ),
          ),
        );
      case _TerminalLineKind.stdout:
        return Text(
          line.text,
          style: const TextStyle(
            color: Color(0xffd4d4d4),
            fontFamily: 'monospace',
            fontSize: 12,
          ),
        );
      case _TerminalLineKind.stderr:
        return Text(
          line.text,
          style: const TextStyle(
            color: Color(0xfff48771),
            fontFamily: 'monospace',
            fontSize: 12,
          ),
        );
      case _TerminalLineKind.exit:
        final code = line.exitCode ?? 0;
        final ms = line.durationMs ?? 0;
        return Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 6),
          child: Text(
            I18n.t('terminal.exitCode', {'code': '$code', 'ms': '$ms'}),
            style: TextStyle(
              color: code == 0
                  ? const Color(0xff6a9955)
                  : const Color(0xfff48771),
              fontFamily: 'monospace',
              fontSize: 11,
            ),
          ),
        );
    }
  }
}

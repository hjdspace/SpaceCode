import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'github_service.dart';

class GithubAuthResult {
  final String token;
  final String login;

  const GithubAuthResult({required this.token, required this.login});
}

Future<GithubAuthResult?> authenticateGithubInBrowser(
    BuildContext context) async {
  const clientId = String.fromEnvironment(
    'SPACE_CODE_GITHUB_CLIENT_ID',
    defaultValue: 'Ov23liy70dXxRSWb0uHP',
  );
  final service = GithubService(token: '');
  try {
    final flow = await service.startDeviceFlow(clientId: clientId);
    await launchUrl(flow.verificationUri, mode: LaunchMode.externalApplication);
    if (!context.mounted) return null;
    final token = await _showDeviceDialog(context, service, flow, clientId);
    if (token == null || !context.mounted) return null;
    final authenticatedService = GithubService(token: token);
    try {
      final login = await authenticatedService.authenticate();
      return GithubAuthResult(token: token, login: login);
    } finally {
      authenticatedService.dispose();
    }
  } finally {
    service.dispose();
  }
}

Future<String?> _showDeviceDialog(
  BuildContext context,
  GithubService service,
  GithubDeviceFlow flow,
  String clientId,
) {
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => _DeviceFlowDialog(
      service: service,
      flow: flow,
      clientId: clientId,
      onCompleted: (token) {
        if (dialogContext.mounted) {
          Navigator.of(dialogContext, rootNavigator: true).pop(token);
        }
      },
      onError: (error) {
        if (dialogContext.mounted) {
          Navigator.of(dialogContext, rootNavigator: true).pop();
        }
      },
    ),
  );
}

class _DeviceFlowDialog extends StatefulWidget {
  final GithubService service;
  final GithubDeviceFlow flow;
  final String clientId;
  final ValueChanged<String> onCompleted;
  final ValueChanged<Object> onError;

  const _DeviceFlowDialog({
    required this.service,
    required this.flow,
    required this.clientId,
    required this.onCompleted,
    required this.onError,
  });

  @override
  State<_DeviceFlowDialog> createState() => _DeviceFlowDialogState();
}

class _DeviceFlowDialogState extends State<_DeviceFlowDialog> {
  bool _completed = false;
  bool _errored = false;

  @override
  void initState() {
    super.initState();
    _poll();
  }

  Future<void> _poll() async {
    try {
      final token = await widget.service
          .pollDeviceFlow(clientId: widget.clientId, flow: widget.flow);
      if (_completed || _errored) return;
      _completed = true;
      if (mounted) {
        setState(() {});
        WidgetsBinding.instance.addPostFrameCallback((_) {
          widget.onCompleted(token);
        });
      }
    } catch (error) {
      if (_completed || _errored) return;
      _errored = true;
      if (mounted) {
        setState(() {});
        WidgetsBinding.instance.addPostFrameCallback((_) {
          widget.onError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_completed) {
      return const AlertDialog(
        title: Text('Github 认证成功'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('正在获取账号信息...'),
          ],
        ),
      );
    }
    if (_errored) {
      return AlertDialog(
        title: const Text('Github 认证失败'),
        content: const Text('授权流程出现错误，请重试。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      );
    }
    return AlertDialog(
      title: const Text('在浏览器中完成 Github 认证'),
      content: SelectableText(
        '已为你打开浏览器，请按以下步骤完成认证：\n\n1. 在浏览器登录 Github（如未登录）\n2. 输入验证码：${widget.flow.userCode}\n3. 授权 SpaceCode Mobile\n\n授权完成后此窗口会自动关闭。\n\n如浏览器未打开，请手动访问：\n${widget.flow.verificationUri}',
      ),
      actions: [
        TextButton(
          onPressed: () => launchUrl(
            widget.flow.verificationUri,
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('重新打开网页'),
        ),
      ],
    );
  }
}

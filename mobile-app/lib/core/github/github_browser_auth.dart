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
  const clientId = String.fromEnvironment('SPACE_CODE_GITHUB_CLIENT_ID');
  if (clientId.trim().isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Github 网页认证需要 OAuth App Client ID，请按 README 配置后重启应用'),
      ),
    );
    return null;
  }
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
  final polling = service.pollDeviceFlow(clientId: clientId, flow: flow);
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => FutureBuilder<String>(
      future: polling,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return AlertDialog(
            title: const Text('Github 认证失败'),
            content: Text(snapshot.error.toString()),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('关闭'),
              ),
            ],
          );
        }
        if (snapshot.hasData) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (dialogContext.mounted) {
              Navigator.pop(dialogContext, snapshot.data);
            }
          });
        }
        return AlertDialog(
          title: const Text('在浏览器中完成 Github 认证'),
          content: SelectableText(
            '打开 ${flow.verificationUri}\n\n验证码：${flow.userCode}\n\n授权完成后此窗口会自动关闭。',
          ),
          actions: [
            TextButton(
              onPressed: () => launchUrl(
                flow.verificationUri,
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('重新打开网页'),
            ),
          ],
        );
      },
    ),
  );
}

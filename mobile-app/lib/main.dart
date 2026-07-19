import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/config/mobile_config.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final container = ProviderContainer();
  // 预加载手机 Agent 引擎配置，避免 chat 发送消息时读到默认空值
  await container.read(mobileConfigProvider.notifier).load();
  runApp(UncontrolledProviderScope(
    container: container,
    child: const SpaceCodeApp(),
  ));
}

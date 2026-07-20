import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/theme_service.dart';
import 'routing/router.dart';

class SpaceCodeApp extends ConsumerWidget {
  const SpaceCodeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeState = ref.watch(themeProvider);
    return MaterialApp.router(
      title: 'SpaceCode',
      theme: themeState.data,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}

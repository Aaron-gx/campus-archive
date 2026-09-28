import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/store.dart';
import '../theme.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'onboarding.dart';
import 'shell.dart';
import 'splash.dart';

/// 启动闸门：等数据就绪 → 启动页 → 引导建袋 / 主界面
class GatePage extends StatelessWidget {
  const GatePage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    if (!store.ready) {
      return const Scaffold(
        backgroundColor: AppColors.paper,
        body: Center(child: CircularProgressIndicator(color: AppColors.ink)),
      );
    }
    return SplashPage(
      onDone: () {
        final s = storeOf(context);
        replaceFadeSlide(
          context,
          s.loggedIn ? const ShellPage() : const OnboardingPage(),
        );
      },
    );
  }
}

import 'package:flutter/material.dart';

/// 统一转场动效（纸质档案袋风格：轻快、克制）
///
/// - [FadeSlideRoute]：二级页推入 —— 淡入 + 轻微上滑 + 微缩放（280ms）
///   返回时反向淡出下滑，方向感与系统手势一致
/// - 根页面替换（登录 → 主界面）用 [FadeSlideRoute] 时 close 动画自动禁用，无回退残留
class FadeSlideRoute<T> extends PageRouteBuilder<T> {
  final Widget page;
  final Offset beginOffset;

  FadeSlideRoute(
    this.page, {
    this.beginOffset = const Offset(0, 0.035),
  }) : super(
          transitionDuration: const Duration(milliseconds: 280),
          reverseTransitionDuration: const Duration(milliseconds: 220),
          pageBuilder: (context, animation, secondaryAnimation) => page,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            final curved = CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
              reverseCurve: Curves.easeInCubic,
            );
            return FadeTransition(
              opacity: curved,
              child: SlideTransition(
                position: curved.drive(Tween(begin: beginOffset, end: Offset.zero)),
                child: ScaleTransition(
                  scale: curved.drive(Tween(begin: 0.985, end: 1.0)),
                  child: child,
                ),
              ),
            );
          },
        );
}

/// 快捷推入二级页（替代 MaterialPageRoute）
Future<T?> pushFadeSlide<T>(BuildContext context, Widget page) =>
    Navigator.of(context).push(FadeSlideRoute<T>(page));

/// 根页面替换（无返回）
Future<T?> replaceFadeSlide<T>(BuildContext context, Widget page) =>
    Navigator.of(context).pushReplacement(FadeSlideRoute<T>(page));

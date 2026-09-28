import 'package:flutter/material.dart';

/// 「简册」纸质档案袋设计语言
/// 取自档案袋 / 索引卡 / 骑缝章的实体记忆。
class AppColors {
  static const paper = Color(0xFFEFE6D3); // 纸色背景
  static const paperDark = Color(0xFFE4D7B8); // 深纸
  static const card = Color(0xFFFBF7EE); // 卡片
  static const ink = Color(0xFF22283B); // 墨色
  static const inkSoft = Color(0xFF6B7182);
  static const inkFaint = Color(0xFF9B9FAB);
  static const seal = Color(0xFFB0392D); // 朱红印章
  static const sealSoft = Color(0xFFF1D9D2);
  static const sage = Color(0xFF6E7B5E); // 灰绿
  static const sageSoft = Color(0xFFE3E6DA);
  static const line = Color(0xFFD8C9A2); // 装订线
  static const gold = Color(0xFFA9822F); // 金
  static const goldSoft = Color(0xFFF3E8CE);
  static const blue = Color(0xFF4A6D8C); // 活动照片分类
  static const blueSoft = Color(0xFFDCE6EF);
  static const viewfinder = Color(0xFF181A22); // 取景器深色
  static const white = Color(0xFFFFFFFF);

  /// 五大分类强调色（与网页版一致）
  static const catAccents = <String, Color>{
    'identity': ink,
    'certificate': gold,
    'experience': sage,
    'photo': blue,
    'portfolio': seal,
  };
  static const catAccentsSoft = <String, Color>{
    'identity': Color(0xFFE4E6EC),
    'certificate': goldSoft,
    'experience': sageSoft,
    'photo': blueSoft,
    'portfolio': sealSoft,
  };
}

ThemeData buildAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: AppColors.paper,
    colorScheme: ColorScheme.light(
      primary: AppColors.ink,
      onPrimary: AppColors.white,
      secondary: AppColors.seal,
      onSecondary: AppColors.white,
      surface: AppColors.card,
      onSurface: AppColors.ink,
      error: AppColors.seal,
      onError: AppColors.white,
      outline: AppColors.line,
    ),
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.paper,
      foregroundColor: AppColors.ink,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(
        color: AppColors.ink,
        fontSize: 17,
        fontWeight: FontWeight.w700,
        letterSpacing: 1,
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.line, thickness: 1),
    textTheme: const TextTheme(
      displayLarge: TextStyle(
        fontSize: 30,
        fontWeight: FontWeight.w900,
        color: AppColors.ink,
        height: 1.25,
      ),
      // 输入框内容使用的样式：必须显式深色，避免部分设备上回退不可见
      bodyLarge: TextStyle(
        fontSize: 15,
        color: AppColors.ink,
        height: 1.4,
      ),
      titleLarge: TextStyle(
        fontSize: 19,
        fontWeight: FontWeight.w800,
        color: AppColors.ink,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
      bodyMedium: TextStyle(
        fontSize: 14.5,
        color: AppColors.ink,
        height: 1.5,
      ),
      bodySmall: TextStyle(fontSize: 12.5, color: AppColors.inkSoft, height: 1.4),
      labelSmall: TextStyle(
        fontSize: 11,
        color: AppColors.inkSoft,
        letterSpacing: 1.2,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      hintStyle: const TextStyle(color: AppColors.inkFaint, fontSize: 14),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: AppColors.ink, width: 1.4),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: AppColors.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    // 平板适配：底部弹层在宽屏下约束宽度并居中，不再拉满全屏
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      constraints: BoxConstraints(maxWidth: 640),
    ),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.ink,
      selectionColor: AppColors.goldSoft,
      selectionHandleColor: AppColors.ink,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: AppColors.ink,
      contentTextStyle: TextStyle(color: AppColors.white, fontSize: 14),
    ),
  );
}

/// 等宽感数字/编号样式（模拟 JetBrains Mono）
const monoStyle = TextStyle(
  fontFeatures: [FontFeature.tabularFigures()],
  letterSpacing: 0.6,
);

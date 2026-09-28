import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:campus_archive_app/theme.dart';

void main() {
  testWidgets('主题构建冒烟测试', (tester) async {
    final theme = buildAppTheme();
    expect(theme.scaffoldBackgroundColor, const Color(0xFFEFE6D3));
    tester.view
      ..devicePixelRatio = 1.0
      ..physicalSize = const Size(360, 720);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: theme,
        home: const Scaffold(body: SizedBox.shrink()),
      ),
    );
    expect(find.byType(SizedBox), findsOneWidget);
  });
}

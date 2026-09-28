import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'data/crypto.dart';
import 'data/db.dart';
import 'pages/gate.dart';
import 'state/store.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // 在 runApp 之前创建并启动数据加载（GatePage 依赖 store.ready）
  final appDb = AppDb();
  final crypto = CryptoService();
  final store = AppStore(appDb: appDb, crypto: crypto);
  store.load();
  runApp(CampusArchiveApp(store: store));
}

class CampusArchiveApp extends StatelessWidget {
  final AppStore store;
  const CampusArchiveApp({super.key, required this.store});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AppDb>.value(value: store.appDb),
        Provider<CryptoService>.value(value: store.crypto),
        ChangeNotifierProvider<AppStore>.value(value: store),
      ],
      child: MaterialApp(
        title: '简册',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
        locale: const Locale('zh', 'CN'),
        home: const GatePage(),
      ),
    );
  }
}

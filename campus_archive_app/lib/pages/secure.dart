import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/widgets.dart';

/// 身份证件 · 加密详情：锁定 → 验证 → 查看，附调档记录
class SecurePage extends StatefulWidget {
  const SecurePage({super.key});

  @override
  State<SecurePage> createState() => _SecurePageState();
}

class _SecurePageState extends State<SecurePage> {
  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final verified = store.sensitiveVerified;
    final rawDocs = store.docsOfMain('identity');
    final groups = groupDocs(rawDocs);

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('身份证件')),
      body: ResponsiveCenter(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
          children: [
            if (groups.isEmpty)
              const EmptyView(
                icon: '🪪',
                title: '暂无材料',
              )
            else if (!verified) ...[
              // 锁定卡
              DashedBox(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
                  child: Column(
                    children: [
                      const Icon(Icons.lock, size: 34, color: AppColors.seal),
                      const SizedBox(height: 10),
                      const Text('材料已加密保护',
                          style: TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 14),
                      PrimaryButton(
                        '二次验证',
                        accent: true,
                        icon: Icons.fingerprint,
                        onPressed: () => showVerifySheet(context, store),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              // 脱敏列表
              for (final g in groups)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: IndexCard(
                    edge: AppColors.ink,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.badge_outlined,
                                size: 20, color: AppColors.ink),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(g.title,
                                  style: const TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w700)),
                            ),
                            const Text('🔒 已加密',
                                style: TextStyle(
                                    fontSize: 11, color: AppColors.inkFaint)),
                          ],
                        ),
                        if (g.hasMultiple) ...[
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            children: [
                              for (final sideDoc in g.docs)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.paperDark,
                                    borderRadius: BorderRadius.circular(3),
                                  ),
                                  child: Text(
                                    sideDoc.side ?? '第${g.docs.indexOf(sideDoc) + 1}面',
                                    style: const TextStyle(
                                        fontSize: 10, color: AppColors.inkFaint),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ] else ...[
              // 已验证状态
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.sageSoft,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.verified_user, size: 15, color: AppColors.sage),
                    const SizedBox(width: 6),
                    Text(
                      '已验证 · ${store.verifyRemainText}',
                      style: const TextStyle(
                          fontSize: 11.5, color: AppColors.sage),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              for (final g in groups)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: IndexCard(
                    edge: AppColors.ink,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            DocThumb(doc: g.main, store: store, size: 64),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(g.title,
                                      style: const TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w700)),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${findCategory(g.main.categoryKey)?.name} · ${fmtSize(g.docs.fold(0, (sum, d) => sum + d.size))} · ${fmtDate(g.main.createdAt)}',
                                    style: const TextStyle(
                                        fontSize: 10.5,
                                        color: AppColors.inkFaint,
                                        fontFeatures: [
                                          FontFeature.tabularFigures()
                                        ]),
                                  ),
                                ],
                              ),
                            ),
                            if (!g.hasMultiple)
                              IconButton(
                                icon: const Icon(Icons.visibility_outlined,
                                    size: 20, color: AppColors.ink),
                                onPressed: () => _view(context, store, g.main),
                              ),
                          ],
                        ),
                        if (g.hasMultiple) ...[
                          const SizedBox(height: 8),
                          const DashedLine(),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              for (final sideDoc in g.docs)
                                Padding(
                                  padding: const EdgeInsets.only(right: 6),
                                  child: OutlinedButton(
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppColors.ink,
                                      side: const BorderSide(color: AppColors.line),
                                      shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(6)),
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 4),
                                      minimumSize: Size.zero,
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                    ),
                                    onPressed: () => _view(context, store, sideDoc),
                                    child: Text(
                                      sideDoc.side ?? '第${g.docs.indexOf(sideDoc) + 1}面',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],

            const SizedBox(height: 16),
            const SectionLabel('调档记录'),
            if (store.logs.isEmpty)
              const Text('暂无调档记录',
                  style: TextStyle(fontSize: 12, color: AppColors.inkFaint))
            else
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  children: [
                    for (var i = 0;
                        i < store.logs.take(6).length && i < 6;
                        i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 5),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              store.logs[i].action == 'export'
                                  ? Icons.ios_share
                                  : Icons.visibility,
                              size: 14,
                              color: AppColors.sage,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    store.logs[i].docTitle,
                                    style: const TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w700),
                                  ),
                                  Text(
                                    '${store.logs[i].action == 'export' ? '导出' : '查看'} · ${relTime(store.logs[i].createdAt)}',
                                    style: const TextStyle(
                                        fontSize: 11,
                                        color: AppColors.inkSoft),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _view(BuildContext context, AppStore store, Doc d) async {
    try {
      final path = await store.viewablePath(d);
      await store.logAccess('view', d);
      await OpenFilex.open(path);
    } on ApiException catch (e) {
      if (e.needSensitiveVerify && context.mounted) {
        final ok = await showVerifySheet(context, store);
        if (ok) await _view(context, store, d);
        return;
      }
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('打开失败：${e.message}')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('打开失败：$e')));
      }
    }
  }
}

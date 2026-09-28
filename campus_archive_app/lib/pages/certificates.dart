import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/widgets.dart';
import 'archive_all.dart' show openDoc;

/// 证书总目：结构化记录（7 级别筛选 + 搜索 + 登记 / 编辑 / 删除）
class CertificatesPage extends StatefulWidget {
  const CertificatesPage({super.key});

  @override
  State<CertificatesPage> createState() => _CertificatesPageState();
}

class _CertificatesPageState extends State<CertificatesPage> {
  String _query = '';
  String? _level;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final certs = _filtered(store);

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('证书总目')),
      body: ResponsiveCenter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: SearchBox(
                        hint: '搜索证书名称 / 颁发单位',
                        onChanged: (v) => setState(() => _query = v.trim()),
                      ),
                    ),
                    const SizedBox(width: 10),
                    GestureDetector(
                      onTap: () => _editSheet(context, store, null),
                      child: Container(
                        height: 44,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        decoration: BoxDecoration(
                          color: AppColors.ink,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Center(
                          child: Text(
                            '＋ 登记',
                            style: TextStyle(
                                color: AppColors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                FilterChips(
                  chips: [
                    ChipSpec('all', '全部',
                        count: store.certs.length, selected: _level == null),
                    for (final lv in kCertificateLevels)
                      ChipSpec(
                        lv,
                        lv,
                        count: store.certs.where((c) => c.level == lv).length,
                        selected: _level == lv,
                      ),
                  ],
                  onSelected: (k) =>
                      setState(() => _level = k == 'all' ? null : k),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
          Expanded(
            child: certs.isEmpty
                ? const EmptyView(
                    icon: '🏅',
                    title: '还没有证书记录',
                    subtitle: '没有扫描件也可以先登记，之后再补原件',
                  )
                : LayoutBuilder(builder: (context, box) {
                    // 宽屏双列卡片流，窄屏单列
                    if (box.maxWidth >= 640) {
                      return TwoColumnFlow(children: [
                        for (final c in certs) _certCard(context, store, c),
                      ]);
                    }
                    return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 90),
                      itemCount: certs.length,
                      itemBuilder: (_, i) =>
                          _certCard(context, store, certs[i]),
                    );
                  }),
          ),
        ],
        ),
      ),
    );
  }

  List<Cert> _filtered(AppStore store) {
    var list = store.certs;
    if (_level != null) list = list.where((c) => c.level == _level).toList();
    if (_query.isNotEmpty) {
      list = list
          .where((c) =>
              c.name.contains(_query) ||
              c.org.contains(_query) ||
              (c.note ?? '').contains(_query))
          .toList();
    }
    return list;
  }

  Widget _certCard(BuildContext context, AppStore store, Cert c) {
    final doc = store.docOfCert(c);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: IndexCard(
        edge: AppColors.gold,
        onTap: () => _editSheet(context, store, c),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('🏆', style: TextStyle(fontSize: 18)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    c.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14.5, fontWeight: FontWeight.w700, height: 1.3),
                  ),
                ),
                StampTag(doc != null ? '已盖章' : '待盖章', solid: doc != null),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                LevelPill(c.level),
                _meta(c.org),
                _meta(fmtMonth(c.awardedAt)),
                if ((c.note ?? '').isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.paperDark.withOpacity(0.55),
                      borderRadius: BorderRadius.circular(3),
                    ),
                    child: Text(
                      c.note!,
                      style: const TextStyle(
                          fontSize: 10.5,
                          color: AppColors.inkSoft,
                          fontFeatures: [FontFeature.tabularFigures()]),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (doc != null)
                  GestureDetector(
                    onTap: () => openDoc(context, store, doc),
                    child: Row(
                      children: [
                        Icon(Icons.attach_file,
                            size: 13, color: AppColors.gold),
                        const SizedBox(width: 3),
                        Text(
                          '查看原件',
                          style: TextStyle(
                              fontSize: 11.5,
                              color: AppColors.gold,
                              fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  )
                else
                  const Text(
                    '未关联原件 · 可稍后上传补齐',
                    style: TextStyle(fontSize: 11, color: AppColors.inkFaint),
                  ),
                const Spacer(),
                GestureDetector(
                  onTap: () => _editSheet(context, store, c),
                  child: const Text('编辑',
                      style: TextStyle(
                          fontSize: 11.5,
                          color: AppColors.inkSoft,
                          fontWeight: FontWeight.w600)),
                ),
                const SizedBox(width: 12),
                GestureDetector(
                  onTap: () async {
                    final ok = await showConfirm(context,
                        title: '删除这条证书记录？',
                        message: '仅删除总目记录，已上传的原件不受影响。',
                        confirmText: '删除',
                        danger: true);
                    if (ok) store.deleteCert(c.id);
                  },
                  child: const Text('删除',
                      style:
                          TextStyle(fontSize: 11.5, color: AppColors.seal)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _meta(String text) => Text(
        text,
        style: const TextStyle(
            fontSize: 11,
            color: AppColors.inkSoft,
            fontFeatures: [FontFeature.tabularFigures()]),
      );

  Future<void> _editSheet(BuildContext context, AppStore store, Cert? cert) {
    final name = TextEditingController(text: cert?.name ?? '');
    final org = TextEditingController(text: cert?.org ?? '');
    final note = TextEditingController(text: cert?.note ?? '');
    var level = cert?.level ?? '校级';
    var awardedAt = cert?.awardedAt ?? DateTime.now().millisecondsSinceEpoch;
    String? documentId = cert?.documentId;

    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 18,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(cert == null ? '登记证书' : '编辑证书',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                TextField(
                    controller: name,
                    decoration: const InputDecoration(hintText: '证书名称 *')),
                const SizedBox(height: 10),
                TextField(
                    controller: org,
                    decoration: const InputDecoration(hintText: '颁发单位 *')),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final lv in kCertificateLevels)
                      GestureDetector(
                        onTap: () => setSheet(() => level = lv),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: level == lv ? AppColors.gold : AppColors.white,
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: level == lv
                                    ? AppColors.gold
                                    : AppColors.line),
                          ),
                          child: Text(lv,
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: level == lv
                                      ? AppColors.white
                                      : AppColors.inkSoft)),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    TextButton(
                      onPressed: () async {
                        final d = await showDatePicker(
                          context: ctx,
                          initialDate:
                              DateTime.fromMillisecondsSinceEpoch(awardedAt),
                          firstDate: DateTime(2015),
                          lastDate: DateTime.now()
                              .add(const Duration(days: 1)),
                          locale: const Locale('zh', 'CN'),
                        );
                        if (d != null) {
                          setSheet(() =>
                              awardedAt = d.millisecondsSinceEpoch);
                        }
                      },
                      child: Text(
                        '获得时间：${fmtDateCn(awardedAt)}',
                        style: const TextStyle(
                            color: AppColors.ink,
                            fontSize: 13,
                            fontFeatures: [FontFeature.tabularFigures()]),
                      ),
                    ),
                  ],
                ),
                TextField(
                    controller: note,
                    decoration:
                        const InputDecoration(hintText: '备注（如 580 分）')),
                // 关联原件
                if (cert == null &&
                    store.docsOfMain('certificate').isNotEmpty) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    value: documentId,
                    decoration: const InputDecoration(hintText: '关联已归档的原件（选填）'),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('暂不关联')),
                      ...store.docsOfMain('certificate').map((d) =>
                          DropdownMenuItem(
                              value: d.id, child: Text(d.title, overflow: TextOverflow.ellipsis))),
                    ],
                    onChanged: (v) => setSheet(() => documentId = v),
                  ),
                ],
                const SizedBox(height: 16),
                PrimaryButton(
                  cert == null ? '登记' : '保存',
                  onPressed: () async {
                    if (name.text.trim().isEmpty ||
                        org.text.trim().isEmpty) {
                      ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                          content: Text('名称与颁发单位必填')));
                      return;
                    }
                    final data = Cert(
                      id: cert?.id ?? '',
                      name: name.text.trim(),
                      org: org.text.trim(),
                      level: level,
                      awardedAt: awardedAt,
                      note: note.text.trim().isEmpty ? null : note.text.trim(),
                      documentId: documentId,
                    );
                    if (cert == null) {
                      await store.addCert(data);
                    } else {
                      await store.updateCert(data);
                    }
                    if (ctx.mounted) Navigator.pop(ctx);
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

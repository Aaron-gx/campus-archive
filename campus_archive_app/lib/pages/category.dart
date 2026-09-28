import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/doc_sheets.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'archive_all.dart' show openDoc;
import 'certificates.dart';
import 'scan.dart';

/// 分类详情页：五大分类通用模板
class CategoryPage extends StatefulWidget {
  final String mainKey;
  const CategoryPage({super.key, required this.mainKey});

  @override
  State<CategoryPage> createState() => _CategoryPageState();
}

class _CategoryPageState extends State<CategoryPage> {
  String _query = '';
  String? _filterLeaf;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final main = kCategoryTree.firstWhere((m) => m.key == widget.mainKey);
    final docs = _filtered(store, main);
    final groups = groupDocs(docs);
    final no = main.order.toString().padLeft(2, '0');
    final totalCount = store.countOfMain(main.key);

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        title: Text(main.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.workspace_premium_outlined, size: 20),
            tooltip: '证书总目',
            onPressed: () =>
                pushFadeSlide(context, const CertificatesPage()),
          ),
        ],
      ),
      body: ResponsiveCenter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$no · ${main.en} · $totalCount 项',
                    style: const TextStyle(
                      fontSize: 11.5,
                      letterSpacing: 2,
                      color: AppColors.inkSoft,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SearchBox(
                    hint: '搜索标题 / 备注 / 文件名',
                    onChanged: (v) => setState(() => _query = v.trim()),
                  ),
                  const SizedBox(height: 12),
                  FilterChips(
                    chips: [
                      ChipSpec('all', '全部',
                          count: totalCount, selected: _filterLeaf == null),
                      for (final leaf in main.children)
                        ChipSpec(
                          leaf.key,
                          leaf.name,
                          count: store.countOfLeaf(leaf.key),
                          selected: _filterLeaf == leaf.key,
                        ),
                    ],
                    onSelected: (k) =>
                        setState(() => _filterLeaf = k == 'all' ? null : k),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
            Expanded(
              child: groups.isEmpty
                  ? EmptyView(
                      icon: main.icon,
                      title: _query.isEmpty ? '暂无材料' : '无匹配材料',
                    )
                  : LayoutBuilder(builder: (context, box) {
                      if (box.maxWidth >= 640) {
                        return TwoColumnFlow(children: [
                          for (final g in groups)
                            _groupCard(context, store, g, main),
                          _addRow(context, main),
                        ]);
                      }
                      return ListView.builder(
                        padding: const EdgeInsets.fromLTRB(20, 4, 20, 90),
                        itemCount: groups.length + 1,
                        itemBuilder: (_, i) {
                          if (i == groups.length) return _addRow(context, main);
                          return _groupCard(context, store, groups[i], main);
                        },
                      );
                    }),
            ),
          ],
        ),
      ),
    );
  }

  List<Doc> _filtered(AppStore store, CategoryNode main) {
    var list = store.docsOfMain(main.key);
    if (_filterLeaf != null) {
      list = list.where((d) => d.categoryKey == _filterLeaf).toList();
    }
    if (_query.isNotEmpty) {
      list = list
          .where((d) =>
              d.title.contains(_query) ||
              (d.note ?? '').contains(_query) ||
              d.fileName.contains(_query))
          .toList();
    }
    return list;
  }

  Widget _groupCard(
      BuildContext context, AppStore store, DocGroup g, CategoryNode main) {
    final d = g.main;
    final leaf = findCategory(d.categoryKey);
    final cert = store.certOfDoc(d);
    final totalSize = g.docs.fold(0, (sum, doc) => sum + doc.size);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: IndexCard(
        edge: main.accent,
        onTap: () => openDoc(context, store, d),
        onLongPress: () => _actions(context, store, d),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                DocThumb(doc: d, store: store, size: 64),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        g.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 15, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${d.fileName} · ${fmtSize(totalSize)} · ${fmtDate(d.createdAt)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: AppColors.inkFaint,
                          fontFeatures: [FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          _tag(leaf?.name ?? '', main.accent),
                          if (cert != null) ...[
                            LevelPill(cert.level),
                            _tag(cert.org, AppColors.inkSoft),
                          ],
                          if (d.isSensitive)
                            _tag('🔒 已加密', AppColors.ink),
                          if (!g.hasMultiple && d.side != null)
                            _tag(d.side!, AppColors.gold),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.more_vert,
                      size: 18, color: AppColors.inkFaint),
                  onPressed: () => _actions(context, store, d),
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
                      child: GestureDetector(
                        onTap: () => openDoc(context, store, sideDoc),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppColors.ink.withOpacity(0.06),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(color: AppColors.line),
                          ),
                          child: Text(
                            sideDoc.side ?? '第${g.docs.indexOf(sideDoc) + 1}面',
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
            if ((d.note ?? '').isNotEmpty) ...[
              const SizedBox(height: 6),
              if (!g.hasMultiple) const DashedLine(),
              const SizedBox(height: 6),
              Text(
                '📝 ${d.note}',
                style:
                    const TextStyle(fontSize: 12, color: AppColors.inkSoft),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _tag(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.paperDark.withOpacity(0.5),
          borderRadius: BorderRadius.circular(3),
        ),
        child: Text(
          text,
          style: TextStyle(fontSize: 10.5, color: color, letterSpacing: 0.5),
        ),
      );

  Widget _addRow(BuildContext context, CategoryNode main) {
    return GestureDetector(
      onTap: () => pushFadeSlide(
          context, ScanPage(preselectMain: main.key)),
      child: DashedBox(
        child: Container(
          height: 54,
          alignment: Alignment.center,
          child: Text(
            '＋ 添加材料',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              letterSpacing: 1,
              color: main.accent,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _actions(BuildContext context, AppStore store, Doc d) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      constraints: const BoxConstraints(maxWidth: 400),
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
                leading: const Icon(Icons.visibility_outlined),
                title: const Text('查看原件'),
                onTap: () => Navigator.pop(context, 'view')),
            ListTile(
                leading: const Icon(Icons.edit_outlined),
                title: const Text('编辑信息'),
                onTap: () => Navigator.pop(context, 'edit')),
            ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.seal),
                title:
                    const Text('删除', style: TextStyle(color: AppColors.seal)),
                onTap: () => Navigator.pop(context, 'delete')),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'view':
        if (context.mounted) await openDoc(context, store, d);
        break;
      case 'edit':
        if (context.mounted) await showEditDocSheet(context, store, d);
        break;
      case 'delete':
        final ok = await showConfirm(
          context,
          title: '删除这份材料？',
          message: '「${d.title}」的文件与记录将被删除。',
          confirmText: '删除',
          danger: true,
        );
        if (ok) await store.deleteDoc(d);
        break;
    }
  }
}

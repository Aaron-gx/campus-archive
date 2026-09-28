import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/exporter.dart';
import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/doc_sheets.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'category.dart';
import 'secure.dart';

/// 我的档案 · 全分类总目录：跨分类搜索 + 筛选 + 勾选批量导出
class ArchiveAllPage extends StatefulWidget {
  const ArchiveAllPage({super.key});

  @override
  State<ArchiveAllPage> createState() => _ArchiveAllPageState();
}

class _ArchiveAllPageState extends State<ArchiveAllPage> {
  String _query = '';
  String? _filterMain;
  final Set<String> _selected = {};
  bool _selectMode = false;
  Doc? _preview; // 宽屏两栏时右侧详情选中的文档
  bool _twoPane = false;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final docs = _filtered(store);
    final allCount = store.docs.length;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        bottom: false,
        child: LayoutBuilder(builder: (context, box) {
          // 宽屏（含侧边导航后的内容区）启用两栏：左列表 + 右详情
          _twoPane = box.maxWidth >= 760;
          if (_twoPane) {
            // 选中项被删除后回落；进页面自动预选第一条
            if (_preview != null && !docs.any((d) => d.id == _preview!.id)) {
              _preview = null;
            }
            _preview ??= docs.isEmpty ? null : docs.first;
          } else {
            _preview = null;
          }

          final header = Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '我的档案',
                    style: TextStyle(
                        fontSize: 24, fontWeight: FontWeight.w900, letterSpacing: 2),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '全部分类 · 共 $allCount 项',
                    style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.inkSoft,
                        letterSpacing: 1),
                  ),
                  const SizedBox(height: 14),
                  SearchBox(
                    hint: '搜索全部档案（证书 / 证明 / 照片…）',
                    onChanged: (v) => setState(() => _query = v.trim()),
                  ),
                  const SizedBox(height: 12),
                  FilterChips(
                    chips: [
                      ChipSpec('all', '全部', count: allCount, selected: _filterMain == null),
                      for (final m in kCategoryTree)
                        ChipSpec(
                          m.key,
                          m.name,
                          count: store.countOfMain(m.key),
                          selected: _filterMain == m.key,
                        ),
                    ],
                    onSelected: (k) => setState(() {
                      _filterMain = k == 'all' ? null : k;
                      _selected.clear();
                    }),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      GestureDetector(
                        onTap: () => setState(() {
                          _selectMode = !_selectMode;
                          if (!_selectMode) _selected.clear();
                        }),
                        child: Row(
                          children: [
                            Icon(
                              _selectMode
                                  ? Icons.check_box_outlined
                                  : Icons.check_box_outline_blank,
                              size: 18,
                              color: _selectMode
                                  ? AppColors.ink
                                  : AppColors.inkFaint,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _selectMode
                                  ? '已选 ${_selected.length} 项'
                                  : '全选',
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: _selectMode
                                    ? AppColors.ink
                                    : AppColors.inkSoft,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      if (_selectMode && _selected.isNotEmpty)
                        TextButton.icon(
                          onPressed: _selected.isEmpty ? null : () => _batchShare(store),
                          icon: const Icon(Icons.ios_share,
                              size: 16, color: AppColors.ink),
                          label: Text(
                            '批量导出 ${_selected.length} 项',
                            style: const TextStyle(
                                color: AppColors.ink,
                                fontWeight: FontWeight.w700,
                                fontSize: 12.5),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                ],
              ),
            );

            final listArea = Expanded(
              child: docs.isEmpty
                  ? EmptyView(
                      icon: '🗃',
                      title: _query.isEmpty ? '暂无材料' : '无匹配材料',
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 110),
                      itemCount: docs.length,
                      itemBuilder: (_, i) =>
                          _docRow(context, store, docs[i]),
                    ),
            );

            if (!_twoPane) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [header, listArea],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(width: 380, child: Column(children: [header, listArea])),
                const VerticalDivider(width: 1),
                Expanded(
                  child: _DocDetailPane(store: store, doc: _preview),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  List<Doc> _filtered(AppStore store) {
    var list = store.docs;
    if (_filterMain != null) {
      list = list.where((d) => d.mainKey == _filterMain).toList();
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

  Widget _docRow(BuildContext context, AppStore store, Doc d) {
    final main = mainCategoryOf(d.categoryKey);
    final leaf = findCategory(d.categoryKey);
    final selected = _selected.contains(d.id);
    final cert = store.certOfDoc(d);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: IndexCard(
        edge: d.isSensitive ? AppColors.ink : AppColors.seal,
        onTap: () => _open(context, store, d),
        onLongPress: () => _showActions(context, store, d),
        child: Row(
          children: [
            if (_selectMode)
              Padding(
                padding: const EdgeInsets.only(right: 10),
                child: Icon(
                  selected
                      ? Icons.check_box
                      : Icons.check_box_outline_blank,
                  size: 20,
                  color: selected ? AppColors.ink : AppColors.inkFaint,
                ),
              ),
            if (_selectMode && d.isSensitive && !store.sensitiveVerified)
              const SizedBox(width: 52, height: 52, child: Icon(Icons.lock, color: AppColors.inkFaint))
            else
              GestureDetector(
                onTap: () => _open(context, store, d),
                child: DocThumb(doc: d, store: store, size: 52),
              ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    d.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      _miniTag(main.name, main.accent),
                      if (leaf != null && leaf.name != main.name)
                        _miniTag(leaf.name, AppColors.inkSoft),
                      _miniTag(fmtDate(d.createdAt), AppColors.inkFaint),
                      if (d.side != null) _miniTag(d.side!, AppColors.gold),
                      if (cert != null) LevelPill(cert.level),
                    ],
                  ),
                ],
              ),
            ),
            if (!_selectMode)
              IconButton(
                icon: const Icon(Icons.more_vert,
                    size: 18, color: AppColors.inkFaint),
                onPressed: () => _showActions(context, store, d),
              ),
          ],
        ),
      ),
    );
  }

  Widget _miniTag(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
        decoration: BoxDecoration(
          color: AppColors.paperDark.withOpacity(0.55),
          borderRadius: BorderRadius.circular(3),
        ),
        child: Text(
          text,
          style: TextStyle(fontSize: 10.5, color: color, letterSpacing: 0.5),
        ),
      );

  Future<void> _open(BuildContext context, AppStore store, Doc d) async {
    if (_selectMode) {
      setState(() {
        _selected.contains(d.id) ? _selected.remove(d.id) : _selected.add(d.id);
      });
      return;
    }
    // 宽屏两栏：点选即在右侧详情展示，不跳页
    if (_twoPane) {
      setState(() => _preview = d);
      return;
    }
    if (d.mainKey == 'identity') {
      pushFadeSlide(context, const SecurePage());
      return;
    }
    await openDoc(context, store, d);
  }

  Future<void> _showActions(BuildContext context, AppStore store, Doc d) async {
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
                leading: const Icon(Icons.folder_open),
                title: const Text('前往分类'),
                onTap: () => Navigator.pop(context, 'goto')),
            ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.seal),
                title: const Text('删除',
                    style: TextStyle(color: AppColors.seal)),
                onTap: () => Navigator.pop(context, 'delete')),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'view':
        await openDoc(context, store, d);
        break;
      case 'edit':
        if (context.mounted) {
          await showEditDocSheet(context, store, d);
          if (mounted) setState(() {});
        }
        break;
      case 'goto':
        if (!mounted) return;
        if (d.mainKey == 'identity') {
          pushFadeSlide(context, const SecurePage());
        } else {
          pushFadeSlide(context, CategoryPage(mainKey: d.mainKey));
        }
        break;
      case 'delete':
        final ok = await showConfirm(
          context,
          title: '删除这份材料？',
          message: '「${d.title}」的文件与记录将被删除，关联的证书记录会保留。',
          confirmText: '删除',
          danger: true,
        );
        if (ok) await store.deleteDoc(d);
        break;
    }
  }

  Future<void> _batchShare(AppStore store) async {
    // 勾选的文档直接打包分享
    final export = ExportService(store);
    await export.exportSelected(_selected.toList());
    if (mounted) setState(() => _selected.clear());
  }
}

/// 打开文档（含敏感验证 + 调档记录）
Future<void> openDoc(BuildContext context, AppStore store, Doc d) async {
  if (d.isSensitive && !store.sensitiveVerified) {
    final ok = await showVerifySheet(context, store);
    if (!ok) return;
  }
  try {
    final path = await store.viewablePath(d);
    if (d.isSensitive) await store.logAccess('view', d);
    await OpenFilex.open(path);
  } on ApiException catch (e) {
    // 账号模式：服务端要求二次验证（本地验证通过但服务端窗口未开）
    if (e.needSensitiveVerify && context.mounted) {
      final ok = await showVerifySheet(context, store);
      if (ok) await openDoc(context, store, d);
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

/// 宽屏右侧详情面板：大图预览 + 元信息 + 操作
class _DocDetailPane extends StatelessWidget {
  final AppStore store;
  final Doc? doc;

  const _DocDetailPane({required this.store, required this.doc});

  @override
  Widget build(BuildContext context) {
    final d = doc;
    if (d == null) {
      return EmptyView(
        icon: '📄',
        title: '选择一份材料',
        subtitle: '点左侧列表，在这里查看详情与操作',
      );
    }
    final main = mainCategoryOf(d.categoryKey);
    final leaf = findCategory(d.categoryKey);
    final cert = store.certOfDoc(d);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _previewArea(context, d),
          const SizedBox(height: 18),
          Text(
            d.title,
            style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            '${d.fileName} · ${fmtSize(d.size)} · ${fmtDateTime(d.createdAt)}',
            style: const TextStyle(
              fontSize: 11.5,
              color: AppColors.inkFaint,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              _tag(main.name, main.accent),
              if (leaf != null && leaf.name != main.name)
                _tag(leaf.name, AppColors.inkSoft),
              if (cert != null) LevelPill(cert.level),
              if (cert != null) _tag(cert.org, AppColors.inkSoft),
              if (d.isSensitive)
                _tag('🔒 已加密 · 验证后可见', AppColors.ink),
            ],
          ),
          if ((d.note ?? '').isNotEmpty) ...[
            const SizedBox(height: 12),
            const DashedLine(),
            const SizedBox(height: 10),
            Text(
              '📝 ${d.note}',
              style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft, height: 1.6),
            ),
          ],
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(
                child: PrimaryButton(
                  '查看原件',
                  icon: Icons.visibility_outlined,
                  onPressed: () => openDoc(context, store, d),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PrimaryButton(
                  '编辑信息',
                  outline: true,
                  icon: Icons.edit_outlined,
                  onPressed: () => showEditDocSheet(context, store, d),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: () async {
                final ok = await showConfirm(
                  context,
                  title: '删除这份材料？',
                  message: '「${d.title}」的文件与记录将被删除，关联的证书记录会保留。',
                  confirmText: '删除',
                  danger: true,
                );
                if (ok) await store.deleteDoc(d);
              },
              child: const Text(
                '删除这份材料',
                style: TextStyle(fontSize: 12.5, color: AppColors.seal),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _previewArea(BuildContext context, Doc d) {
    if (d.isSensitive && !store.sensitiveVerified) {
      return DashedBox(
        child: Container(
          height: 300,
          alignment: Alignment.center,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock, size: 40, color: AppColors.seal),
              const SizedBox(height: 10),
              const Text('材料已加密保护',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
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
      );
    }
    if (d.isPdf) {
      return Container(
        height: 300,
        decoration: BoxDecoration(
          color: AppColors.sealSoft.withOpacity(0.5),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.line),
        ),
        alignment: Alignment.center,
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.picture_as_pdf, size: 52, color: AppColors.seal),
            SizedBox(height: 10),
            Text('PDF',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
          ],
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 320,
        width: double.infinity,
        color: AppColors.paperDark,
        child: FutureBuilder<String>(
          future: store.viewablePath(d),
          builder: (ctx, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(
                child: SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
              );
            }
            if (!snap.hasData) {
              return const Icon(Icons.broken_image_outlined,
                  size: 40, color: AppColors.inkFaint);
            }
            return Image.file(
              File(snap.data!),
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined,
                  size: 40, color: AppColors.inkFaint),
            );
          },
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
}

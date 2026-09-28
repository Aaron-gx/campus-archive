import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/exporter.dart';
import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/widgets.dart';

/// 一键导出：场景模板 + 自定义勾选 + 双格式（ZIP / 合并 PDF）+ 历史记录
class ExportPage extends StatefulWidget {
  const ExportPage({super.key});

  @override
  State<ExportPage> createState() => _ExportPageState();
}

class _ExportPageState extends State<ExportPage> {
  final Set<String> _selected = {'certificate', 'experience'};
  int _format = 1; // 1 = ZIP 原图包, 2 = 合并 PDF
  bool _busy = false;

  static const _templates = <String, List<String>>{
    '简历附件包': ['certificate', 'portfolio', 'experience'],
    '评优评奖材料': ['certificate', 'experience', 'identity'],
    '实习入职材料': ['identity', 'experience', 'certificate'],
  };

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        bottom: false,
        child: ResponsiveCenter(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 110),
          children: [
            const Text(
              '一键导出',
              style: TextStyle(
                  fontSize: 24, fontWeight: FontWeight.w900, letterSpacing: 2),
            ),
            const SizedBox(height: 16),

            const SectionLabel('场景模板'),
            for (final e in _templates.entries)
              _templateCard(context, store, e.key, e.value),
            const SizedBox(height: 20),

            SectionLabel('自定义导出内容',
                trailing: Text(
                  '已选 ${_selected.length} 项',
                  style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.inkFaint,
                      fontFeatures: [FontFeature.tabularFigures()]),
                )),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.line),
              ),
              child: Column(
                children: [
                  for (final m in kCategoryTree)
                    CheckboxListTile(
                      value: _selected.contains(m.key),
                      onChanged: (v) => setState(() {
                        v == true ? _selected.add(m.key) : _selected.remove(m.key);
                      }),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      activeColor: AppColors.ink,
                      title: Text(
                        '${m.icon} ${m.name}',
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        _subCopy(m),
                        style: const TextStyle(
                            fontSize: 11.5, color: AppColors.inkSoft),
                      ),
                      secondary: Text(
                        '${store.countOfMain(m.key)} 项',
                        style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.inkFaint,
                            fontFeatures: [FontFeature.tabularFigures()]),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            const SectionLabel('导出格式'),
            Row(
              children: [
                Expanded(
                  child: _formatCard(
                    icon: Icons.picture_as_pdf,
                    iconColor: AppColors.seal,
                    title: '合并为 PDF',
                    subtitle: '便于直接阅读打印',
                    selected: _format == 2,
                    onTap: () => setState(() => _format = 2),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _formatCard(
                    icon: Icons.folder_zip_outlined,
                    iconColor: AppColors.gold,
                    title: '原图 ZIP 压缩包',
                    subtitle: '保留高清原始文件',
                    selected: _format == 1,
                    onTap: () => setState(() => _format = 1),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            Row(
              children: [
                Expanded(
                  child: PrimaryButton(
                    '预览',
                    outline: true,
                    onPressed: _preview,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: PrimaryButton(
                    _busy ? '导出中…' : '开始导出',
                    onPressed:
                        _busy || _selected.isEmpty ? null : _export,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 28),

            const SectionLabel('历史记录'),
            if (store.exportRecords.isEmpty)
              const Text('暂无记录',
                  style: TextStyle(fontSize: 12, color: AppColors.inkFaint))
            else
              ...store.exportRecords.take(5).map((r) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: IndexCard(
                      edge: AppColors.gold,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      child: Row(
                        children: [
                          const Icon(Icons.inventory_2_outlined,
                              size: 18, color: AppColors.gold),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(r.fileName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700)),
                                Text(
                                  '${r.verifyCode != null ? '${r.verifyCode} · ' : ''}${_keysToNames(r.categoryKeys)} · ${fmtSize(r.size)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 10.5,
                                      color: AppColors.inkFaint),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            fmtMonth(r.createdAt),
                            style: const TextStyle(
                                fontSize: 11,
                                color: AppColors.inkSoft,
                                fontFeatures: [FontFeature.tabularFigures()]),
                          ),
                        ],
                      ),
                    ),
                  )),
          ],
        ),
        ),
      ),
    );
  }

  String _subCopy(CategoryNode m) {
    const copies = {
      'identity': '身份证、学生证等（自动解密）',
      'certificate': '获奖、资格、等级证书',
      'experience': '实习、志愿、社会实践证明',
      'photo': '活动、典礼现场照片',
      'portfolio': '设计、代码、写作作品',
    };
    return copies[m.key] ?? '';
  }

  String _keysToNames(String keys) {
    if (keys == 'selected') return '挑选材料';
    // PDF 导出历史带 "|pdf" 后缀；旧版本记录还可能是 "[a, b]" 形式，都做兼容
    final isPdf = keys.endsWith('|pdf');
    final body = isPdf ? keys.substring(0, keys.length - 4) : keys;
    final names = body
        .split(',')
        .map((k) => k.replaceAll(RegExp(r'[\[\]]'), '').trim())
        .map((k) => findCategory(k)?.name)
        .whereType<String>()
        .toList();
    if (names.isEmpty) return isPdf ? '合并 PDF' : '';
    return '${names.join(' + ')}${isPdf ? '（合并 PDF）' : ''}';
  }

  Widget _templateCard(
      BuildContext context, AppStore store, String name, List<String> keys) {
    final selected =
        keys.length == _selected.length && _selected.containsAll(keys);
    final icons = {
      '简历附件包': Icons.work_outline,
      '评优评奖材料': Icons.military_tech_outlined,
      '实习入职材料': Icons.badge_outlined,
    };
    return GestureDetector(
      onTap: () => setState(() {
        _selected
          ..clear()
          ..addAll(keys);
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? AppColors.card : AppColors.card.withOpacity(0.6),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? AppColors.ink : AppColors.line,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icons[name], size: 22, color: AppColors.ink),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name,
                      style: const TextStyle(
                          fontSize: 14.5, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(
                    '${keys.map((k) => findCategory(k)!.name).join('、')}；共 ${_templateCount(store, keys)} 份材料',
                    style: const TextStyle(
                        fontSize: 11.5, color: AppColors.inkSoft, height: 1.4),
                  ),
                ],
              ),
            ),
            if (selected)
              const Icon(Icons.check_circle, size: 20, color: AppColors.ink),
          ],
        ),
      ),
    );
  }

  int _templateCount(AppStore store, List<String> keys) =>
      keys.fold(0, (sum, k) => sum + store.countOfMain(k));

  Widget _formatCard({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? AppColors.card : AppColors.card.withOpacity(0.6),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? AppColors.ink : AppColors.line,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 22, color: iconColor),
            const SizedBox(height: 8),
            Text(title,
                style: const TextStyle(
                    fontSize: 13.5, fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text(subtitle,
                style:
                    const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
          ],
        ),
      ),
    );
  }

  Future<void> _preview() async {
    final store = storeOf(context);
    final lines = <String>[];
    var total = 0;
    for (final k in kCategoryTree) {
      if (!_selected.contains(k.key)) continue;
      final n = store.countOfMain(k.key);
      total += n;
      lines.add('${k.icon} ${k.name}：$n 份');
    }
    final empty = total == 0;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('导出预览', style: TextStyle(fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ...lines.map((l) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Text(l,
                      style: const TextStyle(fontSize: 13.5, height: 1.4)),
                )),
            const SizedBox(height: 8),
            Text(
              empty ? '所选分类暂无文件' : '格式：${_format == 1 ? 'ZIP 原图包 + 材料清单.csv' : '合并 PDF'}',
              style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('知道了',
                  style: TextStyle(color: AppColors.ink))),
        ],
      ),
    );
  }

  Future<void> _export() async {
    final store = storeOf(context);
    // 敏感材料需要先通过二次验证
    final exporter = ExportService(store);
    if (exporter.containsSensitive(_selected.toList()) &&
        !store.sensitiveVerified) {
      final ok = await showVerifySheet(context, store);
      if (!ok) return;
    }
    setState(() => _busy = true);
    try {
      final String path;
      if (_format == 1) {
        path = await exporter.buildZip(_selected.toList());
      } else {
        path = await exporter.buildPdf(_selected.toList());
      }
      if (!mounted) return;
      setState(() => _busy = false);
      await exporter.share(path);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (e.needSensitiveVerify) {
        final ok = await showVerifySheet(context, store);
        if (ok) await _export();
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('导出失败：${e.message}')));
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('导出失败：$e')));
      }
    }
  }
}

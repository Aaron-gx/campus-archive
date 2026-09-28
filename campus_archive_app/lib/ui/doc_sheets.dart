import 'package:flutter/material.dart';

import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import 'widgets.dart';

/// 编辑文档信息：标题 / 备注 / 子分类
Future<void> showEditDocSheet(BuildContext context, AppStore store, Doc doc) {
  final title = TextEditingController(text: doc.title);
  final note = TextEditingController(text: doc.note ?? '');
  var leafKey = doc.categoryKey;

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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('编辑材料信息',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            TextField(
              controller: title,
              decoration: const InputDecoration(hintText: '标题'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: note,
              maxLines: 2,
              decoration: const InputDecoration(hintText: '备注（选填）'),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: _LeafPicker(
                current: leafKey,
                onChanged: (k) => setSheet(() => leafKey = k),
              ),
            ),
            const SizedBox(height: 16),
            PrimaryButton(
              '保存',
              onPressed: () async {
                await store.updateDoc(doc.copyWith(
                  title: title.text.trim().isEmpty ? doc.title : title.text.trim(),
                  note: note.text.trim().isEmpty ? null : note.text.trim(),
                  categoryKey: leafKey,
                  updatedAt: DateTime.now().millisecondsSinceEpoch,
                ));
                if (ctx.mounted) Navigator.pop(ctx);
              },
            ),
          ],
        ),
      ),
    ),
  );
}

/// 子分类选择 chips（按主分类分组，必须选叶子子类）
class _LeafPicker extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;

  const _LeafPicker({required this.current, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final m in kCategoryTree) ...[
          for (final leaf in m.children)
            GestureDetector(
              onTap: () => onChanged(leaf.key),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: leaf.key == current
                      ? m.accent
                      : AppColors.paper.withOpacity(0.7),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: leaf.key == current ? m.accent : AppColors.line,
                  ),
                ),
                child: Text(
                  '${m.icon}${leaf.name}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: leaf.key == current ? AppColors.white : AppColors.inkSoft,
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

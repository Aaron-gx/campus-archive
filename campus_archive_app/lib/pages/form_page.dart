import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../data/format.dart';
import '../data/models.dart';
import '../data/repo.dart';
import '../theme.dart';
import '../ui/widgets.dart';

class ArchiveFormPage extends StatefulWidget {
  final String sourcePath;
  final String originalName;
  final String suggestedTitle;
  final String? preselectMain;
  final String todayLabel;

  const ArchiveFormPage({
    super.key,
    required this.sourcePath,
    required this.originalName,
    required this.suggestedTitle,
    this.preselectMain,
    required this.todayLabel,
  });

  @override
  State<ArchiveFormPage> createState() => _ArchiveFormPageState();
}

class _ArchiveFormPageState extends State<ArchiveFormPage> {
  late final TextEditingController _title;
  final _note = TextEditingController();
  late String _leafKey;
  late String _mainKey;
  bool _withCert = true;
  String _level = '校级';
  DateTime _awardedAt = DateTime.now();
  final _certName = TextEditingController();
  final _certOrg = TextEditingController();
  final _certNote = TextEditingController();
  bool _busy = false;

  // 槽位与正反面支持（遵守 Rule 3：标题严禁带正反面后缀，正反面归入 side 字段与 groupId 归组）
  String _slot1Side = '正面';
  String? _secondPath;
  String? _secondName;
  String _slot2Side = '反面';

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: stripSideSuffix(widget.suggestedTitle));
    final presetMain = widget.preselectMain ?? 'certificate';
    _mainKey = presetMain;
    _leafKey = kCategoryTree
        .firstWhere((m) => m.key == presetMain)
        .children
        .first
        .key;
    _certName.text = stripSideSuffix(widget.suggestedTitle);
  }

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    _certName.dispose();
    _certOrg.dispose();
    _certNote.dispose();
    super.dispose();
  }

  CategoryNode get _main =>
      kCategoryTree.firstWhere((m) => m.key == _mainKey);

  bool _isPdf(String path, String name) =>
      name.toLowerCase().endsWith('.pdf') || path.toLowerCase().endsWith('.pdf');

  Future<void> _pickSecond(ImageSource source) async {
    final picker = ImagePicker();
    final x = await picker.pickImage(
      source: source,
      maxWidth: 4000,
      imageQuality: 95,
    );
    if (x == null) return;
    setState(() {
      _secondPath = x.path;
      _secondName = x.name;
    });
  }

  void _showAddSecondSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera, color: AppColors.ink),
              title: const Text('拍摄'),
              onTap: () {
                Navigator.pop(ctx);
                _pickSecond(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: AppColors.ink),
              title: const Text('从相册选择'),
              onTap: () {
                Navigator.pop(ctx);
                _pickSecond(ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isCertMain = _mainKey == 'certificate';

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        title: const Text('归档信息'),
      ),
      body: ResponsiveCenter(
        maxWidth: 720,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
          children: [
            // 材料槽位
            _slotCard(
              title: '材料',
              path: widget.sourcePath,
              name: widget.originalName,
              side: _slot1Side,
              onSideChanged: (s) => setState(() => _slot1Side = s),
            ),
            const SizedBox(height: 10),

            if (_secondPath != null) ...[
              _slotCard(
                title: '第二面',
                path: _secondPath!,
                name: _secondName ?? '材料',
                side: _slot2Side,
                onSideChanged: (s) => setState(() => _slot2Side = s),
                onDelete: () => setState(() {
                  _secondPath = null;
                  _secondName = null;
                }),
              ),
              const SizedBox(height: 14),
            ] else ...[
              OutlinedButton.icon(
                icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
                label: const Text('添加反面 / 副页'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.ink,
                  side: const BorderSide(color: AppColors.line),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(vertical: 11),
                ),
                onPressed: _showAddSecondSheet,
              ),
              const SizedBox(height: 16),
            ],

            const Text('标题', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            TextField(
              controller: _title,
              decoration: const InputDecoration(
                hintText: '纯证件类型名称，如：居民身份证',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 16),

            const Text('分类', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            _categoryPicker(),

            const SizedBox(height: 16),
            const Text('备注', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            TextField(
              controller: _note,
              maxLines: 2,
              decoration: const InputDecoration(hintText: '选填'),
            ),

            if (isCertMain) ...[
              const SizedBox(height: 14),
              CheckboxListTile(
                value: _withCert,
                onChanged: (v) => setState(() => _withCert = v ?? false),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                dense: true,
                title: const Text('登记到证书总目',
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                activeColor: AppColors.ink,
              ),
              if (_withCert) ..._certFields(),
            ],

            const SizedBox(height: 24),
            PrimaryButton(
              _busy ? '归档中…' : '确认归档',
              accent: true,
              onPressed: _busy ? null : _archive,
            ),
          ],
        ),
      ),
    );
  }

  Widget _slotCard({
    required String title,
    required String path,
    required String name,
    required String side,
    required ValueChanged<String> onSideChanged,
    VoidCallback? onDelete,
  }) {
    final pdf = _isPdf(path, name);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          _thumb(path, pdf),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final s in const ['正面', '反面', '主页', '副页'])
                      GestureDetector(
                        onTap: () => onSideChanged(s),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: side == s ? AppColors.ink : AppColors.paperDark,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            s,
                            style: TextStyle(
                              fontSize: 11,
                              color: side == s ? AppColors.white : AppColors.inkSoft,
                              fontWeight: side == s
                                  ? FontWeight.w700
                                  : FontWeight.normal,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (onDelete != null)
            IconButton(
              icon: const Icon(Icons.close, size: 18, color: AppColors.inkSoft),
              onPressed: onDelete,
            ),
        ],
      ),
    );
  }

  Widget _thumb(String path, bool isPdf) {
    if (isPdf) {
      return Container(
        width: 60,
        height: 60,
        decoration: BoxDecoration(
          color: AppColors.sealSoft.withOpacity(0.5),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Icon(Icons.picture_as_pdf, size: 26, color: AppColors.seal),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.file(
        File(path),
        width: 60,
        height: 60,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(
          width: 60,
          height: 60,
          color: AppColors.paperDark,
          child: const Icon(Icons.image_outlined, color: AppColors.inkFaint),
        ),
      ),
    );
  }

  Widget _categoryPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final m in kCategoryTree)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(m.icon, style: const TextStyle(fontSize: 13)),
                    const SizedBox(width: 4),
                    Text(
                      m.name,
                      style: TextStyle(
                        fontSize: 11,
                        letterSpacing: 1,
                        color: m.key == _mainKey ? m.accent : AppColors.inkFaint,
                        fontWeight: m.key == _mainKey
                            ? FontWeight.w800
                            : FontWeight.w500,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final leaf in m.children)
                      GestureDetector(
                        onTap: () => setState(() {
                          _leafKey = leaf.key;
                          _mainKey = m.key;
                        }),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: _leafKey == leaf.key
                                ? m.accent
                                : AppColors.card,
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                              color: _leafKey == leaf.key
                                  ? m.accent
                                  : AppColors.line,
                            ),
                          ),
                          child: Text(
                            leaf.name,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: _leafKey == leaf.key
                                  ? AppColors.white
                                  : AppColors.inkSoft,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }

  List<Widget> _certFields() {
    return [
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.gold.withOpacity(0.6)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _certName,
              decoration: const InputDecoration(hintText: '证书名称 *'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _certOrg,
              decoration: const InputDecoration(hintText: '颁发单位 *'),
            ),
            const SizedBox(height: 12),
            const Text('级别', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final lv in kCertificateLevels)
                  GestureDetector(
                    onTap: () => setState(() => _level = lv),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: _level == lv ? AppColors.gold : AppColors.white,
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: _level == lv ? AppColors.gold : AppColors.line,
                        ),
                      ),
                      child: Text(
                        lv,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _level == lv ? AppColors.white : AppColors.inkSoft,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Text('获得时间',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                const SizedBox(width: 12),
                TextButton(
                  onPressed: _pickDate,
                  child: Text(
                    fmtDateCn(_awardedAt.millisecondsSinceEpoch),
                    style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 13,
                        fontFeatures: [FontFeature.tabularFigures()]),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            TextField(
              controller: _certNote,
              decoration: const InputDecoration(hintText: '备注'),
            ),
          ],
        ),
      ),
    ];
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _awardedAt,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      locale: const Locale('zh', 'CN'),
    );
    if (d != null) setState(() => _awardedAt = d);
  }

  Future<void> _archive() async {
    final store = storeOf(context);
    final rawTitle = _title.text.trim();
    final title = stripSideSuffix(rawTitle);
    if (title.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请填写标题')));
      return;
    }
    CertFields? cert;
    if (_withCert && _mainKey == 'certificate') {
      if (_certOrg.text.trim().isEmpty) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('登记证书需填写颁发单位')));
        return;
      }
      cert = CertFields(
        _certName.text.trim().isEmpty ? title : stripSideSuffix(_certName.text.trim()),
        _certOrg.text.trim(),
        _level,
        _awardedAt.millisecondsSinceEpoch,
        _certNote.text.trim().isEmpty ? null : _certNote.text.trim(),
      );
    }
    setState(() => _busy = true);
    try {
      final isId = _mainKey == 'identity';
      if (_secondPath != null) {
        final groupId = const Uuid().v4();
        await store.addDocument(
          sourcePath: widget.sourcePath,
          originalName: widget.originalName,
          leafCategoryKey: _leafKey,
          title: title,
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          groupId: groupId,
          side: _slot1Side,
          sideOrder: 0,
          certFields: cert,
        );
        await store.addDocument(
          sourcePath: _secondPath!,
          originalName: _secondName ?? '反面',
          leafCategoryKey: _leafKey,
          title: title,
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          groupId: groupId,
          side: _slot2Side,
          sideOrder: 1,
          certFields: null,
        );
      } else {
        await store.addDocument(
          sourcePath: widget.sourcePath,
          originalName: widget.originalName,
          leafCategoryKey: _leafKey,
          title: title,
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          groupId: null,
          side: isId ? _slot1Side : null,
          sideOrder: 0,
          certFields: cert,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已归档到「${_main.name}」')),
      );
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('归档失败：$e')));
      }
    }
  }
}

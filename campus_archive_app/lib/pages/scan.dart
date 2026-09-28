import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../data/format.dart';
import '../data/models.dart';
import '../theme.dart';
import '../ui/widgets.dart' show ResponsiveCenter;
import '../ui/transitions.dart';
import 'form_page.dart';

/// 扫描上传 · STEP 1/2：拍摄 / 相册 / 文件
class ScanPage extends StatelessWidget {
  final String? preselectMain;
  const ScanPage({super.key, this.preselectMain});

  Future<void> _pick(BuildContext context, ImageSource source) async {
    final picker = ImagePicker();
    final x = await picker.pickImage(
      source: source,
      maxWidth: 4000,
      imageQuality: 95,
    );
    if (x == null) return;
    _toForm(context, x.path, x.name);
  }

  Future<void> _pickFile(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
    );
    final path = result?.files.single.path;
    if (path == null) return;
    final name = result?.files.single.name ?? '文件';
    _toForm(context, path, name);
  }

  void _toForm(BuildContext context, String path, String name) {
    final file = File(path);
    if (file.lengthSync() > kMaxFileSize) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('文件超过 20MB，请压缩后再归档')),
      );
      return;
    }
    replaceFadeSlide(
      context,
      ArchiveFormPage(
        sourcePath: path,
        originalName: name,
        suggestedTitle: titleFromFileName(name),
        preselectMain: preselectMain,
        todayLabel: fmtDate(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('扫描归档')),
      body: ResponsiveCenter(
        maxWidth: 720,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        children: [
          // 取景器卡
          GestureDetector(
            onTap: () => _pick(context, ImageSource.camera),
            child: Container(
              height: 190,
              decoration: BoxDecoration(
                color: AppColors.viewfinder,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Stack(
                children: [
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.photo_camera,
                            size: 40, color: AppColors.gold.withOpacity(0.9)),
                        const SizedBox(height: 10),
                        const Text(
                          '拍摄材料',
                          style: TextStyle(
                            color: AppColors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // 四角取景线
                  ..._corners(),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _optionCard(
                  context,
                  icon: Icons.photo_library_outlined,
                  title: '从相册选择',
                  subtitle: '图片',
                  onTap: () => _pick(context, ImageSource.gallery),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _optionCard(
                  context,
                  icon: Icons.description_outlined,
                  title: '选择文件',
                  subtitle: 'PDF',
                  onTap: () => _pickFile(context),
                ),
              ),
            ],
          ),
        ],
        ),
      ),
    );
  }

  List<Widget> _corners() {
    const size = 26.0;
    const pad = 22.0;
    Widget corner(Alignment a) => Align(
          alignment: a,
          child: Container(
            width: size,
            height: size,
            margin: const EdgeInsets.all(pad),
            decoration: BoxDecoration(
              border: Border(
                left: a == Alignment.topLeft || a == Alignment.bottomLeft
                    ? const BorderSide(color: AppColors.gold, width: 2.4)
                    : BorderSide.none,
                top: a == Alignment.topLeft || a == Alignment.topRight
                    ? const BorderSide(color: AppColors.gold, width: 2.4)
                    : BorderSide.none,
                right: a == Alignment.topRight || a == Alignment.bottomRight
                    ? const BorderSide(color: AppColors.gold, width: 2.4)
                    : BorderSide.none,
                bottom: a == Alignment.bottomLeft ||
                        a == Alignment.bottomRight
                    ? const BorderSide(color: AppColors.gold, width: 2.4)
                    : BorderSide.none,
              ),
            ),
          ),
        );
    return [
      corner(Alignment.topLeft),
      corner(Alignment.topRight),
      corner(Alignment.bottomLeft),
      corner(Alignment.bottomRight),
    ];
  }

  Widget _optionCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 14),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.line),
        ),
        child: Column(
          children: [
            Icon(icon, size: 26, color: AppColors.ink),
            const SizedBox(height: 8),
            Text(title,
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(subtitle,
                style:
                    const TextStyle(fontSize: 11, color: AppColors.inkFaint)),
          ],
        ),
      ),
    );
  }
}

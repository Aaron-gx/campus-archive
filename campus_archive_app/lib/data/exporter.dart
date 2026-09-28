import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:cryptography/cryptography.dart' show Sha256;
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path/path.dart' as p;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import '../state/store.dart';
import 'crypto.dart' show hexEncode;
import 'format.dart';
import 'models.dart';

String generateVerifyCode() {
  final now = DateTime.now();
  final ym = '${now.year}${now.month.toString().padLeft(2, '0')}';
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  final rnd = Random.secure();
  final p1 = List.generate(4, (_) => chars[rnd.nextInt(chars.length)]).join();
  final p2 = List.generate(4, (_) => chars[rnd.nextInt(chars.length)]).join();
  return 'CA-$ym-$p1-$p2';
}

/// 导出服务：
/// - ZIP：{主分类}/{yyyyMMdd}_{标题}.{webp|pdf}（敏感文件解密）+ 材料清单.csv + 证书汇总.csv（UTF-8 BOM）
/// - PDF：全部图片合并为一个 PDF（原件 PDF 仅在 ZIP 模式中包含）
class ExportService {
  final AppStore store;
  ExportService(this.store);

  /// 所选分类是否含敏感文件（决定是否需要二次验证）
  bool containsSensitive(List<String> mainKeys) =>
      store.docs.any((d) => mainKeys.contains(d.mainKey) && d.isSensitive);

  /// 预览信息：每个分类的文件数
  Map<String, int> previewCounts(List<String> mainKeys) {
    final m = <String, int>{};
    for (final k in mainKeys) {
      m[k] = store.countOfMain(k);
    }
    return m;
  }

  /// 生成 ZIP 材料包，返回文件路径
  Future<String> buildZip(List<String> mainKeys,
      {bool includeCertificates = true}) async {
    final archive = Archive();
    final picked = store.docs.where((d) => mainKeys.contains(d.mainKey)).toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));

    final listRows = <List<String>>[];
    for (final doc in picked) {
      final main = mainCategoryOf(doc.categoryKey);
      final leaf = findCategory(doc.categoryKey);
      var bytes = await File(store.repo.storedPath(doc)).readAsBytes();
      if (doc.isSensitive) {
        bytes = await store.crypto.decryptFile(Uint8List.fromList(bytes));
      }
      final ext = doc.isPdf ? 'pdf' : 'webp';
      final safeTitle = _sanitize(doc.title);
      final entryName =
          '${main.name}/${fmtDate(doc.createdAt).replaceAll('.', '')}_$safeTitle.$ext';
      archive.addFile(ArchiveFile(entryName, bytes.length, bytes));
      listRows.add([
        main.name,
        doc.title,
        leaf?.name ?? '',
        (doc.note ?? '').replaceAll(',', '，'),
        doc.isSensitive ? '是' : '否',
        fmtDateTime(doc.createdAt),
      ]);
      if (doc.isSensitive) {
        await store.logAccess('export', doc);
      }
    }

    final listCsv = _csvBytes(listRows, const ['分类', '标题', '子类', '备注', '敏感加密', '上传时间']);
    archive.addFile(ArchiveFile('材料清单.csv', listCsv.length, listCsv));

    if (includeCertificates && store.certs.isNotEmpty) {
      final certRows = [
        for (final c in store.certs)
          [
            c.name.replaceAll(',', '，'),
            c.org.replaceAll(',', '，'),
            c.level,
            fmtDate(c.awardedAt),
            (c.note ?? '').replaceAll(',', '，'),
          ]
      ];
      final certCsv =
          _csvBytes(certRows, const ['证书名称', '颁发单位', '级别', '获得时间', '备注']);
      archive.addFile(ArchiveFile('证书汇总.csv', certCsv.length, certCsv));
    }

    final zipData = ZipEncoder().encode(archive);
    final fileName = '电子档案包_${fmtStamp(DateTime.now().millisecondsSinceEpoch)}.zip';
    final outPath = p.join(store.repo.exportsDir, fileName);
    await File(outPath).writeAsBytes(zipData!, flush: true);

    final hash = await Sha256().hash(zipData);
    final sha256Hex = hexEncode(hash.bytes);
    final verifyCode = generateVerifyCode();
    final certPart = (includeCertificates && store.certs.isNotEmpty) ? '、${store.certs.length} 条证书' : '';
    final manifestSummary = '包含 ${picked.length} 份材料$certPart';

    await store.recordExport(
      mainKeys.join(','),
      fileName,
      zipData.length,
      verifyCode: verifyCode,
      sha256: sha256Hex,
      manifestSummary: manifestSummary,
    );
    return outPath;
  }

  /// 生成合并 PDF（仅图片；用于直接阅读打印）
  Future<String> buildPdf(List<String> mainKeys) async {
    final picked = store.docs
        .where((d) => mainKeys.contains(d.mainKey) && !d.isPdf)
        .toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));

    final doc = pw.Document();
    var first = true;
    for (final d in picked) {
      var bytes = await File(store.repo.storedPath(d)).readAsBytes();
      if (d.isSensitive) {
        bytes = await store.crypto.decryptFile(Uint8List.fromList(bytes));
        await store.logAccess('export', d);
      }
      // WebP → JPEG，便于嵌入 PDF
      Uint8List jpeg;
      final tmp = File(p.join(store.repo.cacheDir, 'pdf_${d.id}.webp'));
      await tmp.writeAsBytes(bytes, flush: true);
      final converted = await FlutterImageCompress.compressWithFile(
        tmp.path,
        quality: 88,
        format: CompressFormat.jpeg,
      );
      jpeg = converted ?? bytes;
      doc.addPage(pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(0),
        build: (ctx) {
          final img = pw.Image(pw.MemoryImage(jpeg), fit: pw.BoxFit.contain);
          if (first) {
            first = false;
            return pw.Column(children: [
              pw.Container(
                padding: const pw.EdgeInsets.all(10),
                alignment: pw.Alignment.center,
                child: pw.Text('简册',
                    style: const pw.TextStyle(
                        fontSize: 13, color: PdfColors.grey700)),
              ),
              pw.Expanded(child: pw.Center(child: img)),
            ]);
          }
          return pw.Center(child: img);
        },
      ));
    }

    final pdfBytes = await doc.save();
    final fileName = '档案材料包_${fmtStamp(DateTime.now().millisecondsSinceEpoch)}.pdf';
    final outPath = p.join(store.repo.exportsDir, fileName);
    await File(outPath).writeAsBytes(pdfBytes, flush: true);

    final hash = await Sha256().hash(pdfBytes);
    final sha256Hex = hexEncode(hash.bytes);
    final verifyCode = generateVerifyCode();
    final manifestSummary = '包含 ${picked.length} 份材料（PDF）';

    await store.recordExport(
      '${mainKeys.join(',')}|pdf',
      fileName,
      pdfBytes.length,
      verifyCode: verifyCode,
      sha256: sha256Hex,
      manifestSummary: manifestSummary,
    );
    return outPath;
  }

  /// 从总目录勾选的零散文档直接打包（不做分类整理，放「挑选材料」目录）
  Future<void> exportSelected(List<String> docIds) async {
    final picked = store.docs.where((d) => docIds.contains(d.id)).toList();
    if (picked.isEmpty) return;
    final archive = Archive();
    for (final doc in picked) {
      final main = mainCategoryOf(doc.categoryKey);
      var bytes = await File(store.repo.storedPath(doc)).readAsBytes();
      if (doc.isSensitive) {
        bytes = await store.crypto.decryptFile(Uint8List.fromList(bytes));
        await store.logAccess('export', doc);
      }
      final ext = doc.isPdf ? 'pdf' : 'webp';
      final entryName =
          '挑选材料/${main.name}/${_sanitize(doc.title)}.$ext';
      archive.addFile(ArchiveFile(entryName, bytes.length, bytes));
    }
    final zipData = ZipEncoder().encode(archive);
    final fileName = '挑选材料_${fmtStamp(DateTime.now().millisecondsSinceEpoch)}.zip';
    final outPath = p.join(store.repo.exportsDir, fileName);
    await File(outPath).writeAsBytes(zipData!, flush: true);

    final hash = await Sha256().hash(zipData);
    final sha256Hex = hexEncode(hash.bytes);
    final verifyCode = generateVerifyCode();
    final manifestSummary = '包含 ${picked.length} 份挑选材料';

    await store.recordExport(
      'selected',
      fileName,
      zipData.length,
      verifyCode: verifyCode,
      sha256: sha256Hex,
      manifestSummary: manifestSummary,
    );
    await share(outPath);
  }

  /// 系统分享（保存到本地 / 发送）
  Future<void> share(String path) async {
    await Share.shareXFiles([XFile(path)]);
  }

  /// 直接打开预览
  Future<void> open(String path) async {
    await OpenFilex.open(path);
  }

  String _sanitize(String s) {
    final cleaned = s.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    return cleaned.length > 80 ? cleaned.substring(0, 80) : cleaned;
  }

  /// Excel 友好 CSV：UTF-8 BOM + CRLF
  Uint8List _csvBytes(List<List<String>> rows, List<String> header) {
    final sb = StringBuffer();
    sb.writeln(header.join(','));
    for (final r in rows) {
      sb.writeln(r.join(','));
    }
    final body = utf8.encode(sb.toString().replaceAll('\n', '\r\n'));
    return Uint8List.fromList([0xEF, 0xBB, 0xBF, ...body]);
  }
}

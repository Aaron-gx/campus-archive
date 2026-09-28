import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'crypto.dart';
import 'db.dart';
import 'format.dart';
import 'models.dart';

/// 档案袋仓库：数据库 + 文件存储 + 图片压缩 + 加密的落盘逻辑
class ArchiveRepository {
  final AppDb appDb;
  final CryptoService crypto;
  final _uuid = const Uuid();

  ArchiveRepository(this.appDb, this.crypto);

  late final String filesDir;
  late final String exportsDir;
  late final String cacheDir;
  late final Database _database;

  Future<void> init() async {
    _database = await appDb.get();
    final base = await getApplicationDocumentsDirectory();
    filesDir = p.join(base.path, 'files');
    exportsDir = p.join(base.path, 'exports');
    final cache = await getTemporaryDirectory();
    cacheDir = cache.path;
    await Directory(filesDir).create(recursive: true);
    await Directory(exportsDir).create(recursive: true);
  }

  Database get _db => _database;

  // ---------- 加载 ----------

  Future<Profile?> loadProfile() async {
    final rows = await _db.query('profile', where: 'id = 1');
    return rows.isEmpty ? null : Profile.fromRow(rows.first);
  }

  /// 档案列表（不含已标记删除、待同步删除的行）
  Future<List<Doc>> loadDocs() async {
    final rows = await _db.query('documents',
        where: "pending_op IS NULL OR pending_op != 'delete'",
        orderBy: 'created_at DESC');
    return rows.map(Doc.fromRow).toList();
  }

  Future<List<Cert>> loadCerts() async {
    final rows = await _db.query('certificates',
        where: "pending_op IS NULL OR pending_op != 'delete'",
        orderBy: 'awarded_at DESC');
    return rows.map(Cert.fromRow).toList();
  }

  Future<List<ExportRecord>> loadExports() async {
    final rows = await _db.query('export_records',
        orderBy: 'created_at DESC', limit: 20);
    return rows.map(ExportRecord.fromRow).toList();
  }

  Future<List<AccessLog>> loadLogs() async {
    final rows = await _db.query('access_logs',
        orderBy: 'created_at DESC', limit: 50);
    return rows.map(AccessLog.fromRow).toList();
  }

  // ---------- 档案袋（账户） ----------

  Future<Profile> createProfile(
      String nickname, String school, String password) async {
    final h = await crypto.hashPassword(password);
    final profile = Profile(
      nickname: nickname,
      school: school,
      passwordHash: h.hash,
      passwordSalt: h.salt,
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    await _db.insert('profile', {...profile.toRow(), 'id': 1});
    return profile;
  }

  Future<Profile> updateProfile(Profile old,
      {String? nickname, String? school}) async {
    final updated = Profile(
      nickname: nickname ?? old.nickname,
      school: school ?? old.school,
      passwordHash: old.passwordHash,
      passwordSalt: old.passwordSalt,
      createdAt: old.createdAt,
    );
    await _db.update('profile', updated.toRow(), where: 'id = 1');
    return updated;
  }

  Future<Profile> changePassword(Profile old, String newPassword) async {
    final h = await crypto.hashPassword(newPassword);
    final updated = Profile(
      nickname: old.nickname,
      school: old.school,
      passwordHash: h.hash,
      passwordSalt: h.salt,
      createdAt: old.createdAt,
    );
    await _db.update('profile', updated.toRow(), where: 'id = 1');
    return updated;
  }

  /// 直接保存资料行（登录建档 / 离线验证哈希更新）
  Future<void> saveProfile(Profile p) async {
    final rows = await _db.query('profile', where: 'id = 1');
    if (rows.isEmpty) {
      await _db.insert('profile', {...p.toRow(), 'id': 1});
    } else {
      await _db.update('profile', p.toRow(), where: 'id = 1');
    }
  }

  /// 用服务器记录 upsert 导出历史（本地记录保留，不删）
  Future<void> mirrorExportRecord(ExportRecord r) async {
    await _db.insert('export_records', r.toRow(),
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  // ---------- 归档文档 ----------

  /// 上传归档：压缩（图片→WebP ≤2000px）/保留 PDF → 敏感加密 → 落盘 → 建档
  /// [sourcePath] 原始文件路径；[isSensitive] 身份证件强制为 true
  Future<Doc> addDocument({
    required String sourcePath,
    required String originalName,
    required String leafCategoryKey,
    required String title,
    String? note,
    String? groupId,
    String? side,
    int? sideOrder,
    String? meta,
    bool isSensitive = false,
    CertFields? certFields,
  }) async {
    final main = mainCategoryOf(leafCategoryKey);
    final sensitive = main.sensitive ? true : isSensitive;
    final isPdf = originalName.toLowerCase().endsWith('.pdf') ||
        p.extension(sourcePath).toLowerCase() == '.pdf';

    Uint8List bytes;
    String ext;
    String mime;
    if (isPdf) {
      bytes = await File(sourcePath).readAsBytes();
      ext = 'pdf';
      mime = 'application/pdf';
    } else {
      final compressed = await FlutterImageCompress.compressWithFile(
        sourcePath,
        minWidth: 2000,
        minHeight: 2000,
        quality: 82,
        format: CompressFormat.webp,
        keepExif: false,
      );
      if (compressed == null) {
        bytes = await File(sourcePath).readAsBytes();
      } else {
        bytes = compressed;
      }
      ext = 'webp';
      mime = 'image/webp';
    }

    final id = _uuid.v4();
    final storedName = '$id${sensitive ? '.enc' : ''}.$ext';
    if (sensitive) {
      bytes = await crypto.encryptFile(bytes);
    }
    await File(p.join(filesDir, storedName))
        .writeAsBytes(bytes, flush: true);

    final now = DateTime.now().millisecondsSinceEpoch;
    final doc = Doc(
      id: id,
      categoryKey: leafCategoryKey,
      title: stripSideSuffix(title.trim()),
      fileName: originalName,
      storedName: storedName,
      mime: mime,
      size: bytes.length,
      isSensitive: sensitive,
      note: note,
      groupId: groupId,
      side: side,
      sideOrder: sideOrder,
      meta: meta,
      createdAt: now,
      updatedAt: now,
      pendingOp: 'create', // 待同步：联网后自动上传
    );
    await _db.insert('documents', doc.toRow());

    if (certFields != null) {
      await _db.insert('certificates', Cert(
        id: _uuid.v4(),
        name: certFields.name,
        org: certFields.org,
        level: certFields.level,
        awardedAt: certFields.awardedAt,
        note: certFields.note,
        documentId: id,
        pendingOp: 'create',
      ).toRow());
    }
    return doc;
  }

  Future<void> updateDoc(Doc doc) =>
      _db.update('documents', doc.toRow(), where: 'id = ?', whereArgs: [doc.id]);

  Future<void> deleteDoc(Doc doc) async {
    await _db.delete('documents', where: 'id = ?', whereArgs: [doc.id]);
    await _db.update('certificates', {'document_id': null},
        where: 'document_id = ?', whereArgs: [doc.id]);
    final f = File(p.join(filesDir, doc.storedName));
    if (await f.exists()) await f.delete();
  }

  String storedPath(Doc doc) => p.join(filesDir, doc.storedName);

  /// 取可打开的文件：非敏感直接返回存储路径；敏感则解密到缓存临时文件
  Future<String> viewablePath(Doc doc) async {
    final path = storedPath(doc);
    if (!doc.isSensitive) return path;
    final blob = await File(path).readAsBytes();
    final clear = await crypto.decryptFile(Uint8List.fromList(blob));
    final ext = doc.isPdf ? 'pdf' : 'webp';
    final tmp = File(p.join(cacheDir, 'view_${doc.id}.$ext'));
    await tmp.writeAsBytes(clear, flush: true);
    return tmp.path;
  }

  // ---------- 证书 ----------

  Future<Cert> addCert(Cert cert) async {
    final c = Cert(
      id: _uuid.v4(),
      name: cert.name,
      org: cert.org,
      level: cert.level,
      awardedAt: cert.awardedAt,
      note: cert.note,
      documentId: cert.documentId,
      pendingOp: 'create', // 待同步：联网后自动上传
    );
    await _db.insert('certificates', c.toRow());
    return c;
  }

  Future<void> updateCert(Cert cert) =>
      _db.update('certificates', cert.toRow(),
          where: 'id = ?', whereArgs: [cert.id]);

  Future<void> deleteCert(String id) =>
      _db.delete('certificates', where: 'id = ?', whereArgs: [id]);

  // ---------- 导出与调档记录 ----------

  Future<void> addExportRecord(
    String categoryKeys,
    String fileName,
    int size, {
    String? verifyCode,
    String? sha256,
    String? manifestSummary,
    String? watermarkText,
  }) =>
      _db.insert('export_records', {
        'id': _uuid.v4(),
        'category_keys': categoryKeys,
        'file_name': fileName,
        'size': size,
        'verify_code': verifyCode,
        'sha256': sha256,
        'manifest_summary': manifestSummary,
        'watermark_text': watermarkText,
        'created_at': DateTime.now().millisecondsSinceEpoch,
      });

  Future<void> addAccessLog(String action, String docTitle) => _db.insert(
        'access_logs',
        {
          'id': _uuid.v4(),
          'action': action,
          'doc_title': docTitle,
          'created_at': DateTime.now().millisecondsSinceEpoch,
        },
      );

  // ---------- 同步辅助（离线镜像 / 待同步队列） ----------

  /// 待推送的文档（不含待删除——那些推送后直接删除本地行）
  Future<List<Doc>> pendingDocs() async {
    final rows = await _db.query('documents',
        where: "pending_op IS NOT NULL AND pending_op != 'delete'",
        orderBy: 'created_at ASC');
    return rows.map(Doc.fromRow).toList();
  }

  /// 待推送的证书
  Future<List<Cert>> pendingCerts() async {
    final rows = await _db.query('certificates',
        where: "pending_op IS NOT NULL AND pending_op != 'delete'",
        orderBy: 'awarded_at ASC');
    return rows.map(Cert.fromRow).toList();
  }

  /// 推送成功：回填服务器 id，清除待同步标记
  Future<void> markDocSynced(String rowId, String remoteId) async {
    await _db.update('documents', {'remote_id': remoteId, 'pending_op': null},
        where: 'id = ?', whereArgs: [rowId]);
  }

  Future<void> markCertSynced(String rowId, String remoteId) async {
    await _db.update('certificates', {'remote_id': remoteId, 'pending_op': null},
        where: 'id = ?', whereArgs: [rowId]);
  }

  /// 用服务器记录更新本地镜像（按 remote_id 或 id 匹配；不存在则插入）。
  /// 保留本地已缓存的文件名；镜像行始终视为已同步。
  Future<Doc> mirrorDoc(Doc remote) async {
    final existing = await _db.query('documents',
        where: 'remote_id = ? OR id = ?',
        whereArgs: [remote.id, remote.id],
        limit: 1);
    final merged = Doc(
      id: remote.id,
      categoryKey: remote.categoryKey,
      title: remote.title,
      fileName: remote.fileName,
      storedName: existing.isEmpty
          ? '${remote.id}${remote.isSensitive ? '.enc' : ''}.${remote.isPdf ? 'pdf' : 'webp'}'
          : Doc.fromRow(existing.first).storedName,
      mime: remote.mime,
      size: remote.size,
      isSensitive: remote.isSensitive,
      e2ee: remote.e2ee,
      note: remote.note,
      groupId: remote.groupId,
      side: remote.side,
      sideOrder: remote.sideOrder,
      meta: remote.meta,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      remoteId: remote.id,
      pendingOp: null,
    );
    if (existing.isEmpty) {
      await _db.insert('documents', merged.toRow());
    } else {
      await _db.update('documents', merged.toRow(),
          where: 'id = ?', whereArgs: [existing.first['id'] as String]);
    }
    return merged;
  }

  /// 用服务器记录更新证书镜像
  Future<void> mirrorCert(Cert remote) async {
    final existing = await _db.query('certificates',
        where: 'remote_id = ? OR id = ?',
        whereArgs: [remote.id, remote.id],
        limit: 1);
    final row = Cert(
      id: remote.id,
      name: remote.name,
      org: remote.org,
      level: remote.level,
      awardedAt: remote.awardedAt,
      note: remote.note,
      documentId: remote.documentId,
      remoteId: remote.id,
      pendingOp: null,
    ).toRow();
    if (existing.isEmpty) {
      await _db.insert('certificates', row);
    } else {
      await _db.update('certificates', row,
          where: 'id = ?', whereArgs: [existing.first['id'] as String]);
    }
  }

  /// 删除本地行 + 物理文件（行 id 或 remote_id 均可命中）
  Future<void> removeDocRow(String idOrRemoteId) async {
    final rows = await _db.query('documents',
        where: 'id = ? OR remote_id = ?', whereArgs: [idOrRemoteId, idOrRemoteId], limit: 1);
    if (rows.isNotEmpty) {
      final f = File(p.join(filesDir, rows.first['stored_name'] as String));
      if (await f.exists()) await f.delete();
      await _db.delete('documents',
          where: 'id = ?', whereArgs: [rows.first['id'] as String]);
    }
  }

  Future<void> removeCertRow(String idOrRemoteId) async {
    await _db.delete('certificates',
        where: 'id = ? OR remote_id = ?', whereArgs: [idOrRemoteId, idOrRemoteId]);
  }

  /// 服务器已不存在（其他端删除）的本地镜像行：物理删除
  Future<void> pruneMirrorRows(Set<String> serverDocIds,
      Set<String> serverCertIds) async {
    final docs = await _db.query(
        'documents',
        where: "pending_op IS NULL AND (remote_id IS NOT NULL OR id NOT LIKE '%-%-%-%-%')");
    for (final r in docs) {
      final remoteId = (r['remote_id'] ?? r['id']) as String?;
      if (remoteId != null && !serverDocIds.contains(remoteId)) {
        await removeDocRow(r['id'] as String);
      }
    }
    final certs = await _db.query(
        'certificates',
        where: "pending_op IS NULL AND (remote_id IS NOT NULL OR id NOT LIKE '%-%-%-%')");
    for (final r in certs) {
      final remoteId = (r['remote_id'] ?? r['id']) as String?;
      if (remoteId != null && !serverCertIds.contains(remoteId)) {
        await removeCertRow(r['id'] as String);
      }
    }
  }

  /// 文件是否已缓存在本地
  bool docFileExists(Doc doc) => File(p.join(filesDir, doc.storedName)).existsSync();

  /// 缓存服务器下载的文件字节（敏感文件落盘前用本地密钥加密）
  Future<void> saveDocFile(Doc doc, Uint8List bytes) async {
    var data = bytes;
    if (doc.isSensitive) {
      data = await crypto.encryptFile(bytes);
    }
    await File(p.join(filesDir, doc.storedName)).writeAsBytes(data, flush: true);
  }

  /// 清空档案袋（注销）：全部数据与物理文件
  Future<void> wipeAll() async {
    await _db.delete('documents');
    await _db.delete('certificates');
    await _db.delete('export_records');
    await _db.delete('access_logs');
    await _db.delete('profile');
    final dir = Directory(filesDir);
    if (await dir.exists()) {
      await for (final f in dir.list()) {
        if (f is File) await f.delete();
      }
    }
    final edir = Directory(exportsDir);
    if (await edir.exists()) {
      await for (final f in edir.list()) {
        if (f is File) await f.delete();
      }
    }
  }
}

/// 归档表单里附带的证书登记字段
class CertFields {
  final String name;
  final String org;
  final String level;
  final int awardedAt;
  final String? note;

  CertFields(this.name, this.org, this.level, this.awardedAt, this.note);
}

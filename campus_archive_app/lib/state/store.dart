import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api_client.dart';
import '../data/crypto.dart';
import '../data/db.dart';
import '../data/e2ee.dart';
import '../data/models.dart';
import '../data/repo.dart';

/// 全局应用状态：单一账号模式（离线优先）
///
/// - 数据只有一份权威来源：服务器；本机保存全量镜像（SQLite + 文件）
/// - 所有读取直接走本地镜像，秒开且离线可用
/// - 所有写入先落本地并打上待同步标记，联网后自动推送服务器
/// - 联网时执行同步：推送待同步队列 → 拉取服务器全量 → 修剪多余镜像 → 补下载缺失文件
/// - 端到端加密：上传前用客户端 DEK 加密，服务器只存密文（lib/data/e2ee.dart）
class AppStore extends ChangeNotifier {
  final AppDb appDb;
  final CryptoService crypto;
  late final ArchiveRepository repo;
  late final ApiClient api;
  late final E2eeService e2ee;

  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _retryTimer;
  bool _syncBusy = false;

  AppStore({required this.appDb, required this.crypto}) {
    repo = ArchiveRepository(appDb, crypto);
    api = ApiClient();
    e2ee = E2eeService(api);
  }

  bool ready = false;
  bool loggedIn = false;
  bool online = false;
  bool syncing = false;
  String? offlineError; // 最近一次同步失败原因（展示用）

  // 本地镜像数据（UI 统一读取）
  Profile? profile; // 账号资料缓存（含离线敏感验证用的密码哈希）
  List<Doc> docs = [];
  List<Cert> certs = [];
  List<ExportRecord> exportRecords = [];
  List<AccessLog> logs = [];

  RemoteAccount? account;
  Map<String, String> categoryIdMap = {}; // 固定 key → 服务器分类 id
  DateTime? _verifiedUntil;

  int get pendingSyncCount {
    var n = docs.where((d) => d.pendingSync).length;
    n += certs.where((c) => c.pendingSync).length;
    return n;
  }

  /// 端到端加密数据密钥是否已解锁（决定 e2ee 缩略图/原件是否可见）
  bool get e2eeUnlocked => e2ee.unlocked;

  /// UI 统一读取的展示档案
  Profile get displayProfile =>
      profile ??
      Profile(
        nickname: account?.nickname ?? '同学',
        school: account?.school ?? '',
        passwordHash: '',
        passwordSalt: '',
        createdAt: account?.createdAt ?? 0,
      );

  // ---------- 启动 ----------

  Future<void> load() async {
    await appDb.get();
    await crypto.init();
    await repo.init();
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('serverUrl');
    if (url != null && url.isNotEmpty) api.baseUrl = url;
    api.restoreCookies(prefs.getString('cookies'));
    // 恢复端到端加密数据密钥（安全存储中有缓存时免重输密码）
    await e2ee.tryRestore();

    await _refreshFromMirror();
    _startConnectivityWatch();

    if (api.baseUrl.isNotEmpty &&
        (prefs.getString('cookies') ?? '').isNotEmpty) {
      // 有历史会话：先展示镜像数据，后台立即同步
      loggedIn = true;
      ready = true;
      notifyListeners();
      unawaited(sync());
    } else {
      ready = true;
      notifyListeners();
    }
  }

  Future<void> _refreshFromMirror() async {
    profile = await repo.loadProfile();
    docs = await repo.loadDocs();
    certs = await repo.loadCerts();
    exportRecords = await repo.loadExports();
    logs = await repo.loadLogs();
  }

  void _startConnectivityWatch() {
    _connSub ??= Connectivity().onConnectivityChanged.listen((results) {
      final hasNet = results.any((r) => r != ConnectivityResult.none);
      if (hasNet && loggedIn && !online && !_syncBusy) {
        unawaited(sync());
      }
    });
    // 离线期间每 30 秒轻量重试（服务器局域网地址变化也能自动恢复）
    _retryTimer ??= Timer.periodic(const Duration(seconds: 30), (_) {
      if (loggedIn && !online && !_syncBusy) unawaited(sync());
    });
  }

  // ---------- 同步引擎 ----------

  /// 完整同步一轮：推送待同步队列 → 拉取服务器全量镜像。
  /// 任何网络错误都只标记离线状态，不抛给调用方 UI。
  Future<void> sync() async {
    if (!loggedIn || _syncBusy) return;
    _syncBusy = true;
    syncing = true;
    notifyListeners();
    try {
      await _pushPending();
      await _pullRemote();
      online = true;
      offlineError = null;
    } on ApiException catch (e) {
      online = false;
      offlineError = e.message;
      // 会话彻底失效（改密/过期/注销）：回到登录页
      if (e.message.contains('未登录')) {
        _syncBusy = false;
        syncing = false;
        await logoutAccount();
        return;
      }
    } catch (e, st) {
      online = false;
      offlineError = '同步失败：$e';
      debugPrint('sync error: $e\n$st');
    } finally {
      _syncBusy = false;
      syncing = false;
      await _refreshFromMirror();
      notifyListeners();
    }
  }

  /// 推送本地待同步队列（文档 → 证书；先建后改删）
  Future<void> _pushPending() async {
    if (categoryIdMap.isEmpty) {
      categoryIdMap = await api.fetchCategoryIdMap();
    }

    // 文档：按创建时间正序推送
    for (final doc in await repo.pendingDocs()) {
      final op = doc.pendingOp!;
      if (op == 'delete') {
        if (doc.remoteId != null) await api.deleteDocument(doc.remoteId!);
        await repo.removeDocRow(doc.id);
        continue;
      }
      final categoryId = categoryIdMap[doc.categoryKey];
      if (categoryId == null) {
        throw ApiException('分类信息未同步，已推迟上传');
      }
      if (op == 'create') {
        // 敏感文件本地是本地密钥加密的，先解密还原为明文字节；
        // 随后图片压缩转 webp，再用端到端加密（DEK）加密后上传——
        // 服务器全程只接触密文，无法解密文件内容
        final f = File(repo.storedPath(doc));
        if (!await f.exists()) {
          throw ApiException('本地文件缺失（${doc.title}），同步已暂停');
        }
        var bytes = await f.readAsBytes();
        if (doc.isSensitive) {
          bytes = await crypto.decryptFile(bytes);
        }
        var mime = doc.isPdf ? 'application/pdf' : 'image/webp';
        if (!doc.isPdf) {
          final compressed = await FlutterImageCompress.compressWithList(
            bytes,
            minWidth: 2000,
            minHeight: 2000,
            quality: 82,
            format: CompressFormat.webp,
            keepExif: false,
          );
          bytes = compressed;
        }
        final fileName = doc.fileName.isNotEmpty
            ? doc.fileName
            : '${doc.title}.${doc.isPdf ? 'pdf' : 'webp'}';
        final cipher = await e2ee.encrypt(bytes);
        final remote = await api.uploadDocument(
          fileName: fileName,
          categoryId: categoryId,
          title: doc.title,
          note: doc.note,
          isSensitive: doc.isSensitive,
          groupId: doc.groupId,
          side: doc.side,
          sideOrder: doc.sideOrder,
          meta: doc.meta,
          fileBytes: cipher,
          e2ee: true,
          contentMime: mime,
        );
        await repo.markDocSynced(doc.id, remote.id);
      } else if (op == 'update') {
        await api.updateDocument(
          doc.remoteId!,
          title: doc.title,
          note: doc.note ?? '',
          categoryId: categoryId,
          side: doc.side,
          sideOrder: doc.sideOrder,
        );
        await repo.markDocSynced(doc.id, doc.remoteId!);
      }
    }

    // 证书
    final mirrorDocs = await repo.loadDocs();
    Doc? docByRowId(String id) {
      for (final d in mirrorDocs) {
        if (d.id == id) return d;
      }
      return null;
    }

    for (final cert in await repo.pendingCerts()) {
      final op = cert.pendingOp!;
      if (op == 'delete') {
        if (cert.remoteId != null) await api.deleteCertificate(cert.remoteId!);
        await repo.removeCertRow(cert.id);
        continue;
      }
      // 关联文档 id 重映射：本地行 id → 服务器 id；文档还没同步成功则本轮跳过
      String? documentId = cert.documentId;
      if (documentId != null) {
        final linked = docByRowId(documentId);
        if (linked != null && linked.remoteId != null) {
          documentId = linked.remoteId;
        } else if (linked != null) {
          continue;
        }
      }
      if (op == 'create') {
        final remote = await api.addCertificate(
            cert.copyWith(documentId: documentId, pendingOp: null));
        await repo.markCertSynced(cert.id, remote.id);
      } else if (op == 'update') {
        await api.updateCertificate(
            cert.copyWith(documentId: documentId, pendingOp: null));
        await repo.markCertSynced(cert.id, cert.remoteId!);
      }
    }
  }

  /// 拉取服务器全量：账号 / 分类 / 文档 / 证书 / 导出记录 → 本地镜像
  Future<void> _pullRemote() async {
    account = await api.getAccount();
    categoryIdMap = await api.fetchCategoryIdMap();
    final remoteDocs = await api.fetchDocuments();
    final remoteCerts = await api.fetchCertificates();
    final remoteExports = await api.fetchExportRecords();

    for (final rd in remoteDocs) {
      await repo.mirrorDoc(rd);
    }
    for (final rc in remoteCerts) {
      await repo.mirrorCert(rc);
    }
    for (final re in remoteExports) {
      await repo.mirrorExportRecord(re);
    }
    // 修剪已在其他端删除的镜像行（本地待同步行不受影响）
    await repo.pruneMirrorRows(
      remoteDocs.map((d) => d.id).toSet(),
      remoteCerts.map((c) => c.id).toSet(),
    );

    await _syncProfileFromAccount();

    // 补下载缺失文件（每轮限量；敏感文件未通过二次验证时服务器会拒绝，跳过）
    await ensureFiles(limit: 8, notify: false);
  }

  Future<void> _syncProfileFromAccount() async {
    final existing = await repo.loadProfile();
    // 注意：existing?.createdAt != 0 在 existing 为 null 时同样成立，
    // 必须先判空再取值（此处曾是空断言崩溃点）
    int createdAt;
    if (existing != null && existing.createdAt != 0) {
      createdAt = existing.createdAt;
    } else if ((account?.createdAt ?? 0) != 0) {
      createdAt = account!.createdAt;
    } else {
      createdAt = DateTime.now().millisecondsSinceEpoch;
    }
    if (existing != null) {
      await repo.saveProfile(Profile(
        nickname: account?.nickname ?? existing.nickname,
        school: account?.school ?? existing.school,
        passwordHash: existing.passwordHash,
        passwordSalt: existing.passwordSalt,
        createdAt: createdAt,
      ));
    } else {
      // 兜底：无本地资料行（正常路径在登录时建档）。
      // 随机哈希意味着离线敏感验证不可用，重新登录后恢复。
      final h = await crypto.hashPassword(
          DateTime.now().microsecondsSinceEpoch.toRadixString(36));
      await repo.saveProfile(Profile(
        nickname: account?.nickname ?? '同学',
        school: account?.school ?? '',
        passwordHash: h.hash,
        passwordSalt: h.salt,
        createdAt: createdAt,
      ));
    }
  }

  /// 补下载本地缺失的文件（进首页 / 下拉时调用）
  Future<void> ensureFiles({int limit = 24, bool notify = true}) async {
    if (!loggedIn) return;
    var n = 0;
    final current = await repo.loadDocs();
    for (final d in current) {
      if (n >= limit) break;
      if (repo.docFileExists(d)) continue;
      try {
        var bytes = await api.fetchDocumentFile(d.remoteId ?? d.id);
        if (d.e2ee) bytes = await e2ee.decrypt(bytes); // 密文 → 明文（锁定时抛错跳过）
        await repo.saveDocFile(d, bytes);
        n++;
      } on ApiException {
        continue; // 敏感未验证、已离线或 E2EE 锁定，跳过
      }
    }
    if (n > 0) {
      await _refreshFromMirror();
      if (notify) notifyListeners();
    }
  }

  // ---------- 登录 / 注册 / 退出 ----------

  Future<void> loginAccount(
      String serverUrl, String account_, String password) async {
    api.baseUrl = _normalizeUrl(serverUrl);
    await api.login(account_, password);
    await _onSessionEstablished(password);
  }

  Future<void> registerAccount(String serverUrl, String account_,
      String password, String nickname,
      [String school = '']) async {
    api.baseUrl = _normalizeUrl(serverUrl);
    await api.register(
        account: account_, password: password, nickname: nickname, school: school);
    await api.login(account_, password);
    await _onSessionEstablished(password);
  }

  /// 会话建立后的本地收尾：持久化 Cookie、建档（含离线敏感验证哈希）、首次同步
  Future<void> _onSessionEstablished(String password) async {
    loggedIn = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', api.baseUrl);
    await prefs.setString('cookies', api.exportCookies());
    // 端到端加密：解出/初始化数据密钥；失败则文件保持锁定，可重新登录重试
    try {
      await e2ee.unlock(password);
    } catch (_) {}

    final h = await crypto.hashPassword(password);
    final now = DateTime.now().millisecondsSinceEpoch;
    await repo.saveProfile(Profile(
      nickname: account?.nickname ?? '同学',
      school: account?.school ?? '',
      passwordHash: h.hash,
      passwordSalt: h.salt,
      createdAt: account?.createdAt ?? now,
    ));
    notifyListeners();
    await sync();
  }

  Future<void> logoutAccount() async {
    try {
      await api.logout();
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('cookies');
    loggedIn = false;
    online = false;
    syncing = false;
    offlineError = null;
    account = null;
    _verifiedUntil = null;
    await e2ee.wipe(); // 清除端到端加密数据密钥
    // 清空本地镜像（服务器仍有全量数据，重新登录即恢复）
    await repo.wipeAll();
    profile = null;
    docs = [];
    certs = [];
    exportRecords = [];
    logs = [];
    notifyListeners();
  }

  String _normalizeUrl(String url) {
    var u = url.trim();
    if (u.isEmpty) return u;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'http://$u';
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    return u;
  }

  // ---------- 二次验证（10 分钟窗口；离线回退本地哈希） ----------

  bool get sensitiveVerified =>
      _verifiedUntil != null && DateTime.now().isBefore(_verifiedUntil!);

  String get verifyRemainText {
    final u = _verifiedUntil;
    if (u == null || !sensitiveVerified) return '';
    final s = u.difference(DateTime.now()).inSeconds;
    return '${(s / 60).floor() + 1} 分钟';
  }

  Future<bool> verifySensitive(String password) async {
    // 优先走服务器（同时发放敏感文件下载 Cookie）；失败再回退本地哈希
    try {
      final expires = await api.sensitiveVerify(password);
      _verifiedUntil = DateTime.now().add(Duration(seconds: expires));
      notifyListeners();
      return true;
    } on ApiException {
      // 继续尝试本地
    }
    final ok = await checkPassword(password);
    if (ok) {
      _verifiedUntil = DateTime.now().add(const Duration(minutes: 10));
      notifyListeners();
    }
    return ok;
  }

  /// 仅校验本地密码哈希（离线敏感验证；不产生验证窗口副作用）
  Future<bool> checkPassword(String password) async {
    final prof = profile;
    if (prof == null || prof.passwordHash.isEmpty) return false;
    return crypto.verifyPassword(password, prof.passwordHash, prof.passwordSalt);
  }

  // ---------- 资料与密码 ----------

  Future<void> updateProfile({String? nickname, String? school}) async {
    await api.updateAccount(nickname: nickname, school: school);
    final prof = profile;
    if (prof != null) {
      await repo.saveProfile(Profile(
        nickname: nickname ?? prof.nickname,
        school: school ?? prof.school,
        passwordHash: prof.passwordHash,
        passwordSalt: prof.passwordSalt,
        createdAt: prof.createdAt,
      ));
      profile = await repo.loadProfile();
      notifyListeners();
    }
    unawaited(sync());
  }

  Future<void> changePassword(String oldPassword, String newPassword) async {
    // 端到端加密先用旧密码解出 DEK、新密码重新包裹（放在最前：
    // 旧密码不对会在这里失败，避免服务端已改密但密钥托管的旧密码失效）
    await e2ee.rewrap(oldPassword, newPassword);
    await api.changePassword(oldPassword, newPassword);
    // 同步更新本地离线验证哈希
    final prof = profile;
    if (prof != null) {
      final h = await crypto.hashPassword(newPassword);
      await repo.saveProfile(Profile(
        nickname: prof.nickname,
        school: prof.school,
        passwordHash: h.hash,
        passwordSalt: h.salt,
        createdAt: prof.createdAt,
      ));
      profile = await repo.loadProfile();
    }
    _verifiedUntil = null;
    notifyListeners();
  }

  // ---------- 文档 ----------

  Future<void> addDocument({
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
    // 压缩 / 加密 / 落盘 / 建档，打上待同步标记
    final doc = await repo.addDocument(
      sourcePath: sourcePath,
      originalName: originalName,
      leafCategoryKey: leafCategoryKey,
      title: title,
      note: note,
      groupId: groupId,
      side: side,
      sideOrder: sideOrder,
      meta: meta,
      isSensitive: isSensitive,
      certFields: certFields,
    );
    docs = [doc, ...docs];
    await _reloadCerts();
    notifyListeners();
    unawaited(sync()); // 在线立即上传；离线留在队列
  }

  Future<void> updateDoc(Doc doc) async {
    final op = doc.pendingOp == 'create' ? 'create' : 'update';
    final updated =
        doc.copyWith(updatedAt: DateTime.now().millisecondsSinceEpoch, pendingOp: op);
    await repo.updateDoc(updated);
    final i = docs.indexWhere((d) => d.id == doc.id);
    if (i >= 0) docs[i] = updated;
    notifyListeners();
    unawaited(sync());
  }

  Future<void> deleteDoc(Doc doc) async {
    if (doc.pendingOp == 'create') {
      // 从未上传过服务器，直接本地删除
      await repo.deleteDoc(doc);
    } else {
      // 标记待删除：推送成功后由同步引擎清理本地行与文件
      await repo.updateDoc(doc.copyWith(pendingOp: 'delete'));
    }
    docs = docs.where((d) => d.id != doc.id).toList();
    await _reloadCerts();
    notifyListeners();
    unawaited(sync());
  }

  Future<void> logAccess(String action, Doc doc) async {
    await repo.addAccessLog(action, doc.title);
    logs = await repo.loadLogs();
    notifyListeners();
  }

  /// 缩略图路径（镜像文件已缓存才返回；未缓存由 ensureFiles 补下载）
  String? thumbPath(Doc doc) {
    final f = File(repo.storedPath(doc));
    return f.existsSync() ? f.path : null;
  }

  /// 取可打开的文件：本地镜像优先；镜像缺失时在线补下载；
  /// 敏感文件解密到缓存临时文件
  Future<String> viewablePath(Doc doc) async {
    var f = File(repo.storedPath(doc));
    if (!await f.exists()) {
      var bytes = await api.fetchDocumentFile(doc.remoteId ?? doc.id);
      if (doc.e2ee) bytes = await e2ee.decrypt(bytes); // 服务器密文 → 明文
      await repo.saveDocFile(doc, bytes);
      f = File(repo.storedPath(doc));
      if (!await f.exists()) throw ApiException('文件尚未同步到本机');
    }
    if (!doc.isSensitive) return f.path;
    final blob = await f.readAsBytes();
    final clear = await crypto.decryptFile(Uint8List.fromList(blob));
    final ext = doc.isPdf ? 'pdf' : 'webp';
    final tmp = File(p.join(repo.cacheDir, 'view_${doc.id}.$ext'));
    await tmp.writeAsBytes(clear, flush: true);
    return tmp.path;
  }

  // ---------- 证书 ----------

  Future<void> addCert(Cert cert) async {
    await repo.addCert(cert);
    await _reloadCerts();
    notifyListeners();
    unawaited(sync());
  }

  Future<void> updateCert(Cert cert) async {
    final op = cert.pendingOp == 'create' ? 'create' : 'update';
    await repo.updateCert(cert.copyWith(pendingOp: op));
    await _reloadCerts();
    notifyListeners();
    unawaited(sync());
  }

  Future<void> deleteCert(String id) async {
    final cert = certs.where((c) => c.id == id).firstOrNull;
    if (cert != null && cert.pendingOp == 'create') {
      await repo.deleteCert(id);
    } else if (cert != null) {
      await repo.updateCert(cert.copyWith(pendingOp: 'delete'));
    } else {
      await repo.deleteCert(id);
    }
    await _reloadCerts();
    notifyListeners();
    unawaited(sync());
  }

  Future<void> _reloadCerts() async {
    certs = await repo.loadCerts();
  }

  Future<void> recordExport(
    String keys,
    String fileName,
    int size, {
    String? verifyCode,
    String? sha256,
    String? manifestSummary,
    String? watermarkText,
  }) async {
    await repo.addExportRecord(
      keys,
      fileName,
      size,
      verifyCode: verifyCode,
      sha256: sha256,
      manifestSummary: manifestSummary,
      watermarkText: watermarkText,
    );
    exportRecords = await repo.loadExports();
    notifyListeners();

    if (loggedIn && online) {
      api
          .postExportRecord(
            categoryKeys: keys.split(','),
            fileName: fileName,
            size: size,
            verifyCode: verifyCode,
            sha256: sha256,
            manifestSummary: manifestSummary,
            watermarkText: watermarkText,
          )
          .catchError((_) {});
    }
  }

  // ---------- 统计 ----------

  List<Doc> docsOfMain(String mainKey) =>
      docs.where((d) => d.mainKey == mainKey).toList();

  int countOfMain(String mainKey) => docsOfMain(mainKey).length;

  int countOfLeaf(String leafKey) =>
      docs.where((d) => d.categoryKey == leafKey).length;

  int get completedCategories =>
      kCategoryTree.where((m) => docs.any((d) => d.mainKey == m.key)).length;

  int get completionPercent =>
      (completedCategories * 100 / kCategoryTree.length).round();

  int get encryptedCount => docs.where((d) => d.isSensitive).length;

  int get storageUsed => docs.fold(0, (sum, d) => sum + d.size);

  List<Doc> recentDocs({int n = 6}) {
    final sorted = [...docs]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return sorted.take(n).toList();
  }

  List<Doc> get sensitiveDocs => docs.where((d) => d.isSensitive).toList();

  Cert? certOfDoc(Doc d) {
    final i = certs.indexWhere((c) => c.documentId == d.id);
    return i >= 0 ? certs[i] : null;
  }

  Doc? docOfCert(Cert c) => c.documentId == null
      ? null
      : docs.where((d) => d.id == c.documentId).firstOrNull;

  // ---------- 注销账号 ----------

  /// 注销云端账号：服务端删除全部数据 + 清空本地镜像
  Future<void> deleteAccountOnServer(String password) async {
    await api.deleteAccount(password);
    await logoutAccount();
  }

  @override
  void dispose() {
    _connSub?.cancel();
    _retryTimer?.cancel();
    super.dispose();
  }
}

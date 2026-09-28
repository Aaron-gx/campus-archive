import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:path/path.dart' as p;

import 'format.dart';
import 'models.dart';

/// 网页版（campus-archive）API 客户端：
/// - 与浏览器共用同一套 httpOnly Cookie 会话（session / sensitive_ok）
/// - 一个账号，App 与网页数据完全一致
class ApiException implements Exception {
  final String message;
  final String? code;
  ApiException(this.message, [this.code]);

  bool get needSensitiveVerify => code == 'SENSITIVE_VERIFY_REQUIRED';

  @override
  String toString() => message;
}

class RemoteAccount {
  final String nickname;
  final String school;
  final String maskedAccount;
  final String? email;
  final int createdAt;
  final int documentCount;
  final int certificateCount;
  final int storageUsed;

  RemoteAccount({
    required this.nickname,
    required this.school,
    required this.maskedAccount,
    this.email,
    required this.createdAt,
    required this.documentCount,
    required this.certificateCount,
    required this.storageUsed,
  });
}

class ApiClient {
  String baseUrl;
  final _cookies = <String, String>{};
  http.Client? _client;

  /// 服务器分类 id → 固定 key（fetchCategoryIdMap 时缓存，用于反查）
  final _categoryKeyById = <String, String>{};

  ApiClient({this.baseUrl = ''});

  http.Client get _http => _client ??= http.Client();

  void clearSession() {
    _cookies.clear();
    _client?.close();
    _client = null;
  }

  /// 会话持久化（重启免登录；session 有效期 30 天）
  String exportCookies() => _cookies.entries.map((e) => '${e.key}=${e.value}').join('\n');

  void restoreCookies(String? saved) {
    if (saved == null || saved.isEmpty) return;
    for (final line in saved.split('\n')) {
      final i = line.indexOf('=');
      if (i > 0) _cookies[line.substring(0, i)] = line.substring(i + 1);
    }
  }

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  // ---------- Cookie ----------

  void _saveCookies(http.BaseResponse resp) {
    // dart:http 将多个 Set-Cookie 合并为逗号分隔字符串
    final raw = resp.headers['set-cookie'];
    if (raw == null) return;
    for (final m in RegExp(r'(?:^|,\s*)([A-Za-z_]+)=([^;]*)').allMatches(raw)) {
      final name = m.group(1)!;
      final value = m.group(2)!;
      if (value.isEmpty || value == 'deleted') {
        _cookies.remove(name);
      } else {
        _cookies[name] = value;
      }
    }
  }

  Map<String, String> get _cookieHeader {
    if (_cookies.isEmpty) return {};
    return {
      'cookie': _cookies.entries.map((e) => '${e.key}=${e.value}').join('; '),
    };
  }

  Map<String, String> _jsonHeaders() => {
        'content-type': 'application/json',
        ..._cookieHeader,
      };

  // ---------- 通用请求 ----------

  Future<Map<String, dynamic>> _getJson(String path,
      {Map<String, String>? query}) async {
    try {
      final resp = await _http
          .get(_u(path).replace(queryParameters: query), headers: _cookieHeader);
      _saveCookies(resp);
      return _decodeText(resp.statusCode, resp.body);
    } on SocketException {
      throw ApiException('无法连接服务器，请检查地址与网络');
    }
  }

  Future<Map<String, dynamic>> _postJson(String path,
      [Object? body, String method = 'post']) async {
    try {
      final req = http.Request(method.toUpperCase(), _u(path));
      req.headers.addAll(_jsonHeaders());
      if (body != null) req.body = jsonEncode(body);
      final resp = await _http.send(req);
      _saveCookies(resp);
      final text = await resp.stream.bytesToString();
      return _decodeText(resp.statusCode, text);
    } on SocketException {
      throw ApiException('无法连接服务器，请检查地址与网络');
    }
  }

  Future<Map<String, dynamic>> _decodeStream(http.StreamedResponse resp) async {
    final text = await resp.stream.bytesToString();
    return _decodeText(resp.statusCode, text);
  }

  Map<String, dynamic> _decodeText(int status, String text) {
    Map<String, dynamic> json;
    try {
      json = jsonDecode(text) as Map<String, dynamic>;
    } catch (_) {
      if (status >= 400) throw ApiException('服务器错误（HTTP $status）');
      throw ApiException('服务器响应异常');
    }
    if (status == 403 && json['code'] == 'SENSITIVE_VERIFY_REQUIRED') {
      throw ApiException('需要验证身份', 'SENSITIVE_VERIFY_REQUIRED');
    }
    if (status >= 400) {
      throw ApiException((json['error'] as String?) ?? '请求失败（HTTP $status）');
    }
    return json;
  }

  // ---------- 认证 ----------

  Future<void> register({
    required String account,
    required String password,
    required String nickname,
    String school = '',
  }) async {
    await _postJson('/api/auth/register', {
      'account': account,
      'password': password,
      'nickname': nickname,
      'school': school,
    });
  }

  Future<void> login(String account, String password) async {
    await _postJson('/api/auth/login', {
      'account': account,
      'password': password,
    });
  }

  Future<void> logout() async {
    try {
      await _postJson('/api/auth/logout');
    } finally {
      clearSession();
    }
  }

  /// 已登录？（用账户接口探测会话有效性；响应为 {user: {...}} 包裹）
  Future<RemoteAccount> getAccount() async {
    final j = await _getJson('/api/account');
    final u = (j['user'] as Map<String, dynamic>?) ?? j;
    return RemoteAccount(
      nickname: u['nickname'] as String? ?? '同学',
      school: u['school'] as String? ?? '',
      maskedAccount: u['phone'] as String? ?? u['email'] as String? ?? '',
      email: u['email'] as String?,
      createdAt: _parseDate(u['createdAt']),
      documentCount: u['documentCount'] as int? ?? 0,
      certificateCount: u['certificateCount'] as int? ?? 0,
      storageUsed: u['storageUsed'] as int? ?? 0,
    );
  }

  Future<void> updateAccount({String? nickname, String? school}) =>
      _postJson('/api/account', {
        if (nickname != null) 'nickname': nickname,
        if (school != null) 'school': school,
      }, 'patch');

  Future<void> changePassword(String oldPassword, String newPassword) =>
      _postJson('/api/account', {
        'oldPassword': oldPassword,
        'newPassword': newPassword,
      }, 'put');

  Future<void> deleteAccount(String password) =>
      _postJson('/api/account', {'password': password, 'confirm': '注销'},
          'delete');

  /// 敏感二次验证：成功后服务端发 10 分钟 sensitive_ok Cookie
  Future<int> sensitiveVerify(String password) async {
    final j = await _postJson('/api/auth/sensitive-verify', {'password': password});
    return (j['expiresIn'] as int?) ?? 600;
  }

  Future<bool> sensitiveGranted() async {
    try {
      final j = await _getJson('/api/auth/sensitive-verify');
      return j['granted'] == true;
    } on ApiException {
      return false;
    }
  }

  /// E2EE 密钥托管：返回 (salt, wrappedKey)；未启用返回 null
  Future<(String, String)?> getE2eeSetup() async {
    final j = await _getJson('/api/e2ee/setup');
    if (j['enabled'] != true) return null;
    final salt = j['salt'] as String?;
    final wrapped = j['wrappedKey'] as String?;
    if (salt == null || wrapped == null) return null;
    return (salt, wrapped);
  }

  Future<void> putE2eeSetup(String salt, String wrappedKey) =>
      _postJson('/api/e2ee/setup', {'salt': salt, 'wrappedKey': wrappedKey}, 'put');

  // ---------- 分类（服务器 id ↔ 固定 key 映射） ----------

  Future<Map<String, String>> fetchCategoryIdMap() async {
    final j = await _getJson('/api/categories');
    final map = <String, String>{};
    for (final main in j['categories'] as List) {
      final m = main as Map<String, dynamic>;
      for (final child in m['children'] as List) {
        final c = child as Map<String, dynamic>;
        map[c['key'] as String] = c['id'] as String;
        _categoryKeyById[c['id'] as String] = c['key'] as String;
      }
    }
    return map;
  }

  // ---------- 文档 ----------

  Future<List<Doc>> fetchDocuments({String? categoryKey, String? q}) async {
    final j = await _getJson('/api/documents', query: {
      if (categoryKey != null) 'categoryKey': categoryKey,
      if (q != null && q.isNotEmpty) 'q': q,
    });
    return [
      for (final d in j['documents'] as List) _docFromRemote(d as Map<String, dynamic>)
    ];
  }

  Doc _docFromRemote(Map<String, dynamic> d) {
    final cat = d['category'] as Map<String, dynamic>?;
    final key = cat?['key'] as String?;
    // 分类解析兜底：响应可能不带 category（如上传接口），或只带主分类。
    // 任何解析失败都不应导致崩溃——先查 key，再按 categoryId 反查，最后留空。
    var categoryKey = '';
    final node = key == null ? null : findCategory(key);
    if (node != null && node.isLeaf) {
      categoryKey = node.key;
    } else if (node != null) {
      categoryKey = node.children.first.key;
    } else {
      final cid = d['categoryId'] as String?;
      categoryKey = _categoryKeyById[cid] ?? '';
    }
    return Doc(
      id: d['id'] as String,
      categoryKey: categoryKey,
      e2ee: d['e2ee'] == true,
      title: stripSideSuffix(d['title'] as String? ?? ''),
      fileName: d['fileName'] as String? ?? '',
      storedName: '',
      mime: d['mimeType'] as String? ?? 'image/webp',
      size: d['size'] as int? ?? 0,
      isSensitive: d['isSensitive'] == true,
      note: d['note'] as String?,
      groupId: d['groupId'] as String?,
      side: d['side'] as String?,
      sideOrder: d['sideOrder'] as int?,
      meta: d['meta'] as String?,
      createdAt: _parseDate(d['createdAt']),
      updatedAt: _parseDate(d['updatedAt']),
    );
  }

  /// 上传文档：[filePath] 与 [fileBytes] 二选一（离线队列推送时传字节，
  /// 避免敏感文件先落盘为明文临时文件）
  Future<Doc> uploadDocument({
    required String fileName,
    required String categoryId,
    required String title,
    String? note,
    bool isSensitive = false,
    String? groupId,
    String? side,
    int? sideOrder,
    String? meta,
    bool withCertificate = false,
    String? certName,
    String? certOrg,
    String? certLevel,
    int? certAwardedAt,
    String? filePath,
    Uint8List? fileBytes,
    bool e2ee = false,
    String? contentMime,
  }) async {
    final req = http.MultipartRequest('POST', _u('/api/documents'));
    req.headers.addAll(_cookieHeader);
    if (e2ee) req.headers['x-e2ee'] = '1'; // 正文是客户端加密的信封
    req.fields['categoryId'] = categoryId;
    final cleanTitle = stripSideSuffix(title);
    req.fields['title'] = cleanTitle.isNotEmpty ? cleanTitle : title;
    req.fields['isSensitive'] = isSensitive ? 'true' : 'false';
    if (note != null && note.isNotEmpty) req.fields['note'] = note;
    if (groupId != null && groupId.isNotEmpty) req.fields['groupId'] = groupId;
    if (side != null && side.isNotEmpty) req.fields['side'] = side;
    if (sideOrder != null) req.fields['sideOrder'] = sideOrder.toString();
    if (meta != null && meta.isNotEmpty) req.fields['meta'] = meta;
    req.fields['withCertificate'] = withCertificate ? 'true' : 'false';
    if (withCertificate) {
      req.fields['certName'] = certName ?? title;
      req.fields['certOrg'] = certOrg ?? '';
      req.fields['certLevel'] = certLevel ?? '其他';
      if (certAwardedAt != null) {
        final dt = DateTime.fromMillisecondsSinceEpoch(certAwardedAt);
        req.fields['certAwardedAt'] = dt.toUtc().toIso8601String();
      }
    }
    final mime = contentMime ?? mimeOf(fileName);
    if (fileBytes != null) {
      req.files.add(http.MultipartFile.fromBytes(
        'file',
        fileBytes,
        filename: fileName,
        contentType: MediaType.parse(mime),
      ));
    } else {
      req.files.add(await http.MultipartFile.fromPath(
        'file',
        filePath!,
        filename: fileName,
        contentType: MediaType.parse(mime),
      ));
    }
    final resp = await _http.send(req);
    final j = await _decodeStream(resp);
    return _docFromRemote((j['document'] as Map<String, dynamic>?) ?? j);
  }

  Future<void> updateDocument(String id,
      {String? title, String? note, String? categoryId, String? side, int? sideOrder}) {
    return _postJson('/api/documents/$id', {
      if (title != null) 'title': stripSideSuffix(title),
      if (note != null) 'note': note,
      if (categoryId != null) 'categoryId': categoryId,
      if (side != null) 'side': side,
      if (sideOrder != null) 'sideOrder': sideOrder,
    }, 'patch');
  }

  Future<void> deleteDocument(String id) =>
      _postJson('/api/documents/$id', null, 'delete');

  /// 下载文件字节（敏感未验证时抛 SENSITIVE_VERIFY_REQUIRED）
  Future<Uint8List> fetchDocumentFile(String id) async {
    final resp = await _http.get(
      _u('/api/documents/$id/file'),
      headers: {..._cookieHeader, 'accept': '*/*'},
    );
    if (resp.statusCode == 403) {
      try {
        final j = jsonDecode(resp.body) as Map<String, dynamic>;
        if (j['code'] == 'SENSITIVE_VERIFY_REQUIRED') {
          throw ApiException('需要验证身份', 'SENSITIVE_VERIFY_REQUIRED');
        }
      } catch (e) {
        if (e is ApiException) rethrow;
      }
    }
    if (resp.statusCode != 200) {
      throw ApiException('文件获取失败（HTTP ${resp.statusCode}）');
    }
    _saveCookies(resp);
    return resp.bodyBytes;
  }

  // ---------- 证书 ----------

  Future<List<Cert>> fetchCertificates({String? level, String? q}) async {
    final j = await _getJson('/api/certificates', query: {
      if (level != null && level.isNotEmpty) 'level': level,
      if (q != null && q.isNotEmpty) 'q': q,
    });
    return [
      for (final c in j['certificates'] as List)
        Cert(
          id: c['id'] as String,
          name: c['name'] as String,
          org: c['org'] as String,
          level: c['level'] as String,
          awardedAt: _parseDate(c['awardedAt']),
          note: c['note'] as String?,
          documentId: c['documentId'] as String?,
        )
    ];
  }

  /// 新建证书：返回服务器生成的完整记录（含 id，用于回填本地镜像）
  Future<Cert> addCertificate(Cert cert) async {
    final j = await _postJson('/api/certificates', {
      'name': cert.name,
      'org': cert.org,
      'level': cert.level,
      'awardedAt': _isoDate(cert.awardedAt),
      if (cert.note != null) 'note': cert.note,
      if (cert.documentId != null) 'documentId': cert.documentId,
    });
    final c = j['certificate'] as Map<String, dynamic>? ?? {};
    return Cert(
      id: c['id'] as String? ?? cert.id,
      name: c['name'] as String? ?? cert.name,
      org: c['org'] as String? ?? cert.org,
      level: c['level'] as String? ?? cert.level,
      awardedAt: _parseDate(c['awardedAt']) != 0
          ? _parseDate(c['awardedAt'])
          : cert.awardedAt,
      note: (c['note'] as String?) ?? cert.note,
      documentId: (c['documentId'] as String?) ?? cert.documentId,
    );
  }

  Future<void> updateCertificate(Cert cert) =>
      _postJson('/api/certificates/${cert.id}', {
        'name': cert.name,
        'org': cert.org,
        'level': cert.level,
        'awardedAt': _isoDate(cert.awardedAt),
        if (cert.note != null) 'note': cert.note,
        if (cert.documentId != null) 'documentId': cert.documentId,
      }, 'patch');

  Future<void> deleteCertificate(String id) =>
      _postJson('/api/certificates/$id', null, 'delete');

  // ---------- 导出 ----------

  Future<({Uint8List bytes, String fileName})> exportZip(
      List<String> mainKeys, bool includeCertificates) async {
    final resp = await _http.post(
      _u('/api/export'),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'categoryKeys': mainKeys,
        'includeCertificates': includeCertificates,
      }),
    );
    if (resp.statusCode == 403) {
      final j = jsonDecode(resp.body) as Map<String, dynamic>;
      if (j['code'] == 'SENSITIVE_VERIFY_REQUIRED') {
        throw ApiException('需要验证身份', 'SENSITIVE_VERIFY_REQUIRED');
      }
    }
    if (resp.statusCode != 200) {
      try {
        final j = jsonDecode(resp.body) as Map<String, dynamic>;
        throw ApiException(j['error'] as String? ?? '导出失败');
      } catch (e) {
        if (e is ApiException) rethrow;
        throw ApiException('导出失败');
      }
    }
    _saveCookies(resp);
    var name = '电子档案包_${fmtStamp(DateTime.now().millisecondsSinceEpoch)}.zip';
    final cd = resp.headers['content-disposition'];
    if (cd != null) {
      final m = RegExp("filename\\*=UTF-8''([^;]+)").firstMatch(cd);
      if (m != null) {
        name = Uri.decodeComponent(m.group(1)!);
      }
    }
    return (bytes: resp.bodyBytes, fileName: name);
  }

  /// 在服务器记录导出历史与存证凭证
  Future<void> postExportRecord({
    required List<String> categoryKeys,
    required String fileName,
    required int size,
    String? verifyCode,
    String? sha256,
    String? manifestSummary,
    String? watermarkText,
  }) =>
      _postJson('/api/export/record', {
        'categoryKeys': categoryKeys,
        'fileName': fileName,
        'size': size,
        if (verifyCode != null) 'verifyCode': verifyCode,
        if (sha256 != null) 'sha256': sha256,
        if (manifestSummary != null) 'manifestSummary': manifestSummary,
        if (watermarkText != null) 'watermarkText': watermarkText,
      });

  Future<List<ExportRecord>> fetchExportRecords() async {
    final j = await _getJson('/api/export');
    return [
      for (final r in (j['records'] as List? ?? []))
        ExportRecord(
          id: r['id'] as String,
          categoryKeys: r['categoryKeys'] as String? ?? '',
          fileName: r['fileName'] as String? ?? '',
          size: r['size'] as int? ?? 0,
          verifyCode: r['verifyCode'] as String?,
          sha256: r['sha256'] as String?,
          manifestSummary: r['manifestSummary'] as String?,
          watermarkText: r['watermarkText'] as String?,
          createdAt: _parseDate(r['createdAt']),
        )
    ];
  }

  // ---------- 工具 ----------

  static String mimeOf(String fileName) {
    final ext = p.extension(fileName).toLowerCase();
    return switch (ext) {
      '.pdf' => 'application/pdf',
      '.png' => 'image/png',
      '.webp' => 'image/webp',
      '.heic' => 'image/heic',
      '.heif' => 'image/heif',
      '.jpg' || '.jpeg' => 'image/jpeg',
      _ => 'application/octet-stream',
    };
  }

  static int _parseDate(dynamic v) {
    if (v is int) return v;
    if (v is String) return DateTime.tryParse(v)?.millisecondsSinceEpoch ?? 0;
    return 0;
  }

  static String _isoDate(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

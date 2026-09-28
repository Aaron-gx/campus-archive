import 'dart:ui' show Color;

import '../theme.dart';
import 'format.dart' show kSideSuffixRegex, stripSideSuffix;

/// 用户档案（本地单用户，替代网页版的注册登录）
class Profile {
  final String nickname;
  final String school;
  final String passwordHash; // hex
  final String passwordSalt; // hex
  final int createdAt; // ms

  const Profile({
    required this.nickname,
    required this.school,
    required this.passwordHash,
    required this.passwordSalt,
    required this.createdAt,
  });

  Map<String, Object?> toRow() => {
    'nickname': nickname,
    'school': school,
    'password_hash': passwordHash,
    'password_salt': passwordSalt,
    'created_at': createdAt,
  };

  static Profile fromRow(Map<String, Object?> r) => Profile(
    nickname: r['nickname'] as String,
    school: (r['school'] as String?) ?? '',
    passwordHash: r['password_hash'] as String,
    passwordSalt: r['password_salt'] as String,
    createdAt: r['created_at'] as int,
  );
}

/// 分类节点：5 大分类 + 21 子类（固定目录模板）
class CategoryNode {
  final String key;
  final String name;
  final String icon; // emoji
  final String en; // 目录编号用的英文名
  final bool sensitive;
  final String? parent;
  final int order;
  final List<CategoryNode> children;

  const CategoryNode({
    required this.key,
    required this.name,
    required this.icon,
    required this.en,
    this.sensitive = false,
    this.parent,
    this.order = 0,
    this.children = const [],
  });

  bool get isLeaf => children.isEmpty;

  Color get accent => AppColors.catAccents[parent ?? key] ?? AppColors.ink;
  Color get accentSoft =>
      AppColors.catAccentsSoft[parent ?? key] ?? AppColors.paperDark;
}

const kCategoryTree = <CategoryNode>[
  CategoryNode(
    key: 'identity',
    name: '身份证件',
    icon: '🪪',
    en: 'IDENTITY',
    sensitive: true,
    order: 1,
    children: [
      CategoryNode(key: 'identity-idcard', name: '身份证', icon: '🪪', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-student', name: '学生证', icon: '🎓', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-household', name: '户口本', icon: '📔', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-residence', name: '居住证', icon: '🏠', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-passport', name: '护照/港澳台通行证', icon: '🛂', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-license', name: '驾驶证', icon: '🚗', en: '', parent: 'identity'),
      CategoryNode(key: 'identity-bankcard', name: '银行卡', icon: '💳', en: '', parent: 'identity'),
    ],
  ),
  CategoryNode(
    key: 'certificate',
    name: '获奖证书',
    icon: '🏆',
    en: 'CERTIFICATES',
    order: 2,
    children: [
      CategoryNode(key: 'certificate-award', name: '获奖证书', icon: '🏅', en: '', parent: 'certificate'),
      CategoryNode(key: 'certificate-qualify', name: '资格证书', icon: '📜', en: '', parent: 'certificate'),
      CategoryNode(key: 'certificate-level', name: '等级证书', icon: '📝', en: '', parent: 'certificate'),
      CategoryNode(key: 'certificate-graduation', name: '毕业/学位证书', icon: '🎓', en: '', parent: 'certificate'),
    ],
  ),
  CategoryNode(
    key: 'experience',
    name: '经历证明',
    icon: '📄',
    en: 'EXPERIENCE',
    order: 3,
    children: [
      CategoryNode(key: 'experience-intern', name: '实习证明', icon: '💼', en: '', parent: 'experience'),
      CategoryNode(key: 'experience-volunteer', name: '志愿服务证明', icon: '❤️', en: '', parent: 'experience'),
      CategoryNode(key: 'experience-social', name: '社会实践', icon: '🌾', en: '', parent: 'experience'),
      CategoryNode(key: 'experience-club', name: '社团/学生工作', icon: '🤝', en: '', parent: 'experience'),
    ],
  ),
  CategoryNode(
    key: 'photo',
    name: '活动照片',
    icon: '📸',
    en: 'PHOTOS',
    order: 4,
    children: [
      CategoryNode(key: 'photo-competition', name: '比赛/竞赛现场', icon: '🥇', en: '', parent: 'photo'),
      CategoryNode(key: 'photo-volunteer', name: '志愿活动', icon: '🧡', en: '', parent: 'photo'),
      CategoryNode(key: 'photo-ceremony', name: '颁奖典礼', icon: '🎤', en: '', parent: 'photo'),
      CategoryNode(key: 'photo-daily', name: '日常记录', icon: '📷', en: '', parent: 'photo'),
    ],
  ),
  CategoryNode(
    key: 'portfolio',
    name: '个人作品集',
    icon: '🎨',
    en: 'PORTFOLIO',
    order: 5,
    children: [
      CategoryNode(key: 'portfolio-design', name: '设计作品', icon: '🖌️', en: '', parent: 'portfolio'),
      CategoryNode(key: 'portfolio-code', name: '代码/项目', icon: '💻', en: '', parent: 'portfolio'),
      CategoryNode(key: 'portfolio-writing', name: '文章/写作', icon: '✍️', en: '', parent: 'portfolio'),
      CategoryNode(key: 'portfolio-other', name: '其他作品', icon: '📦', en: '', parent: 'portfolio'),
    ],
  ),
];

CategoryNode mainCategoryOf(String leafOrMainKey) {
  for (final m in kCategoryTree) {
    if (m.key == leafOrMainKey) return m;
    for (final c in m.children) {
      if (c.key == leafOrMainKey) return m;
    }
  }
  return kCategoryTree.first;
}

CategoryNode? findCategory(String key) {
  for (final m in kCategoryTree) {
    if (m.key == key) return m;
    for (final c in m.children) {
      if (c.key == key) return c;
    }
  }
  return null;
}

const kCertificateLevels = <String>['国际级', '国家级', '省级', '市级', '校级', '院级', '其他'];
const kMaxFileSize = 20 * 1024 * 1024; // 20MB

/// 归档文件（扫描件 / 照片 / PDF）
class Doc {
  final String id;
  final String categoryKey; // 叶子子类
  final String title;
  final String fileName; // 原始文件名
  final String storedName; // 存储名（uuid[.enc].webp/.pdf）
  final String mime; // image/webp | application/pdf
  final int size; // 存储字节
  final bool isSensitive;
  final bool e2ee; // 端到端加密（账号模式，客户端持有密钥）
  final String? note;
  final String? groupId; // 证件材料组（正反面同组）
  final String? side; // 正面 / 反面 / 主页 / 副页
  final int? sideOrder; // 排序序号（0=正面/主页）
  final String? meta; // 结构化识别字段
  final int createdAt;
  final int updatedAt;
  final String? remoteId; // 服务器端 id（已同步后回填）
  final String? pendingOp; // null=已同步；'create'|'update'|'delete'=待同步

  const Doc({
    required this.id,
    required this.categoryKey,
    required this.title,
    required this.fileName,
    required this.storedName,
    required this.mime,
    required this.size,
    required this.isSensitive,
    this.e2ee = false,
    this.note,
    this.groupId,
    this.side,
    this.sideOrder,
    this.meta,
    required this.createdAt,
    required this.updatedAt,
    this.remoteId,
    this.pendingOp,
  });

  bool get isPdf => mime == 'application/pdf';
  String get mainKey => mainCategoryOf(categoryKey).key;
  bool get pendingSync => pendingOp != null;

  Map<String, Object?> toRow() => {
    'id': id,
    'category_key': categoryKey,
    'title': title,
    'file_name': fileName,
    'stored_name': storedName,
    'mime': mime,
    'size': size,
    'is_sensitive': isSensitive ? 1 : 0,
    'e2ee': e2ee ? 1 : 0,
    'note': note,
    'group_id': groupId,
    'side': side,
    'side_order': sideOrder,
    'meta': meta,
    'created_at': createdAt,
    'updated_at': updatedAt,
    'remote_id': remoteId,
    'pending_op': pendingOp,
  };

  static Doc fromRow(Map<String, Object?> r) => Doc(
    id: r['id'] as String,
    categoryKey: r['category_key'] as String,
    title: r['title'] as String,
    fileName: r['file_name'] as String,
    storedName: r['stored_name'] as String,
    mime: r['mime'] as String,
    size: r['size'] as int,
    isSensitive: (r['is_sensitive'] as int) == 1,
    e2ee: ((r['e2ee'] as int?) ?? 0) == 1,
    note: r['note'] as String?,
    groupId: r['group_id'] as String?,
    side: r['side'] as String?,
    sideOrder: r['side_order'] as int?,
    meta: r['meta'] as String?,
    createdAt: r['created_at'] as int,
    updatedAt: r['updated_at'] as int,
    remoteId: r['remote_id'] as String?,
    pendingOp: r['pending_op'] as String?,
  );

  Doc copyWith({
    String? id,
    String? title,
    String? note,
    String? categoryKey,
    String? groupId,
    String? side,
    int? sideOrder,
    String? meta,
    int? updatedAt,
    String? remoteId,
    String? pendingOp,
    bool? e2ee,
  }) => Doc(
    id: id ?? this.id,
    categoryKey: categoryKey ?? this.categoryKey,
    title: title ?? this.title,
    fileName: fileName,
    storedName: storedName,
    mime: mime,
    size: size,
    isSensitive: isSensitive,
    e2ee: e2ee ?? this.e2ee,
    note: note ?? this.note,
    groupId: groupId ?? this.groupId,
    side: side ?? this.side,
    sideOrder: sideOrder ?? this.sideOrder,
    meta: meta ?? this.meta,
    createdAt: createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    remoteId: remoteId ?? this.remoteId,
    pendingOp: pendingOp,
  );
}

/// 证书总目（结构化记录，可不关联文件）
class Cert {
  final String id;
  final String name;
  final String org;
  final String level;
  final int awardedAt;
  final String? note;
  final String? documentId;
  final String? remoteId; // 服务器端 id（已同步后回填）
  final String? pendingOp; // null=已同步；'create'|'update'|'delete'=待同步

  const Cert({
    required this.id,
    required this.name,
    required this.org,
    required this.level,
    required this.awardedAt,
    this.note,
    this.documentId,
    this.remoteId,
    this.pendingOp,
  });

  bool get pendingSync => pendingOp != null;

  Map<String, Object?> toRow() => {
    'id': id,
    'name': name,
    'org': org,
    'level': level,
    'awarded_at': awardedAt,
    'note': note,
    'document_id': documentId,
    'created_at': awardedAt, // 保留字段，列表按获得时间排序
    'remote_id': remoteId,
    'pending_op': pendingOp,
  };

  static Cert fromRow(Map<String, Object?> r) => Cert(
    id: r['id'] as String,
    name: r['name'] as String,
    org: r['org'] as String,
    level: r['level'] as String,
    awardedAt: (r['awarded_at'] as int?) ?? (r['created_at'] as int? ?? 0),
    note: r['note'] as String?,
    documentId: r['document_id'] as String?,
    remoteId: r['remote_id'] as String?,
    pendingOp: r['pending_op'] as String?,
  );

  Cert copyWith({
    String? documentId,
    String? remoteId,
    String? pendingOp,
  }) => Cert(
    id: id,
    name: name,
    org: org,
    level: level,
    awardedAt: awardedAt,
    note: note,
    documentId: documentId ?? this.documentId,
    remoteId: remoteId ?? this.remoteId,
    pendingOp: pendingOp,
  );
}

/// 导出历史
class ExportRecord {
  final String id;
  final String categoryKeys; // 逗号分隔
  final String fileName;
  final int size;
  final String? verifyCode; // 16 位存证码（CA-YYYYMM-XXXX-XXXX）
  final String? sha256; // 存证文件指纹
  final String? manifestSummary; // 清单摘要
  final String? watermarkText; // 防伪水印文字
  final int createdAt;

  const ExportRecord({
    required this.id,
    required this.categoryKeys,
    required this.fileName,
    required this.size,
    this.verifyCode,
    this.sha256,
    this.manifestSummary,
    this.watermarkText,
    required this.createdAt,
  });

  Map<String, Object?> toRow() => {
    'id': id,
    'category_keys': categoryKeys,
    'file_name': fileName,
    'size': size,
    'verify_code': verifyCode,
    'sha256': sha256,
    'manifest_summary': manifestSummary,
    'watermark_text': watermarkText,
    'created_at': createdAt,
  };

  static ExportRecord fromRow(Map<String, Object?> r) => ExportRecord(
    id: r['id'] as String,
    categoryKeys: r['category_keys'] as String,
    fileName: r['file_name'] as String,
    size: (r['size'] as int?) ?? 0,
    verifyCode: r['verify_code'] as String?,
    sha256: r['sha256'] as String?,
    manifestSummary: r['manifest_summary'] as String?,
    watermarkText: r['watermark_text'] as String?,
    createdAt: r['created_at'] as int,
  );
}

/// 调档记录（敏感文件的查看 / 导出审计）
class AccessLog {
  final String id;
  final String action; // view | export
  final String docTitle;
  final int createdAt;

  const AccessLog({
    required this.id,
    required this.action,
    required this.docTitle,
    required this.createdAt,
  });

  static AccessLog fromRow(Map<String, Object?> r) => AccessLog(
    id: r['id'] as String,
    action: r['action'] as String,
    docTitle: r['doc_title'] as String,
    createdAt: r['created_at'] as int,
  );
}

/// 证件材料逻辑组（一个证件包含正反面/主副页，在列表中合并为一张卡片展示）
class DocGroup {
  final String key;
  final String title; // 纯证件类型名称，已剥离面后缀
  final List<Doc> docs; // 组内文档，正面在前
  final Doc main; // 主文档
  final bool hasMultiple;

  const DocGroup({
    required this.key,
    required this.title,
    required this.docs,
    required this.main,
    required this.hasMultiple,
  });
}

final kFrontHintRegex = RegExp(r'正面|人像面|首页|主页|资料页|卡号面');

/// 证件分组算法（与网页端 groupDocs 保持 100% 一致）：
/// 优先按 groupId 聚合；历史未分配数据按同子分类下"去掉面后缀后的基础标题"自动配对
List<DocGroup> groupDocs(List<Doc> list) {
  final byGroup = <String, List<Doc>>{};
  final singles = <Doc>[];
  for (final d in list) {
    if (d.groupId != null && d.groupId!.isNotEmpty) {
      byGroup.putIfAbsent(d.groupId!, () => []).add(d);
    } else {
      singles.add(d);
    }
  }

  // 旧数据或未设 groupId 数据：同子分类下"基础标题"相同且带面后缀的 ≥2 条自动合成一组
  final legacy = <String, List<Doc>>{};
  final rest = <Doc>[];
  for (final d in singles) {
    if (kSideSuffixRegex.hasMatch(d.title)) {
      final k = '${d.categoryKey}:${stripSideSuffix(d.title)}';
      legacy.putIfAbsent(k, () => []).add(d);
    } else {
      rest.add(d);
    }
  }

  DocGroup makeGroup(String key, List<Doc> docsInGroup) {
    final sorted = List<Doc>.from(docsInGroup)
      ..sort((a, b) {
        final fa = a.sideOrder ?? (kFrontHintRegex.hasMatch(a.side ?? a.title) ? 0 : 1);
        final fb = b.sideOrder ?? (kFrontHintRegex.hasMatch(b.side ?? b.title) ? 0 : 1);
        if (fa != fb) return fa - fb;
        return a.createdAt.compareTo(b.createdAt);
      });
    return DocGroup(
      key: key,
      title: stripSideSuffix(sorted.first.title),
      docs: sorted,
      main: sorted.first,
      hasMultiple: sorted.length > 1,
    );
  }

  final groups = <DocGroup>[];
  byGroup.forEach((gid, arr) => groups.add(makeGroup(gid, arr)));
  legacy.forEach((k, arr) {
    if (arr.length >= 2) {
      groups.add(makeGroup('legacy:$k', arr));
    } else {
      rest.addAll(arr);
    }
  });
  for (final d in rest) {
    groups.add(makeGroup(d.id, [d]));
  }

  groups.sort((a, b) => b.main.createdAt.compareTo(a.main.createdAt));
  return groups;
}

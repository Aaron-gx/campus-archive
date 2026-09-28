/// 日期与体积格式化工具
String fmtDate(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}.${two(d.month)}.${two(d.day)}';
}

String fmtDateCn(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  return '${d.year}年${d.month}月${d.day}日';
}

String fmtMonth(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}.${two(d.month)}';
}

String fmtDateTime(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}.${two(d.month)}.${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}

String fmtStamp(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}${two(d.month)}${two(d.day)}_${two(d.hour)}${two(d.minute)}';
}

/// 相对时间：刚刚 / N分钟前 / N小时前 / N天前 / 上周 / 具体日期
String relTime(int ms) {
  final now = DateTime.now();
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  final diff = now.difference(d);
  if (diff.inMinutes < 1) return '刚刚';
  if (diff.inMinutes < 60) return '${diff.inMinutes} 分钟前';
  if (diff.inHours < 24) return '${diff.inHours} 小时前';
  if (diff.inDays == 1) return '昨天';
  if (diff.inDays < 7) return '${diff.inDays} 天前';
  if (diff.inDays < 14) return '上周';
  return fmtDate(ms);
}

String fmtSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// 档案袋建立天数（第 1 天起算）；createdAt 为 0（未知）时返回 null
int? daysSince(int ms) {
  if (ms <= 0) return null;
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  final now = DateTime.now();
  return now.difference(DateTime(d.year, d.month, d.day)).inDays + 1;
}

/// 证件材料面标签后缀正则（严格遵循 AGENTS.md 规范）
final kSideSuffixRegex = RegExp(
  r'[-·_\s]+(正面|反面|人像面|国徽面|主页|副页|首页|户主页|本人页|成员页|家庭成员页|父亲页|母亲页|配偶页|子女页|变动页|变动登记页|注册页|签注|签注面|签证页|信息面|签发信息面|个人信息面|个人信息页|资料页|卡号面|签名面)$',
);

/// 剥离正反面/页签后缀，确保标题始终为纯证件类型名称
String stripSideSuffix(String title) {
  return title.replaceAll(kSideSuffixRegex, '').trim();
}

/// 文件名 → 展示标题（去扩展名、去日期前缀、剥离面后缀）
String titleFromFileName(String name) {
  var t = name;
  final dot = t.lastIndexOf('.');
  if (dot > 0) t = t.substring(0, dot);
  t = t.replaceAll(RegExp(r'^\d{4}[-_.]?\d{1,2}[-_.]?\d{1,2}[_\- ]*'), '');
  t = t.replaceAll('_', ' ').trim();
  t = stripSideSuffix(t);
  if (t.isEmpty) t = name;
  return t;
}

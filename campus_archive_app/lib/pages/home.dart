import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/format.dart';
import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'category.dart';
import 'secure.dart';

/// 首页 · 概览：问候 / 完整度环 / 五大分类文件夹网格 / 最近更新
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  @override
  void initState() {
    super.initState();
    // 进首页：后台同步（推送待同步队列 + 拉取云端）并补下载缺失文件（fire-and-forget）
    Future.microtask(() {
      final store = context.read<AppStore>();
      store.sync().catchError((_) {});
      store.ensureFiles().catchError((_) {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final profile = store.displayProfile;
    final hour = DateTime.now().hour;
    final greet = hour < 11
        ? '早上好'
        : hour < 13
            ? '中午好'
            : hour < 18
                ? '下午好'
                : '晚上好';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        bottom: false,
        child: ResponsiveCenter(
          maxWidth: 860,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 110),
          children: [
            // 顶栏
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '$greet，${profile.nickname}',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        [
                          if (profile.school.isNotEmpty) profile.school,
                          if (daysSince(profile.createdAt) != null)
                            '档案袋已建立 ${daysSince(profile.createdAt)} 天',
                        ].join(' · '),
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ),
                const StampSeal(text: '简册', size: 44),
              ],
            ),
            const SizedBox(height: 18),

            // 完整度深色卡
            _CompletenessCard(store: store),
            const SizedBox(height: 24),

            // 五大分类
            const SectionLabel('五大分类'),
            LayoutBuilder(builder: (context, box) {
              // 宽屏（平板/横屏）自动加列，避免卡片被拉伸过大
              final cols = box.maxWidth >= 780
                  ? 4
                  : box.maxWidth >= 540
                      ? 3
                      : 2;
              return GridView.count(
                crossAxisCount: cols,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 0.92,
                children: [
                  for (final m in kCategoryTree) _FolderCard(main: m, store: store),
                ],
              );
            }),
            const SizedBox(height: 24),

            // 最近更新
            SectionLabel('最近更新', trailing: Text(
              '${store.docs.length} 项',
              style: const TextStyle(fontSize: 11, color: AppColors.inkFaint),
            )),
            if (store.docs.isEmpty)
              const DashedBox(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Text('🗂', style: TextStyle(fontSize: 32)),
                      SizedBox(height: 8),
                      Text('档案袋还是空的',
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.inkSoft)),
                      SizedBox(height: 4),
                      Text('点右下角 ＋ 归档第一份材料',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.inkFaint)),
                    ],
                  ),
                ),
              )
            else
              ...store.recentDocs(n: 5).map((d) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: IndexCard(
                      edge: mainCategoryOf(d.categoryKey).accent,
                      onTap: () => _openCategory(context, d.mainKey),
                      child: Row(
                        children: [
                          DocThumb(doc: d, store: store, size: 52),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  d.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 14.5,
                                      fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${relTime(d.createdAt)} · ${mainCategoryOf(d.categoryKey).name}',
                                  style: const TextStyle(
                                      fontSize: 11.5,
                                      color: AppColors.inkSoft),
                                ),
                              ],
                            ),
                          ),
                          StampTag(
                            d.isSensitive ? '加密' : '已归档',
                            solid: !d.isSensitive,
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

  void _openCategory(BuildContext context, String mainKey) {
    if (mainKey == 'identity') {
      pushFadeSlide(context, const SecurePage());
    } else {
      pushFadeSlide(context, CategoryPage(mainKey: mainKey));
    }
  }
}

/// 档案完整度深色卡（conic 环）
class _CompletenessCard extends StatelessWidget {
  final AppStore store;
  const _CompletenessCard({required this.store});

  @override
  Widget build(BuildContext context) {
    final percent = store.completionPercent;
    final done = store.completedCategories;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            height: 84,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: percent / 100),
              duration: const Duration(milliseconds: 800),
              curve: Curves.easeOutCubic,
              builder: (context, value, child) => CustomPaint(
                painter: _RingPainter(value),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${(value * 100).round()}%',
                        style: const TextStyle(
                          color: AppColors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                          fontFeatures: [FontFeature.tabularFigures()],
                        ),
                      ),
                      const Text(
                        '完整度',
                        style: TextStyle(
                            color: AppColors.gold,
                            fontSize: 10,
                            letterSpacing: 2),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '档案完整度',
                  style: TextStyle(
                    color: AppColors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  done >= 5
                      ? '五大分类已全部归档，继续保持'
                      : '已归档 $done / 5 个分类，还有 ${5 - done} 类待整理',
                  style: const TextStyle(
                      color: AppColors.white, fontSize: 12.5, height: 1.5),
                ),
                const SizedBox(height: 10),
                Text(
                  '${store.docs.length} 份材料 · ${store.certs.length} 条证书 · 已加密 ${store.encryptedCount} 份',
                  style: const TextStyle(
                      color: AppColors.gold, fontSize: 11, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final double progress;
  _RingPainter(this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 4;
    final track = Paint()
      ..color = AppColors.white.withOpacity(0.14)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5;
    final fill = Paint()
      ..color = AppColors.gold
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, track);
    canvas.drawArc(Rect.fromCircle(center: center, radius: radius),
        -math.pi / 2, 2 * math.pi * progress, false, fill);
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) => old.progress != progress;
}

/// 分类文件夹卡：顶部编号标签页 + 图标 + 计数 + 状态章
class _FolderCard extends StatelessWidget {
  final CategoryNode main;
  final AppStore store;
  const _FolderCard({required this.main, required this.store});

  @override
  Widget build(BuildContext context) {
    final count = store.countOfMain(main.key);
    final archived = count > 0;
    final no = main.order.toString().padLeft(2, '0');

    Widget body = GestureDetector(
      onTap: () {
        if (main.key == 'identity') {
          pushFadeSlide(context, const SecurePage());
        } else {
          pushFadeSlide(context, CategoryPage(mainKey: main.key));
        }
      },
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.line.withOpacity(0.8)),
          boxShadow: [
            BoxShadow(
              color: AppColors.ink.withOpacity(0.05),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 标签页（档案袋左上角折标）
            Container(
              margin: const EdgeInsets.only(top: 10, left: 12),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
              decoration: BoxDecoration(
                color: main.accent,
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(6),
                  bottomRight: Radius.circular(6),
                ),
              ),
              child: Text(
                '$no · ${main.name}',
                style: const TextStyle(
                  color: AppColors.white,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1,
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(main.icon, style: const TextStyle(fontSize: 22)),
                        const Spacer(),
                        StampSeal(
                          text: archived ? '已归档' : (main.key == 'photo' ? '待补充' : '整理中'),
                          solid: archived,
                          color: archived ? main.accent : AppColors.inkFaint,
                          size: 40,
                        ),
                      ],
                    ),
                    const Spacer(),
                    // 活动照片：缩略图预览
                    if (main.key == 'photo') ...[
                      _photoStrip(),
                      const SizedBox(height: 6),
                    ],
                    Text(
                      count == 0
                          ? '还没有材料'
                          : '$count ${main.key == 'photo' ? '张' : '项'}',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: archived ? main.accent : AppColors.inkFaint,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
    return body;
  }

  Widget _photoStrip() {
    final photos = store.docsOfMain('photo').take(3).toList();
    final total = store.countOfMain('photo');
    if (photos.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 30,
      child: Row(
        children: [
          for (var i = 0; i < photos.length; i++) ...[
            if (i > 0) const SizedBox(width: 4),
            photos[i].isSensitive
                ? Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: AppColors.ink,
                      borderRadius: BorderRadius.circular(5),
                    ),
                    child: const Icon(Icons.lock,
                        size: 14, color: AppColors.gold),
                  )
                : Builder(builder: (_) {
                    final path = store.thumbPath(photos[i]);
                    if (path == null) {
                      return Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: AppColors.paperDark,
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: const Icon(Icons.image_outlined,
                            size: 13, color: AppColors.inkFaint),
                      );
                    }
                    return ClipRRect(
                      borderRadius: BorderRadius.circular(5),
                      child: Image.file(
                        File(path),
                        width: 30,
                        height: 30,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                            width: 30,
                            height: 30,
                            color: AppColors.paperDark),
                      ),
                    );
                  }),
          ],
          if (total > 3)
            Padding(
              padding: const EdgeInsets.only(left: 6),
              child: Text(
                '+${total - 3}',
                style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.inkSoft,
                    fontFeatures: [FontFeature.tabularFigures()]),
              ),
            ),
        ],
      ),
    );
  }
}

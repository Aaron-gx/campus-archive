import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../state/store.dart';
import '../theme.dart';

/// 印章：圆形双环 + 旋转。实心 = 已盖章/已归档；虚线 = 待盖章/整理中/待补充
class StampSeal extends StatelessWidget {
  final String text;
  final bool solid;
  final Color color;
  final double size;

  const StampSeal({
    super.key,
    required this.text,
    this.solid = true,
    this.color = AppColors.seal,
    this.size = 54,
  });

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -0.21,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: color.withOpacity(solid ? 0.9 : 0.55),
            width: 1.6,
          ),
          boxShadow: solid
              ? [
                  BoxShadow(
                    color: color.withOpacity(0.12),
                    blurRadius: 4,
                    offset: const Offset(0, 1),
                  ),
                ]
              : null,
        ),
        alignment: Alignment.center,
        child: Container(
          width: size - 8,
          height: size - 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: color.withOpacity(solid ? 0.7 : 0.4),
              width: 0.8,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            text,
            style: TextStyle(
              color: color.withOpacity(solid ? 0.95 : 0.6),
              fontSize: size * 0.24,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.5,
              height: 1.0,
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}

/// 小号文字章（列表角标用）：已归档 / 待盖章
class StampTag extends StatelessWidget {
  final String text;
  final bool solid;

  const StampTag(this.text, {super.key, this.solid = true});

  @override
  Widget build(BuildContext context) {
    final c = solid ? AppColors.seal : AppColors.inkFaint;
    return Transform.rotate(
      angle: -0.12,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          border: Border.all(color: c.withOpacity(0.75), width: 1),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: c,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 2,
          ),
        ),
      ),
    );
  }
}

/// 区块标签（索引条样式）
class SectionLabel extends StatelessWidget {
  final String text;
  final Widget? trailing;

  const SectionLabel(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 14,
            decoration: BoxDecoration(
              color: AppColors.seal,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            text,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
              color: AppColors.ink,
            ),
          ),
          const Spacer(),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// 索引卡：白卡 + 左侧朱红装订边
/// 注意：不用 Material/InkWell/ClipRRect/非均匀 Border——这套组合在部分
/// 渲染管线上会整卡不绘制（模拟器实测复现），改用等价的轻量实现。
class IndexCard extends StatelessWidget {
  final Widget child;
  final Color edge;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const IndexCard({
    super.key,
    required this.child,
    this.edge = AppColors.seal,
    this.padding = const EdgeInsets.all(14),
    this.onTap,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.line.withOpacity(0.7)),
          boxShadow: [
            BoxShadow(
              color: AppColors.ink.withOpacity(0.04),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              child: Container(
                width: 4,
                decoration: BoxDecoration(
                  color: edge,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(9),
                    bottomLeft: Radius.circular(9),
                  ),
                ),
              ),
            ),
            Padding(
              padding: padding.copyWith(
                left: padding.left + 4,
              ),
              child: child,
            ),
          ],
        ),
      ),
    );
  }
}

/// 虚线边框容器（锁定卡 / 添加行）
class DashedBox extends StatelessWidget {
  final Widget child;
  final Color color;

  const DashedBox({super.key, required this.child, this.color = AppColors.line});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedBorderPainter(color),
      child: child,
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  final Color color;
  _DashedBorderPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    const dash = 5.0, gap = 4.0;
    final r = RRect.fromRectAndRadius(
        Offset.zero & size, const Radius.circular(10));
    final path = Path()..addRRect(r);
    for (final metric in path.computeMetrics()) {
      var dist = 0.0;
      while (dist < metric.length) {
        final next = dist + dash;
        canvas.drawPath(
          metric.extractPath(dist, next),
          paint,
        );
        dist = next + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedBorderPainter old) => old.color != color;
}

/// 虚线分隔线
class DashedLine extends StatelessWidget {
  const DashedLine({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (ctx, c) {
      return Row(
        children: List.generate(
          (c.maxWidth / 9).floor(),
          (_) => Expanded(
            child: Container(
              margin: const EdgeInsets.only(right: 5),
              height: 1,
              color: AppColors.line,
            ),
          ),
        ),
      );
    });
  }
}

/// 分类选择 chips 行
class FilterChips extends StatelessWidget {
  final List<ChipSpec> chips;
  final ValueChanged<String> onSelected;

  FilterChips({super.key, required this.chips, required this.onSelected});

  final ScrollController _ctrl = ScrollController();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      child: ListView.separated(
        controller: _ctrl,
        scrollDirection: Axis.horizontal,
        itemCount: chips.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final c = chips[i];
          final selected = c.selected;
          return GestureDetector(
            onTap: () => onSelected(c.key),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? AppColors.ink : AppColors.card,
                borderRadius: BorderRadius.circular(17),
                border: Border.all(
                  color: selected ? AppColors.ink : AppColors.line,
                ),
              ),
              child: Text(
                c.count == null ? c.label : '${c.label} ${c.count}',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppColors.white : AppColors.inkSoft,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class ChipSpec {
  final String key;
  final String label;
  final int? count;
  final bool selected;

  const ChipSpec(this.key, this.label, {this.count, this.selected = false});
}

/// 搜索框
class SearchBox extends StatelessWidget {
  final String hint;
  final ValueChanged<String> onChanged;

  const SearchBox({super.key, required this.hint, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return TextField(
      onChanged: onChanged,
      style: const TextStyle(fontSize: 14, color: AppColors.ink),
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.inkFaint),
        isDense: true,
      ),
    );
  }
}

/// 空状态
class EmptyView extends StatelessWidget {
  final String icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 44)),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.inkSoft,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12.5, color: AppColors.inkFaint),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 18), action!],
          ],
        ),
      ),
    );
  }
}

/// 级别徽章（证书）
class LevelPill extends StatelessWidget {
  final String level;

  const LevelPill(this.level, {super.key});

  @override
  Widget build(BuildContext context) {
    final top = level == '国际级' || level == '国家级';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
      decoration: BoxDecoration(
        color: top
            ? AppColors.goldSoft
            : AppColors.paperDark.withOpacity(0.6),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: top ? AppColors.gold : AppColors.line,
          width: 0.8,
        ),
      ),
      child: Text(
        level,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1,
          color: top ? AppColors.gold : AppColors.inkSoft,
        ),
      ),
    );
  }
}

/// 主按钮（墨色）/ 强调按钮（朱红 = 盖章）
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool accent; // true = 朱红印章色
  final bool outline;
  final IconData? icon;

  const PrimaryButton(
    this.label, {
    super.key,
    this.onPressed,
    this.accent = false,
    this.outline = false,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final fg = outline
        ? (accent ? AppColors.seal : AppColors.ink)
        : AppColors.white;
    final bg = accent ? AppColors.seal : AppColors.ink;
    return SizedBox(
      height: 48,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: icon == null
            ? const SizedBox.shrink()
            : Icon(icon, size: 18, color: fg),
        label: Text(
          label,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            letterSpacing: 2,
            color: fg,
          ),
        ),
        style: OutlinedButton.styleFrom(
          backgroundColor: outline ? Colors.transparent : bg,
          foregroundColor: fg,
          side: outline ? BorderSide(color: bg, width: 1.4) : null,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
    );
  }
}

/// 敏感二次验证底部弹层：输入安全密码 → 10 分钟窗口
Future<bool> showVerifySheet(BuildContext context, AppStore store) async {
  if (store.sensitiveVerified) return true;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => const _VerifySheet(),
  );
  return ok ?? false;
}

class _VerifySheet extends StatefulWidget {
  const _VerifySheet();

  @override
  State<_VerifySheet> createState() => _VerifySheetState();
}

class _VerifySheetState extends State<_VerifySheet> {
  final _ctrl = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final store = storeOf(context);
    setState(() => _busy = true);
    final ok = await store.verifySensitive(_ctrl.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('身份已验证，10 分钟内可查看敏感原件')),
      );
    } else {
      setState(() => _error = '密码不正确');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.verified_user, size: 20, color: AppColors.seal), 
              SizedBox(width: 8),
              Text(
                '验证身份',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            '查看敏感原件需输入安全密码，验证后 10 分钟内无需重复输入。',
            style: TextStyle(fontSize: 12.5, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            obscureText: true,
            autofocus: true,
            onSubmitted: (_) => _busy ? null : _submit(),
            decoration: InputDecoration(
              hintText: '安全密码',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 14),
          PrimaryButton(
            _busy ? '验证中…' : '确认验证',
            accent: true,
            onPressed: _busy ? null : _submit,
          ),
        ],
      ),
    );
  }
}

/// 通用确认对话框
Future<bool> showConfirm(
  BuildContext context, {
  required String title,
  required String message,
  String confirmText = '确认',
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: const TextStyle(fontSize: 17)),
      content: Text(message, style: const TextStyle(fontSize: 14, height: 1.5)),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('取消', style: TextStyle(color: AppColors.inkSoft)),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(
            confirmText,
            style: TextStyle(
              color: danger ? AppColors.seal : AppColors.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// 文档缩略图（图片 / 锁定占位 / PDF）
class DocThumb extends StatelessWidget {
  final Doc doc;
  final AppStore store;
  final double size;

  const DocThumb({super.key, required this.doc, required this.store, this.size = 76});

  @override
  Widget build(BuildContext context) {
    if (doc.isSensitive && !store.sensitiveVerified) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: AppColors.ink.withOpacity(0.9),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.lock, color: AppColors.gold, size: 22),
            SizedBox(height: 4),
            Text(
              '已加密',
              style: TextStyle(
                  color: AppColors.gold, fontSize: 10, letterSpacing: 1),
            ),
          ],
        ),
      );
    }
    if (doc.e2ee && !store.e2eeUnlocked) {
      // 端到端加密且密钥未解锁：显示锁定占位
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: AppColors.paperDark,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.key_off, color: AppColors.inkFaint, size: 20),
            SizedBox(height: 4),
            Text(
              '待解锁',
              style: TextStyle(
                  color: AppColors.inkFaint, fontSize: 9, letterSpacing: 1),
            ),
          ],
        ),
      );
    }
    if (doc.isPdf) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: AppColors.sealSoft.withOpacity(0.5),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.line),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.picture_as_pdf, color: AppColors.seal, size: 26),
            SizedBox(height: 2),
            Text('PDF', style: TextStyle(fontSize: 10, color: AppColors.inkSoft)),
          ],
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: _buildImage(),
    );
  }

  Widget _buildImage() {
    final path = store.thumbPath(doc);
    if (path == null) {
      // 账号模式未缓存：占位（列表加载后会自动预取）
      return Container(
        width: size,
        height: size,
        color: AppColors.paperDark,
        child: const Icon(Icons.image_outlined,
            size: 20, color: AppColors.inkFaint),
      );
    }
    return Image.file(
      File(path),
      width: size,
      height: size,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => Container(
        width: size,
        height: size,
        color: AppColors.paperDark,
        child: const Icon(Icons.broken_image_outlined,
            color: AppColors.inkFaint, size: 22),
      ),
    );
  }
}

AppStore storeOf(BuildContext context) =>
    Provider.of<AppStore>(context, listen: false);

/// 宽屏双列卡片流：按顺序把卡片拆进两列（等宽简易瀑布流，无第三方依赖）。
/// 手机单列布局不受影响；仅在父级判定为宽屏时使用。
class TwoColumnFlow extends StatelessWidget {
  final List<Widget> children;
  final double spacing;

  const TwoColumnFlow({
    super.key,
    required this.children,
    this.spacing = 10,
  });

  @override
  Widget build(BuildContext context) {
    final colA = <Widget>[];
    final colB = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      (i.isEven ? colA : colB).add(
        Padding(
          padding: EdgeInsets.only(bottom: spacing),
          child: children[i],
        ),
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 90),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Column(children: colA)),
          SizedBox(width: spacing),
          Expanded(child: Column(children: colB)),
        ],
      ),
    );
  }
}

/// 宽屏（平板 / 横屏）适配：把内容约束到最大可读宽度并水平居中，
/// 窄屏（手机）不产生任何影响。列表/表单页统一使用，避免单列内容拉满全屏。
class ResponsiveCenter extends StatelessWidget {
  final double maxWidth;
  final Widget child;

  const ResponsiveCenter({
    super.key,
    this.maxWidth = 840,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      if (box.maxWidth <= maxWidth) return child;
      return Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: child,
        ),
      );
    });
  }
}

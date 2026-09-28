import 'package:flutter/material.dart';

import '../theme.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'archive_all.dart';
import 'export_page.dart';
import 'home.dart';
import 'profile.dart';
import 'scan.dart';

/// 主界面骨架，双形态自适应：
/// - 宽屏（平板/横屏 ≥840dp）：左侧档案抽屉导航 + 内容区分支导航器。
///   二级页（分类详情/证书总目/扫描/表单…）在内容区内打开，侧栏常驻；
///   系统返回优先退出二级页，切 tab 时清空分支路由。
/// - 窄屏（手机）：底部四标签 + 中央归档 FAB，二级页全屏推入（根导航器）。
/// 切 tab：内容整体做一次方向性滑动淡入（页面状态保留，不重建）。
class ShellPage extends StatefulWidget {
  const ShellPage({super.key});

  @override
  State<ShellPage> createState() => _ShellPageState();
}

class _ShellPageState extends State<ShellPage>
    with SingleTickerProviderStateMixin {
  int _index = 0;
  bool _contentPushed = false; // 宽屏内容区分支导航器是否有二级页
  final _contentNavKey = GlobalKey<NavigatorState>();
  final _tabIndex = ValueNotifier<int>(0);

  // 切 tab 动效：方向性滑动 + 淡入
  late final AnimationController _tabCtrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 260),
    value: 1.0, // 首帧直接就位
  );
  Offset _slideFrom = Offset.zero;

  late final Animation<double> _tabFade = Tween(begin: 0.4, end: 1.0)
      .animate(CurvedAnimation(parent: _tabCtrl, curve: Curves.easeOutCubic));

  final _pages = const [
    HomePage(),
    ArchiveAllPage(),
    ExportPage(),
    ProfilePage(),
  ];

  static const _tabs = [
    (Icons.dashboard_outlined, Icons.dashboard, '首页'),
    (Icons.folder_shared_outlined, Icons.folder_shared, '我的档案'),
    (Icons.ios_share_outlined, Icons.ios_share, '导出'),
    (Icons.person_outline, Icons.person, '我的'),
  ];

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  void _selectTab(int i) {
    if (i == _index) return;
    // 宽屏下切 tab：先清空内容区的二级页，回到该 tab 根页
    if (_contentPushed) {
      _contentNavKey.currentState?.popUntil((r) => r.isFirst);
    }
    setState(() {
      _slideFrom = i > _index ? const Offset(0.018, 0) : const Offset(-0.018, 0);
      _index = i;
      _tabIndex.value = i;
    });
    _tabCtrl.forward(from: 0);
  }

  void _openScan() {
    final route = FadeSlideRoute(const ScanPage());
    // 宽屏推进内容区（侧栏常驻），窄屏推根导航器（全屏）
    if (_contentNavKey.currentState != null) {
      _contentNavKey.currentState!.push(route);
    } else {
      Navigator.of(context).push(route);
    }
  }

  void _onContentNavChanged() {
    final pushed = _contentNavKey.currentState?.canPop() ?? false;
    if (pushed != _contentPushed) {
      setState(() => _contentPushed = pushed);
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final wide = box.maxWidth >= 840;
      if (wide) {
        return PopScope(
          // 内容区有二级页时，系统返回先退二级页而不是退出应用
          canPop: !_contentPushed,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) _contentNavKey.currentState?.pop();
          },
          child: Scaffold(
            backgroundColor: AppColors.paper,
            body: Row(
              children: [
                _SideNav(
                  index: _index,
                  tabs: _tabs,
                  onSelect: _selectTab,
                  onScan: _openScan,
                ),
                const VerticalDivider(width: 1),
                Expanded(
                  child: AnimatedBuilder(
                    animation: _tabCtrl,
                    builder: (context, child) => FadeTransition(
                      opacity: _tabFade,
                      child: SlideTransition(
                        position: CurvedAnimation(
                                parent: _tabCtrl, curve: Curves.easeOutCubic)
                            .drive(Tween(begin: _slideFrom, end: Offset.zero)),
                        child: child!,
                      ),
                    ),
                    child: Navigator(
                      key: _contentNavKey,
                      observers: [_ContentNavObserver(_onContentNavChanged)],
                      onGenerateRoute: (_) => FadeSlideRoute(
                        ValueListenableBuilder<int>(
                          valueListenable: _tabIndex,
                          builder: (context, i, _) => _pages[i],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      }
      return Scaffold(
        backgroundColor: AppColors.paper,
        floatingActionButton: FloatingActionButton(
          backgroundColor: AppColors.ink,
          foregroundColor: AppColors.white,
          elevation: 2,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          onPressed: _openScan,
          child: const Icon(Icons.add, size: 28),
        ),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
        bottomNavigationBar: BottomAppBar(
          color: AppColors.card,
          elevation: 0,
          shape: const CircularNotchedRectangle(),
          notchMargin: 6,
          child: Row(
            children: [
              _navItem(0, 1),
              _navItem(1, 2),
              const Expanded(child: SizedBox()),
              _navItem(2, 2),
              _navItem(3, 1),
            ],
          ),
        ),
        body: AnimatedBuilder(
          animation: _tabCtrl,
          builder: (context, child) => FadeTransition(
            opacity: _tabFade,
            child: SlideTransition(
              position: CurvedAnimation(parent: _tabCtrl, curve: Curves.easeOutCubic)
                  .drive(Tween(begin: _slideFrom, end: Offset.zero)),
              child: child!,
            ),
          ),
          child: IndexedStack(index: _index, children: _pages),
        ),
      );
    });
  }

  Widget _navItem(int i, int flex) {
    final (icon, activeIcon, label) = _tabs[i];
    final selected = _index == i;
    return Expanded(
      flex: flex,
      child: InkWell(
        onTap: () => _selectTab(i),
        borderRadius: BorderRadius.circular(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedScale(
              scale: selected ? 1.12 : 1.0,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutBack,
              child: Icon(
                selected ? activeIcon : icon,
                size: 22,
                color: selected ? AppColors.ink : AppColors.inkFaint,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10.5,
                letterSpacing: 1,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? AppColors.ink : AppColors.inkFaint,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 内容区分支导航器的路由观察：二级页推入/退出时同步返回拦截状态
class _ContentNavObserver extends NavigatorObserver {
  final VoidCallback onChanged;
  _ContentNavObserver(this.onChanged);

  @override
  void didPush(Route route, Route? previousRoute) => onChanged();

  @override
  void didPop(Route route, Route? previousRoute) => onChanged();

  @override
  void didRemove(Route route, Route? previousRoute) => onChanged();

  @override
  void didReplace({Route? newRoute, Route? oldRoute}) => onChanged();
}

/// 宽屏左侧档案抽屉：品牌章 + 导航项 + 归档按钮
class _SideNav extends StatelessWidget {
  final int index;
  final List<(IconData, IconData, String)> tabs;
  final ValueChanged<int> onSelect;
  final VoidCallback onScan;

  const _SideNav({
    required this.index,
    required this.tabs,
    required this.onSelect,
    required this.onScan,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 232,
      color: AppColors.card,
      child: SafeArea(
        right: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 品牌区
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
              child: Row(
                children: [
                  Transform.rotate(
                    angle: -0.14,
                    child: Container(
                      width: 44,
                      height: 44,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.seal, width: 2),
                      ),
                      child: const Text(
                        '简',
                        style: TextStyle(
                          color: AppColors.seal,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                          height: 1.0,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Text(
                    '简册',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 6,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ),
            const DashedLine(),
            const SizedBox(height: 12),
            for (var i = 0; i < tabs.length; i++) _item(i),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: PrimaryButton(
                '扫描归档',
                accent: true,
                icon: Icons.add,
                onPressed: onScan,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _item(int i) {
    final (icon, activeIcon, label) = tabs[i];
    final selected = index == i;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: GestureDetector(
        onTap: () => onSelect(i),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.paperDark.withOpacity(0.45)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? AppColors.line : Colors.transparent,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? activeIcon : icon,
                size: 20,
                color: selected ? AppColors.ink : AppColors.inkFaint,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    letterSpacing: 1,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                    color: selected ? AppColors.ink : AppColors.inkSoft,
                  ),
                ),
              ),
              // 激活标签：右移出血的红色小竖条（呼应索引标签语言）
              Container(
                width: 4,
                height: 16,
                decoration: BoxDecoration(
                  color: selected ? AppColors.seal : Colors.transparent,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

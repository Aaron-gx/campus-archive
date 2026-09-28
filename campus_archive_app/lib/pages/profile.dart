import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/format.dart';
import '../state/store.dart';
import '../theme.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'certificates.dart';
import 'onboarding.dart';

/// 我的：账号/资料 / 数据状态 / 菜单（隐私与加密、修改资料、注销、关于）
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppStore>();
    final profile = store.displayProfile;
    final acc = store.account;

    return Scaffold(
      backgroundColor: AppColors.paper,
      // 页面没有 AppBar，必须用 SafeArea 避开状态栏，否则头部被遮挡
      body: SafeArea(
        bottom: false,
        child: ResponsiveCenter(
          maxWidth: 720,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
        children: [
          Row(
            children: [
              Container(
                width: 58,
                height: 58,
                decoration:
                    const BoxDecoration(color: AppColors.ink, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  profile.nickname.isEmpty ? '同' : profile.nickname.substring(0, 1),
                  style: const TextStyle(
                      color: AppColors.gold, fontSize: 24, fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(profile.nickname,
                        style: const TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 3),
                    Text(
                      [
                        acc?.maskedAccount ?? '',
                        if (profile.school.isNotEmpty) profile.school,
                        if (profile.createdAt > 0)
                          '建档于 ${fmtDateCn(profile.createdAt)}',
                      ].join(' · '),
                      style: const TextStyle(fontSize: 12, color: AppColors.inkSoft),
                    ),
                  ],
                ),
              ),
              const StampSeal(text: '存', size: 42),
            ],
          ),
          const SizedBox(height: 20),

          // 数据安全状态（深色卡）
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.ink,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '云端同步状态',
                  style: const TextStyle(
                      color: AppColors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1),
                ),
                const SizedBox(height: 10),
                _statusRow(
                    '服务器',
                    store.syncing
                        ? '同步中…'
                        : store.online
                            ? store.api.baseUrl
                            : '离线（材料暂存本机）',
                    store.online || store.syncing),
                _statusRow(
                    '账号数据',
                    '${store.docs.length} 份材料 · ${store.certs.length} 条证书 · ${fmtSize(store.storageUsed)}',
                    true),
                _statusRow(
                    '待同步',
                    store.pendingSyncCount == 0
                        ? '全部已同步'
                        : '${store.pendingSyncCount} 项等待上传',
                    store.pendingSyncCount == 0),
                if (store.offlineError != null)
                  _statusRow('连接异常', store.offlineError!, false),
              ],
            ),
          ),
          const SizedBox(height: 20),

          _menuItem(
            icon: Icons.sync_outlined,
            title: '立即同步',
            subtitle: store.pendingSyncCount == 0
                ? '与云端保持一致'
                : '${store.pendingSyncCount} 项待上传',
            onTap: () async {
              ScaffoldMessenger.of(context)
                  .showSnackBar(const SnackBar(content: Text('正在同步…')));
              await storeOf(context).sync();
            },
          ),
          _menuItem(
            icon: Icons.cloud_outlined,
            title: '服务器地址',
            subtitle: store.api.baseUrl,
            onTap: _editServer,
          ),
          _menuItem(
            icon: Icons.lock_outline,
            title: '隐私与加密',
            subtitle: '修改账号密码',
            onTap: _changePassword,
          ),
          _menuItem(
            icon: Icons.edit_outlined,
            title: '修改资料',
            subtitle: '昵称 / 学校',
            onTap: _editProfile,
          ),
          _menuItem(
            icon: Icons.workspace_premium_outlined,
            title: '证书总目',
            subtitle: '${store.certs.length} 条结构化证书记录',
            onTap: () => pushFadeSlide(
                context, const CertificatesPage()),
          ),
          _menuItem(
            icon: Icons.info_outline,
            title: '关于',
            subtitle: 'v1.2.0',
            onTap: _about,
          ),
          _menuItem(
            icon: Icons.logout,
            title: '退出登录',
            subtitle: '保留云端数据，回到登录页',
            onTap: _logout,
          ),
          _menuItem(
            icon: Icons.delete_forever_outlined,
            title: '注销账号',
            subtitle: '删除云端全部数据（不可恢复）',
            danger: true,
            onTap: _deleteAccount,
          ),
        ],
      ),
        ),
      ),
    );
  }

  Widget _statusRow(String title, String value, bool ok) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: ok ? AppColors.gold : AppColors.seal,
            ),
          ),
          const SizedBox(width: 10),
          Text(title, style: const TextStyle(color: AppColors.white, fontSize: 13)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.gold, fontSize: 11.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _menuItem({
    required IconData icon,
    required String title,
    required String subtitle,
    bool danger = false,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        // 左侧色条用布局实现：非均匀 Border + borderRadius 在部分渲染管线下
        // 会导致整卡内容不绘制（模拟器实测复现）
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(
          children: [
            Container(
              width: 3,
              height: 34,
              margin: const EdgeInsets.only(right: 11),
              decoration: BoxDecoration(
                color: danger ? AppColors.seal : AppColors.ink,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Icon(icon, size: 20, color: danger ? AppColors.seal : AppColors.ink),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: danger ? AppColors.seal : AppColors.ink)),
                  Text(subtitle,
                      style:
                          const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.inkFaint),
          ],
        ),
      ),
    );
  }

  Future<void> _editServer() async {
    final store = storeOf(context);
    final ctrl = TextEditingController(text: store.api.baseUrl);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 20, right: 20, top: 18,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('服务器地址',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            TextField(
              controller: ctrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(hintText: 'http://192.168.1.5:3000'),
            ),
            const SizedBox(height: 14),
            PrimaryButton('保存并重新同步', onPressed: () async {
              store.api.baseUrl = ctrl.text.trim();
              try {
                await store.sync();
                if (ctx.mounted) Navigator.pop(ctx);
              } on ApiException catch (e) {
                ScaffoldMessenger.of(ctx)
                    .showSnackBar(SnackBar(content: Text(e.message)));
              }
            }),
          ],
        ),
      ),
    );
  }

  Future<void> _changePassword() async {
    final old = TextEditingController();
    final pw = TextEditingController();
    final confirm = TextEditingController();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 20, right: 20, top: 18,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('修改账号密码',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            TextField(
                controller: old,
                obscureText: true,
                decoration: const InputDecoration(hintText: '当前密码')),
            const SizedBox(height: 10),
            TextField(
                controller: pw,
                obscureText: true,
                decoration: const InputDecoration(hintText: '新密码（至少 8 位）')),
            const SizedBox(height: 10),
            TextField(
                controller: confirm,
                obscureText: true,
                decoration: const InputDecoration(hintText: '确认新密码')),
            const SizedBox(height: 16),
            PrimaryButton('确认修改', onPressed: () async {
              if (pw.text.length < 8 || pw.text != confirm.text) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                    const SnackBar(content: Text('两次新密码不一致或不足 8 位')));
                return;
              }
              try {
                await storeOf(ctx).changePassword(old.text, pw.text);
                if (ctx.mounted) Navigator.pop(ctx);
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(content: Text('密码已更新')));
                }
              } on ApiException catch (e) {
                ScaffoldMessenger.of(ctx)
                    .showSnackBar(SnackBar(content: Text(e.message)));
              } catch (e) {
                ScaffoldMessenger.of(ctx)
                    .showSnackBar(SnackBar(content: Text('当前密码不正确')));
              }
            }),
          ],
        ),
      ),
    );
  }

  Future<void> _editProfile() async {
    final store = storeOf(context);
    final p = store.displayProfile;
    final nickname = TextEditingController(text: p.nickname);
    final school = TextEditingController(text: p.school);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 20, right: 20, top: 18,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('修改资料',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            TextField(
                controller: nickname,
                decoration: const InputDecoration(hintText: '昵称')),
            const SizedBox(height: 10),
            TextField(
                controller: school,
                decoration: const InputDecoration(hintText: '学校（选填）')),
            const SizedBox(height: 16),
            PrimaryButton('保存', onPressed: () async {
              try {
                await store.updateProfile(
                  nickname: nickname.text.trim(),
                  school: school.text.trim(),
                );
                if (ctx.mounted) Navigator.pop(ctx);
              } on ApiException catch (e) {
                ScaffoldMessenger.of(ctx)
                    .showSnackBar(SnackBar(content: Text(e.message)));
              }
            }),
          ],
        ),
      ),
    );
  }

  Future<void> _about() async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('关于'),
        content: const Text(
          '简册 · 个人电子档案袋\nv1.2.0',
          style: TextStyle(fontSize: 13, height: 1.8),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('确定', style: TextStyle(color: AppColors.ink)),
          ),
        ],
      ),
    );
  }

  Future<void> _logout() async {
    final ok = await showConfirm(context,
        title: '退出登录',
        message: '确定退出登录？',
        confirmText: '退出');
    if (!ok) return;
    await storeOf(context).logoutAccount();
    if (!mounted) return;
    // 回根导航器：平板上引导页也必须替换整个界面（含侧栏）
    Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
      FadeSlideRoute(const OnboardingPage()),
      (_) => false,
    );
  }

  /// 账号模式：注销云端账号
  Future<void> _deleteAccount() async {
    final store = storeOf(context);
    final pw = TextEditingController();
    final confirm = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
            left: 20, right: 20, top: 18,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.warning_amber_rounded, color: AppColors.seal),
                SizedBox(width: 8),
                Text('注销账号',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.seal)),
              ],
            ),
            const SizedBox(height: 10),
            const Text(
              '注销后所有材料及证书记录将永久删除，不可恢复。',
              style: TextStyle(
                  fontSize: 12.5, color: AppColors.inkSoft, height: 1.6),
            ),
            const SizedBox(height: 14),
            TextField(
                controller: pw,
                obscureText: true,
                decoration: const InputDecoration(hintText: '账号密码')),
            const SizedBox(height: 10),
            TextField(
                controller: confirm,
                decoration: const InputDecoration(hintText: '输入「注销」以确认')),
            const SizedBox(height: 16),
            PrimaryButton(
              '永久注销',
              accent: true,
              onPressed: () async {
                if (confirm.text != '注销') {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                      const SnackBar(content: Text('未输入「注销」')));
                  return;
                }
                try {
                  await store.deleteAccountOnServer(pw.text);
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } on ApiException catch (e) {
                  ScaffoldMessenger.of(ctx)
                      .showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
            ),
          ],
        ),
      ),
    );
    if (ok == true && mounted) {
      Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
        FadeSlideRoute(const OnboardingPage()),
        (_) => false,
      );
    }
  }
}

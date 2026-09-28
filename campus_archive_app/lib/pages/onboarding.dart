import 'package:flutter/material.dart';

import '../data/api_client.dart';
import '../theme.dart';
import '../ui/transitions.dart';
import '../ui/widgets.dart';
import 'shell.dart';

/// 首次进入：登录 / 注册账号（同一账号多端同步；离线时数据先存本机，联网自动上传）
class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  bool _register = false;

  final _server = TextEditingController();
  final _account = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _nickname = TextEditingController();
  final _school = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _server.dispose();
    _account.dispose();
    _password.dispose();
    _confirm.dispose();
    _nickname.dispose();
    _school.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    final url = _server.text.trim();
    if (url.isEmpty) return setState(() => _error = '请填写服务器地址（网页版访问地址）');
    if (_account.text.trim().isEmpty || _password.text.isEmpty) {
      return setState(() => _error = '请填写账号和密码');
    }
    if (_register) {
      if (_password.text.length < 8) {
        return setState(() => _error = '密码至少 8 位');
      }
      if (_password.text != _confirm.text) {
        return setState(() => _error = '两次输入的密码不一致');
      }
    }
    setState(() => _busy = true);
    try {
      final store = storeOf(context);
      if (_register) {
        await store.registerAccount(
          url,
          _account.text.trim(),
          _password.text,
          _nickname.text.trim().isEmpty ? '同学' : _nickname.text.trim(),
          _school.text.trim(),
        );
      } else {
        await store.loginAccount(url, _account.text.trim(), _password.text);
      }
      if (!mounted) return;
      replaceFadeSlide(
          context, const ShellPage());
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 20),
            child: ResponsiveCenter(
              maxWidth: 520,
              child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 品牌
                Transform.rotate(
                  angle: -0.14,
                  child: Container(
                    width: 70,
                    height: 70,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.seal, width: 2.2),
                    ),
                    child: const Text(
                      '简',
                      style: TextStyle(
                        color: AppColors.seal,
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                        height: 1.0,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  '简册',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 12),
                ),
                const SizedBox(height: 24),

                // 登录/注册切换
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _link('登录', !_register,
                        () => setState(() => _register = false)),
                    const Text(' · ',
                        style: TextStyle(color: AppColors.inkFaint)),
                    _link('注册新账号', _register,
                        () => setState(() => _register = true)),
                  ],
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _server,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    hintText: '服务器地址',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _account,
                  decoration: const InputDecoration(
                      hintText: '手机号 / 学校邮箱'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: InputDecoration(
                      hintText: _register ? '设置密码（至少 8 位）' : '密码'),
                ),
                if (_register) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _confirm,
                    obscureText: true,
                    decoration:
                        const InputDecoration(hintText: '确认密码'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _nickname,
                    decoration: const InputDecoration(hintText: '昵称（选填）'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _school,
                    decoration: const InputDecoration(hintText: '学校（选填）'),
                  ),
                ],
                const SizedBox(height: 10),
                const Text(
                  '与网页版使用同一账号，多端数据一致。\n'
                  '离线也能正常归档：材料先安全存本机，联网后自动同步云端。',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 11, color: AppColors.inkFaint, height: 1.6),
                ),

                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style:
                          const TextStyle(color: AppColors.seal, fontSize: 12.5),
                    ),
                  ),
                const SizedBox(height: 18),
                PrimaryButton(
                  _busy
                      ? '请稍候…'
                      : (_register ? '注册并进入' : '打开我的档案袋'),
                  onPressed: _busy ? null : _submit,
                ),
              ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _link(String label, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Text(
        label,
        style: TextStyle(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          color: active ? AppColors.ink : AppColors.inkFaint,
          decoration: active ? TextDecoration.underline : null,
        ),
      ),
    );
  }
}

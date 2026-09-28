import 'package:flutter/material.dart';

import '../theme.dart';

/// 启动页：大印章「存」+ 品牌语，1.4 秒后自动进入
class SplashPage extends StatefulWidget {
  final VoidCallback onDone;
  const SplashPage({super.key, required this.onDone});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 1400), () {
      if (mounted) widget.onDone();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Transform.rotate(
                angle: -0.14,
                child: Container(
                  width: 108,
                  height: 108,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.seal, width: 3),
                  ),
                  alignment: Alignment.center,
                  child: Container(
                    width: 92,
                    height: 92,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: AppColors.seal.withOpacity(0.7), width: 1),
                    ),
                    alignment: Alignment.center,
                    child: const Text(
                      '简',
                      style: TextStyle(
                        color: AppColors.seal,
                        fontSize: 46,
                        fontWeight: FontWeight.w900,
                        height: 1.0,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 28),
              const Text(
                '简册',
                style: TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 14,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'JIANCE',
                style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 4,
                  color: AppColors.inkSoft,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

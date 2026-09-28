import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 加密服务：
/// - 主密钥保存在 Android Keystore（flutter_secure_storage）
/// - 敏感文件 AES-256-GCM 加密，磁盘布局 iv(12) + ciphertext + tag(16)
/// - 安全密码 PBKDF2-HMAC-SHA256 哈希存储，用于敏感文件的二次验证（10 分钟窗口）
class CryptoService {
  static const _mkKey = 'campus_archive_master_key';
  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  late Uint8List _masterKey;

  Future<void> init() async {
    final saved = await _storage.read(key: _mkKey);
    if (saved != null && saved.length == 64) {
      _masterKey = Uint8List.fromList(hexDecode(saved));
    } else {
      final rng = Random.secure();
      _masterKey = Uint8List.fromList(
        List<int>.generate(32, (_) => rng.nextInt(256)),
      );
      await _storage.write(key: _mkKey, value: hexEncode(_masterKey));
    }
  }

  Uint8List get masterKey => _masterKey;

  /// 加密文件字节 → iv + ciphertext + tag
  Future<Uint8List> encryptFile(Uint8List plain) async {
    final box = await AesGcm.with256bits().encrypt(
      plain,
      secretKey: SecretKey(_masterKey),
    );
    final out = BytesBuilder();
    out.add(box.nonce);
    out.add(box.cipherText);
    out.add(box.mac.bytes);
    return out.toBytes();
  }

  /// 解密 iv + ciphertext + tag
  Future<Uint8List> decryptFile(Uint8List blob) async {
    final nonce = blob.sublist(0, 12);
    final mac = blob.sublist(blob.length - 16);
    final ct = blob.sublist(12, blob.length - 16);
    final clear = await AesGcm.with256bits().decrypt(
      SecretBox(ct, nonce: nonce, mac: Mac(mac)),
      secretKey: SecretKey(_masterKey),
    );
    return Uint8List.fromList(clear);
  }

  // ---------- 安全密码 ----------

  Future<({String hash, String salt})> hashPassword(String password) async {
    final salt = Uint8List.fromList(
      List<int>.generate(16, (_) => Random.secure().nextInt(256)),
    );
    final hash = await _derive(password, salt);
    return (hash: hexEncode(hash), salt: hexEncode(salt));
  }

  Future<bool> verifyPassword(
    String password,
    String hexHash,
    String hexSalt,
  ) async {
    final expect = hexDecode(hexHash);
    final got = await _derive(password, hexDecode(hexSalt));
    if (expect.length != got.length) return false;
    var diff = 0;
    for (var i = 0; i < expect.length; i++) {
      diff |= expect[i] ^ got[i];
    }
    return diff == 0;
  }

  Future<List<int>> _derive(String password, List<int> salt) async {
    final kdf = Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: 60000,
      bits: 256,
    );
    final key = await kdf.deriveKeyFromPassword(
      password: password,
      nonce: salt,
    );
    return key.extractBytes();
  }

  // ---------- 调试入口：主密钥重建后旧密文不可解（与网页版语义一致） ----------

  Future<void> resetMasterKey() => init();
}

String hexEncode(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

List<int> hexDecode(String hex) {
  final out = <int>[];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    out.add(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return out;
}

/// 简单文件 IO 封装（同步读，文件均为压缩后的小文件）
Uint8List readBytes(String path) => File(path).readAsBytesSync();

Future<void> writeBytes(String path, List<int> bytes) =>
    File(path).writeAsBytes(bytes, flush: true);

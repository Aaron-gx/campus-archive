import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'crypto.dart' show hexDecode, hexEncode;

/// 端到端加密（E2EE）——与网页端约定同一套格式：
/// - DEK  数据密钥：32B 随机，AES-256-GCM 加密文件
/// - KEK  包裹密钥：PBKDF2-SHA256(密码, salt, 200000, 256bit)，仅用于解包 DEK
/// - 托管：DEK 用 KEK 包裹（nonce12+密文+tag 的 hex）交服务器，服务器无密码不可解
/// - 信封：ASCII "E2E1" + 12B nonce + ciphertext(+16B tag)
class E2eeService {
  static const List<int> _magic = [0x45, 0x32, 0x45, 0x31]; // "E2E1"
  static const _dekStoreKey = 'e2ee.dek';
  final ApiClient api;
  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  final AesGcm _aesGcm = AesGcm.with256bits();
  Uint8List? _dek;

  E2eeService(this.api);

  bool get unlocked => _dek != null;

  /// 登录 / 注册成功后调用：解包已有 DEK，或生成新 DEK 并托管
  Future<void> unlock(String password) async {
    final setup = await api.getE2eeSetup();
    Uint8List dek;
    if (setup != null) {
      dek = await _unwrap(setup.$1, setup.$2, password);
    } else {
      final salt = _rand(16);
      dek = _rand(32);
      final wrapped = await _seal(await _deriveKek(password, salt), dek);
      await api.putE2eeSetup(hexEncode(salt), hexEncode(wrapped));
    }
    _dek = dek;
    await _storage.write(key: _dekStoreKey, value: hexEncode(dek));
  }

  /// 会话恢复（重启免登录）后从安全存储恢复 DEK
  Future<void> tryRestore() async {
    if (_dek != null) return;
    final hex = await _storage.read(key: _dekStoreKey);
    if (hex != null && hex.length == 64) {
      _dek = Uint8List.fromList(hexDecode(hex));
    }
  }

  /// 改密码：用旧密码解出 DEK、新密码重新包裹并更新托管
  Future<void> rewrap(String oldPassword, String newPassword) async {
    final setup = await api.getE2eeSetup();
    if (setup == null) return; // 未启用过则无需处理
    final dek = await _unwrap(setup.$1, setup.$2, oldPassword);
    final wrapped = await _seal(await _deriveKek(newPassword, hexDecode(setup.$1)), dek);
    await api.putE2eeSetup(setup.$1, hexEncode(wrapped));
    _dek = dek;
    await _storage.write(key: _dekStoreKey, value: hexEncode(dek));
  }

  Future<void> wipe() async {
    _dek = null;
    await _storage.delete(key: _dekStoreKey);
  }

  /// 加密为信封：E2E1 + nonce + 密文+tag
  Future<Uint8List> encrypt(Uint8List plain) async {
    final dek = _dek;
    if (dek == null) {
      throw ApiException('端到端加密已锁定，请退出后重新登录解锁');
    }
    final box = await _aesGcm.encrypt(plain, secretKey: SecretKey(dek));
    final out = BytesBuilder();
    out.add(_magic);
    out.add(box.nonce);
    out.add(box.cipherText);
    out.add(box.mac.bytes);
    return out.toBytes();
  }

  /// 解开信封
  Future<Uint8List> decrypt(Uint8List blob) async {
    final dek = _dek;
    if (dek == null) {
      throw ApiException('端到端加密已锁定，请退出后重新登录解锁');
    }
    if (blob.length < 32) throw ApiException('E2EE 信封格式不正确');
    for (var i = 0; i < 4; i++) {
      if (blob[i] != _magic[i]) throw ApiException('E2EE 信封格式不正确');
    }
    final clear = await _aesGcm.decrypt(
      SecretBox(
        blob.sublist(16, blob.length - 16),
        nonce: blob.sublist(4, 16),
        mac: Mac(blob.sublist(blob.length - 16)),
      ),
      secretKey: SecretKey(dek),
    );
    return Uint8List.fromList(clear);
  }

  // ---------- 内部 ----------

  final _rng = Random.secure();

  Uint8List _rand(int n) =>
      Uint8List.fromList(List<int>.generate(n, (_) => _rng.nextInt(256)));

  Future<Uint8List> _deriveKek(String password, List<int> salt) async {
    final kdf = Pbkdf2(macAlgorithm: Hmac.sha256(), iterations: 200000, bits: 256);
    final key = await kdf.deriveKeyFromPassword(password: password, nonce: salt);
    return Uint8List.fromList(await key.extractBytes());
  }

  Future<Uint8List> _unwrap(String saltHex, String wrappedHex, String password) async {
    final kek = await _deriveKek(password, hexDecode(saltHex));
    final blob = hexDecode(wrappedHex);
    final clear = await _aesGcm.decrypt(
      SecretBox(
        blob.sublist(12, blob.length - 16),
        nonce: blob.sublist(0, 12),
        mac: Mac(blob.sublist(blob.length - 16)),
      ),
      secretKey: SecretKey(kek),
    );
    return Uint8List.fromList(clear);
  }

  Future<Uint8List> _seal(Uint8List key, Uint8List plain) async {
    final box = await _aesGcm.encrypt(plain, secretKey: SecretKey(key));
    final out = BytesBuilder();
    out.add(box.nonce);
    out.add(box.cipherText);
    out.add(box.mac.bytes);
    return out.toBytes();
  }
}

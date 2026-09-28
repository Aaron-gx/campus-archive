// 端到端加密（E2EE）客户端实现 —— 密钥只存在于用户设备
//
// 结构（与「简册」App 端约定一致）：
// - DEK  数据密钥：32 字节随机，AES-256-GCM 加密文件
// - KEK  包裹密钥：PBKDF2-HMAC-SHA256(登录密码, salt, 200000, 256bit)，仅用于加解密 DEK
// - 托管：DEK 被 KEK 包裹后交服务器保存（服务器没有密码就无法解出 DEK）
// - 信封：ASCII "E2E1" + 12B nonce + ciphertext(+16B GCM tag)
//
// 纯 JS 实现（基于 @noble/ciphers 和 @noble/hashes）：
// - 在纯 HTTP（无 Secure Context）与 HTTPS 环境下均可无缝运作
// - DEK 便于刷新页面后继续使用，保存在 localStorage（退出登录即清除）
// - 忘记密码 = 找不回 DEK = 找不回 E2EE 文件（服务器无法代为重置）

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export const E2EE_MAGIC = "E2E1";
export const E2ET_PREFIX = "E2ET:";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function getRandomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(bytes);
  }
  for (let i = 0; i < len; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function deriveKek(password: string, saltHex: string): Uint8Array {
  return pbkdf2(sha256, password, hexToBytes(saltHex), { c: 200000, dkLen: 32 });
}

export async function generateSalt(): Promise<string> {
  return bytesToHex(getRandomBytes(16));
}

/** 生成新 DEK 并用 KEK 包裹，返回可托管的数据 */
export async function createWrappedDek(password: string, saltHex: string) {
  const raw = getRandomBytes(32);
  const nonce = getRandomBytes(12);
  const kek = deriveKek(password, saltHex);
  const ct = gcm(kek, nonce).encrypt(raw);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return { dek: raw, wrappedHex: bytesToHex(out) };
}

/** 用密码解包服务器托管的 DEK */
export async function unwrapDek(password: string, saltHex: string, wrappedHex: string): Promise<Uint8Array> {
  const kek = deriveKek(password, saltHex);
  const blob = hexToBytes(wrappedHex);
  const nonce = blob.slice(0, 12);
  const ct = blob.slice(12);
  return gcm(kek, nonce).decrypt(ct);
}

/** 登录或二次验证后调用：有托管则用密码解出 DEK；没有则生成并托管。失败抛错。 */
export async function ensureDek(password: string): Promise<Uint8Array | null> {
  if (typeof window === "undefined") return null;
  const res = await fetch("/api/e2ee/setup");
  if (!res.ok) throw new Error("读取端到端加密状态失败");
  const setup = (await res.json()) as {
    enabled: boolean;
    salt: string | null;
    wrappedKey: string | null;
    hasDocs?: boolean;
  };

  if (setup.enabled && setup.salt && setup.wrappedKey) {
    const dek = await unwrapDek(password, setup.salt, setup.wrappedKey);
    await persistDek(dek);
    return dek;
  }

  // 严禁对已有归档文件或已有加密盐的用户重新生成 DEK（防止覆盖已有档案解密能力）
  if (setup.hasDocs || setup.salt) {
    throw new Error("密码与当前密钥不匹配");
  }

  const salt = await generateSalt();
  const { dek, wrappedHex } = await createWrappedDek(password, salt);
  const put = await fetch("/api/e2ee/setup", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ salt, wrappedKey: wrappedHex, password }),
  });
  if (!put.ok) throw new Error("启用端到端加密失败");
  await persistDek(dek);
  return dek;
}

/** 改密码时：用旧密码解出 DEK、新密码重新包裹并更新托管 */
export async function rewrapDek(oldPassword: string, newPassword: string) {
  if (typeof window === "undefined") return;
  const res = await fetch("/api/e2ee/setup");
  const setup = (await res.json()) as { enabled: boolean; salt: string | null; wrappedKey: string | null };
  if (!setup.enabled || !setup.salt || !setup.wrappedKey) return;
  const dek = (await getDek()) ?? (await unwrapDek(oldPassword, setup.salt, setup.wrappedKey));
  const kek = deriveKek(newPassword, setup.salt);
  const nonce = getRandomBytes(12);
  const ct = gcm(kek, nonce).encrypt(dek);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  const put = await fetch("/api/e2ee/setup", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // 数据库中的密码此刻仍是旧密码
    body: JSON.stringify({ salt: setup.salt, wrappedKey: bytesToHex(out), password: oldPassword }),
  });
  if (!put.ok) throw new Error("更新端到端加密密钥失败");
  await persistDek(dek);
}

/** 用旧密码解包，并用新密码重新包裹，返回新 wrappedKey 供改密接口原子保存 */
export async function rewrapDekData(
  oldPassword: string,
  newPassword: string
): Promise<{ salt: string; wrappedKey: string } | null> {
  if (typeof window === "undefined") return null;
  const res = await fetch("/api/e2ee/setup");
  if (!res.ok) return null;
  const setup = (await res.json()) as { enabled: boolean; salt: string | null; wrappedKey: string | null };
  if (!setup.enabled || !setup.salt || !setup.wrappedKey) return null;
  const dek = (await getDek()) ?? (await unwrapDek(oldPassword, setup.salt, setup.wrappedKey));
  const kek = deriveKek(newPassword, setup.salt);
  const nonce = getRandomBytes(12);
  const ct = gcm(kek, nonce).encrypt(dek);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  await persistDek(dek);
  return { salt: setup.salt, wrappedKey: bytesToHex(out) };
}

/** 出现密码与密钥不匹配时：用原建档密码解锁，并使用当前有效登录密码重新包裹托管 */
export async function healDekWithVaultPassword(
  vaultPassword: string,
  currentPassword: string
): Promise<Uint8Array> {
  if (typeof window === "undefined") throw new Error("环境不支持");
  const res = await fetch("/api/e2ee/setup");
  if (!res.ok) throw new Error("获取加密配置失败");
  const setup = (await res.json()) as { enabled: boolean; salt: string | null; wrappedKey: string | null };
  if (!setup.enabled || !setup.salt || !setup.wrappedKey) {
    throw new Error("未找到加密配置");
  }
  const dek = await unwrapDek(vaultPassword, setup.salt, setup.wrappedKey);
  const kek = deriveKek(currentPassword, setup.salt);
  const nonce = getRandomBytes(12);
  const ct = gcm(kek, nonce).encrypt(dek);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  const put = await fetch("/api/e2ee/setup", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // 数据库中的密码是刚通过二次验证的 currentPassword
    body: JSON.stringify({ salt: setup.salt, wrappedKey: bytesToHex(out), password: currentPassword }),
  });
  if (!put.ok) throw new Error("同步新密钥失败");
  await persistDek(dek);
  return dek;
}

let memoryDek: Uint8Array | null = null;

export async function persistDek(dek: Uint8Array) {
  memoryDek = dek;
  if (typeof window === "undefined") return;
  try {
    const hex = bytesToHex(dek);
    sessionStorage.setItem("e2ee.dek", hex);
    // 清除历史版本遗留在 localStorage 的 DEK，杜绝持久化落盘
    localStorage.removeItem("e2ee.dek");
  } catch {
    // 忽略特定环境配额限制
  }
}

export function clearDek() {
  memoryDek = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("e2ee.dek");
      localStorage.removeItem("e2ee.dek");
    } catch {}
  }
}

export async function getDek(): Promise<Uint8Array | null> {
  if (memoryDek && memoryDek.length === 32) return memoryDek;
  if (typeof window === "undefined") return null;
  try {
    // 若历史 localStorage 中残留，立即清除
    if (localStorage.getItem("e2ee.dek")) {
      try { localStorage.removeItem("e2ee.dek"); } catch {}
    }
    const hex = sessionStorage.getItem("e2ee.dek");
    if (!hex || hex.length !== 64) return null;
    const dek = hexToBytes(hex);
    memoryDek = dek;
    return dek;
  } catch {
    return null;
  }
}

export function isUnlocked(): boolean {
  if (memoryDek && memoryDek.length === 32) return true;
  if (typeof window === "undefined") return false;
  try {
    const hex = sessionStorage.getItem("e2ee.dek");
    return Boolean(hex && hex.length === 64);
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 加密敏感文本；无 DEK 时返回 null（调用方回退或报错） */
export async function encryptText(plain: string): Promise<string | null> {
  const dek = await getDek();
  if (!dek) return null;
  const nonce = getRandomBytes(12);
  const ct = gcm(dek, nonce).encrypt(ENC.encode(plain));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return E2ET_PREFIX + bytesToBase64(out);
}

/** 解密 E2ET 文本信封；非信封内容（历史明文）原样返回 */
export async function decryptText(env: string): Promise<string> {
  if (!env.startsWith(E2ET_PREFIX)) return env;
  const bytes = base64ToBytes(env.slice(E2ET_PREFIX.length));
  const dek = await getDek();
  if (!dek) throw new Error("端到端加密未解锁");
  const nonce = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = gcm(dek, nonce).decrypt(ct);
  return DEC.decode(pt);
}

/** 判断字符串是否为 E2ET 密文信封 */
export function isEncryptedText(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(E2ET_PREFIX);
}

/** 加密为 E2EE 信封；无 DEK 时返回 null（调用方回退明文流程并提示） */
export async function encryptBytes(plain: Uint8Array): Promise<Uint8Array | null> {
  const dek = await getDek();
  if (!dek) return null;
  const nonce = getRandomBytes(12);
  const ct = gcm(dek, nonce).encrypt(plain);
  const magic = ENC.encode(E2EE_MAGIC);
  const out = new Uint8Array(magic.length + nonce.length + ct.length);
  out.set(magic);
  out.set(nonce, magic.length);
  out.set(ct, magic.length + nonce.length);
  return out;
}

export async function decryptBytes(blob: Uint8Array): Promise<Uint8Array> {
  const dek = await getDek();
  if (!dek) throw new Error("端到端加密未解锁");
  const magic = blob.slice(0, 4);
  if (DEC.decode(magic) !== E2EE_MAGIC) throw new Error("信封格式不正确");
  const nonce = blob.slice(4, 16);
  const ct = blob.slice(16);
  return gcm(dek, nonce).decrypt(ct);
}

/** 获取文件字节：e2ee 文件自动解密，返回 (字节, 原始MIME) */
export async function fetchFileBytes(docId: string, fallbackMime: string) {
  const res = await fetch(`/api/documents/${docId}/file`);
  if (!res.ok) throw new Error("文件获取失败");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (res.headers.get("X-E2EE") === "1") {
    const mime = res.headers.get("X-Original-Type") || fallbackMime;
    return { bytes: await decryptBytes(buf), mime };
  }
  return { bytes: buf, mime: res.headers.get("Content-Type") || fallbackMime };
}

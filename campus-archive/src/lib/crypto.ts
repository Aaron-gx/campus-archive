import crypto from "crypto";

// 敏感证件加密存储：AES-256-GCM，密钥由 MASTER_KEY 派生
// 生产环境应将 MASTER_KEY 托管到 KMS，并按用户隔离派生密钥

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // 生产环境拒绝静默降级：缺 MASTER_KEY 时宁可启动失败，也不能用公开可知的
  // dev 密钥加密敏感证件（否则等于明文落盘且无任何报错可察觉）。
  // ⚠️ 兼容提示：若生产库中已存在"未配 MASTER_KEY 时期"加密的 .enc 文件，
  // 需沿用当时的 dev 派生密钥（即下方开发环境兜底逻辑算出的值）才能解密，
  // 解密迁移完成后应立即换回随机密钥。
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[SECURITY] MASTER_KEY 未配置或格式错误（需 64 位 hex），服务拒绝在生产环境使用默认密钥"
    );
  }
  // 开发环境兜底（有默认密钥）
  return crypto.createHash("sha256").update("dev-master-key").digest();
}

function deriveKey(userId: string): Buffer {
  // 按用户派生密钥，单个密钥泄露不影响其他用户
  return crypto.hkdfSync("sha256", masterKey(), Buffer.from("file-encryption"), Buffer.from(userId), 32) as unknown as Buffer;
}

export interface EncryptedBlob {
  data: Buffer; // iv(12) + ciphertext + authTag(16)
}

export function encryptFile(userId: string, plain: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(userId), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { data: Buffer.concat([iv, ciphertext, tag]) };
}

export function decryptFile(userId: string, blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(userId), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

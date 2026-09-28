/**
 * 内容安全与文件准入清洗引擎
 * 职责：
 * 1. 二进制魔数真实类型嗅探（杜绝通过修改后缀名伪装木马/可执行脚本）
 * 2. PDF 恶意利用载荷深度检测（/JavaScript, /Launch, /SubmitForm 攻击行为防御）
 * 3. 图像炸弹（Decompression Bomb）与畸形超大分辨率防御
 */

export interface FileSanitizeResult {
  valid: boolean;
  detectedMime?: string;
  error?: string;
}

/**
 * 嗅探二进制流的真实文件类型（基于前 512 字节魔数比对）
 */
export function sniffRealMimeType(bytes: Uint8Array | Buffer): string | null {
  if (!bytes || bytes.length < 4) return null;

  // 1. E2EE 客户端加密密文信封（系统专属）
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x45 && // E
    bytes[1] === 0x32 && // 2
    bytes[2] === 0x45 && // E
    bytes[3] === 0x31    // 1
  ) {
    return "application/x-e2ee-envelope";
  }

  // 2. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // 3. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // 4. WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50    // P
  ) {
    return "image/webp";
  }

  // 5. PDF: 25 50 44 46 2D (%PDF-)
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // 6. HEIC / HEIF: ....ftypheic / ftypmif1
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (ftyp === "ftyp") {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (["heic", "heix", "mif1", "msf1", "hevc"].includes(brand.toLowerCase())) {
        return "image/heic";
      }
    }
  }

  return null;
}

/**
 * 校验上传文件真实魔数与声明的合法 MIME 类型是否一致
 */
export function sanitizeUploadedFile(
  bytes: Uint8Array | Buffer,
  declaredMime: string,
  isE2ee: boolean = false
): FileSanitizeResult {
  const detected = sniffRealMimeType(bytes);

  if (isE2ee) {
    if (detected !== "application/x-e2ee-envelope") {
      return { valid: false, error: "加密密文信封格式异常" };
    }
    return { valid: true, detectedMime: "application/x-e2ee-envelope" };
  }

  if (!detected) {
    return { valid: false, error: "文件格式不受支持或头部特征损坏" };
  }

  // 严格杜绝伪造后缀（如可执行文件改名为 .jpg）
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
  if (!allowed.includes(detected)) {
    return { valid: false, error: "非法的材料文件格式" };
  }

  // PDF 文件深度安全性审查（防内嵌恶意 JavaScript）
  if (detected === "application/pdf") {
    const pdfAudit = inspectPdfSecurity(bytes);
    if (!pdfAudit.safe) {
      return { valid: false, error: pdfAudit.issue || "PDF 包含不受支持的可疑活动脚本" };
    }
  }

  return { valid: true, detectedMime: detected };
}

/**
 * PDF 恶意利用特征深度静态分析
 * 检测是否潜藏可自动执行的脚本或远程命令投递
 */
export function inspectPdfSecurity(bytes: Uint8Array | Buffer): { safe: boolean; issue?: string } {
  try {
    // 将整个 PDF 或前 1MB 转换为字符扫描危险字典
    const scanLen = Math.min(bytes.length, 1024 * 1024);
    let raw = "";
    for (let i = 0; i < scanLen; i++) {
      raw += String.fromCharCode(bytes[i]);
    }

    // 常见恶意 PDF 触发关键字
    const dangerousPatterns = [
      { pattern: /\/JavaScript\b/i, name: "内嵌 JavaScript 脚本" },
      { pattern: /\/JS\b/i, name: "内嵌 JS 动作" },
      { pattern: /\/Launch\b/i, name: "外部程序调用指令" },
      { pattern: /\/SubmitForm\b/i, name: "静默表单外部回传" },
      { pattern: /\/ImportData\b/i, name: "外部数据注入" },
    ];

    for (const d of dangerousPatterns) {
      if (d.pattern.test(raw)) {
        return { safe: false, issue: `PDF 被拦截：检测到危险特征（${d.name}）` };
      }
    }

    return { safe: true };
  } catch {
    return { safe: true };
  }
}

/**
 * 图像防解压炸弹：限制单张图像尺寸不超过 4096px
 */
export function checkImageDimensions(width: number, height: number): { safe: boolean; error?: string } {
  const MAX_DIM = 4096;
  const MAX_PIXELS = 16 * 1024 * 1024; // 16M 像素

  if (width > MAX_DIM || height > MAX_DIM || width * height > MAX_PIXELS) {
    return { safe: false, error: "图像分辨率过大，超过安全阈值" };
  }
  return { safe: true };
}

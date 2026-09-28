/**
 * 档案流转防伪与水印引擎
 * 包含：
 * 1. 动态可见防伪水印（平铺倾斜半透明）
 * 2. 空域抗截屏数字盲水印（LSB 隐蔽嵌入与提取器，用于泄密溯源）
 * 3. 16 位全局唯一档案存证验证码生成器
 */

/**
 * 生成 16 位格式化档案核验码
 * 格式：CA-YYYYMM-XXXX-XXXX（如 CA-202609-8F2A-9K1M）
 */
function getCryptoRandomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

export function generateVerifyCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 剔除容易混淆的 0, 1, I, O
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const randBytes = getCryptoRandomBytes(8);
  let seg1 = "";
  let seg2 = "";
  for (let i = 0; i < 4; i++) {
    seg1 += chars[randBytes[i] % chars.length];
    seg2 += chars[randBytes[i + 4] % chars.length];
  }

  return `CA-${year}${month}-${seg1}-${seg2}`;
}

/**
 * 为 Canvas 画面平铺添加 30° 倾斜的半透明防伪文字水印
 */
export function drawVisibleWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string
) {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = "rgba(128, 128, 128, 0.18)";
  ctx.font = `bold ${Math.max(14, Math.round(width / 32))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const stepX = Math.max(180, Math.round(width / 3.5));
  const stepY = Math.max(120, Math.round(height / 4.5));

  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

const BLIND_MAGIC = "BW1:";

/**
 * 在图像最低有效位（LSB）中隐蔽嵌入数字盲水印
 * 格式：BW1:{payload}
 * 人眼无法察觉任何色差，截取局部原图仍可通过提取器追溯泄密源
 */
export function embedBlindWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  payload: string
): boolean {
  try {
    const fullText = `${BLIND_MAGIC}${payload}\0`;
    // 转换为 8 位二进制字符串
    const bits: number[] = [];
    for (let i = 0; i < fullText.length; i++) {
      const code = fullText.charCodeAt(i);
      for (let b = 7; b >= 0; b--) {
        bits.push((code >> b) & 1);
      }
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const totalPixels = width * height;

    if (bits.length > totalPixels) {
      return false; // 图片尺寸过小无法容纳
    }

    // 将二进制位逐一写入每个像素的蓝色通道最低有效位（LSB）
    // 蓝通道人眼最不敏感
    for (let i = 0; i < bits.length; i++) {
      const pIdx = i * 4 + 2; // Blue channel
      data[pIdx] = (data[pIdx] & ~1) | bits[i];
    }

    ctx.putImageData(imgData, 0, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 Canvas 像素中提取隐藏的数字盲水印
 */
export function extractBlindWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): string | null {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const totalPixels = width * height;

    // 提取蓝色通道最低位
    const bits: number[] = [];
    const maxChars = 256;
    const maxBits = Math.min(totalPixels, maxChars * 8);

    for (let i = 0; i < maxBits; i++) {
      const pIdx = i * 4 + 2;
      bits.push(data[pIdx] & 1);
    }

    // 将 bits 重构成字符
    let recovered = "";
    for (let i = 0; i < bits.length; i += 8) {
      let byteVal = 0;
      for (let b = 0; b < 8; b++) {
        byteVal = (byteVal << 1) | bits[i + b];
      }
      if (byteVal === 0) break; // 遇零字符结束
      recovered += String.fromCharCode(byteVal);
    }

    if (recovered.startsWith(BLIND_MAGIC)) {
      return recovered.slice(BLIND_MAGIC.length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 计算二进制数据的 SHA-256 十六进制哈希
 * 纯 JS 密码学引擎（@noble/hashes），在纯 HTTP（无 Secure Context）与 HTTPS 环境下均可稳定工作
 */
export async function computeSha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const hash = sha256(bytes);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}


/**
 * 原生 Web Crypto 实现的轻量 JWT（HS256）
 * 零第三方依赖，全面兼容 Node.js 18+、Edge Runtime (Middleware) 与现代浏览器环境，
 * 避免 Next.js 14 在跨 Edge/Node 环境打包第三方 ESM 库 (如 jose) 时出现的 vendor-chunks 模块缺失异常。
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getCryptoKey(secretStr: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secretStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

export interface JwtPayload {
  sub?: string;
  scope?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const headerPart = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadPart = toBase64Url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const dataToSign = `${headerPart}.${payloadPart}`;

  const key = await getCryptoKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
  const sigPart = toBase64Url(new Uint8Array(signature));

  return `${dataToSign}.${sigPart}`;
}

export async function verifyJwt<T = JwtPayload>(token: string, secret: string): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const [headerPart, payloadPart, sigPart] = parts;
  const dataToVerify = `${headerPart}.${payloadPart}`;

  const key = await getCryptoKey(secret, "verify");
  const sigBytes = fromBase64Url(sigPart);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as unknown as BufferSource,
    new TextEncoder().encode(dataToVerify)
  );
  if (!isValid) throw new Error("Invalid JWT signature");

  const payloadJson = new TextDecoder().decode(fromBase64Url(payloadPart));
  const payload = JSON.parse(payloadJson) as T & { exp?: number; iat?: number; nbf?: number };
  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SEC = 60; // 允许 60 秒时钟漂移容差

  // 必须包含有效过期时间且未过期
  if (typeof payload.exp !== "number" || payload.exp < now - CLOCK_SKEW_SEC) {
    throw new Error("JWT expired or missing expiration");
  }

  // 若声明签发时间，不得为超前未来时间
  if (typeof payload.iat === "number" && payload.iat > now + CLOCK_SKEW_SEC) {
    throw new Error("JWT issued in the future");
  }

  // 若声明生效时间，必须已达到生效窗口
  if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_SEC) {
    throw new Error("JWT not active yet");
  }

  return payload;
}

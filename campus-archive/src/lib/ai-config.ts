import crypto from "crypto";
import dns from "dns/promises";
import { prisma } from "@/lib/prisma";

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
}

let tableEnsured = false;

// —— API Key 加密存储：AES-256-GCM，密钥由 MASTER_KEY 派生（与文件加密隔离） ——
// 存储格式："ENC1:" + hex(iv12 + ciphertext + tag16)
// 向后兼容：库中历史明文 Key 不带前缀，读取时原样返回，下次保存时自动升级为密文
const ENC_PREFIX = "ENC1:";

function apiKeyEncryptionKey(): Buffer {
  // 复用 crypto.ts 的 MASTER_KEY 约束（生产缺配会抛错，fail-loud 一致）
  const hex = process.env.MASTER_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    const master = Buffer.from(hex, "hex");
    return crypto.hkdfSync("sha256", master, Buffer.from("ai-api-key"), Buffer.from("user-scope"), 32) as unknown as Buffer;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("[SECURITY] MASTER_KEY 未配置，无法安全存储 API Key");
  }
  const dev = crypto.createHash("sha256").update("dev-master-key").digest();
  return crypto.hkdfSync("sha256", dev, Buffer.from("ai-api-key"), Buffer.from("user-scope"), 32) as unknown as Buffer;
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", apiKeyEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, ct, tag]).toString("hex");
}

function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // 历史明文
  try {
    const blob = Buffer.from(stored.slice(ENC_PREFIX.length), "hex");
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const ct = blob.subarray(12, blob.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", apiKeyEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    // 密文损坏或 MASTER_KEY 轮换：按未配置处理，避免把乱码当 Key 发出去
    console.error("decrypt ai api key failed:", err);
    return "";
  }
}

export async function ensureAiSettingTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS UserAiSetting (
        userId TEXT PRIMARY KEY,
        apiKey TEXT NOT NULL,
        baseUrl TEXT NOT NULL,
        model TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    tableEnsured = true;
  } catch (err) {
    console.error("ensureAiSettingTable failed:", err);
  }
}

export function getDefaultAiConfig(): Omit<AiConfig, "isCustom"> {
  return {
    apiKey: process.env.AI_API_KEY?.trim() || "",
    baseUrl: process.env.AI_BASE_URL?.trim() || "https://api.deepseek.com/v1",
    model: process.env.AI_MODEL?.trim() || "deepseek-chat",
  };
}

export async function getUserAiConfig(userId: string): Promise<AiConfig> {
  await ensureAiSettingTable();
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT apiKey, baseUrl, model FROM UserAiSetting WHERE userId = ? LIMIT 1",
      userId
    )) as Array<{ apiKey: string; baseUrl: string; model: string }>;

    if (rows && rows.length > 0 && rows[0].apiKey) {
      return {
        apiKey: decryptSecret(rows[0].apiKey).trim(),
        baseUrl: rows[0].baseUrl.trim() || "https://api.deepseek.com/v1",
        model: rows[0].model.trim() || "deepseek-chat",
        isCustom: true,
      };
    }
  } catch (err) {
    console.error("getUserAiConfig query failed:", err);
  }

  const def = getDefaultAiConfig();
  return {
    ...def,
    isCustom: false,
  };
}

export async function saveUserAiConfig(
  userId: string,
  config: { apiKey?: string; baseUrl?: string; model?: string }
): Promise<AiConfig> {
  await ensureAiSettingTable();
  const trimmedKey = config.apiKey?.trim() || "";

  // 若清空 API Key，则恢复为系统默认
  if (!trimmedKey) {
    await prisma.$executeRawUnsafe(
      "DELETE FROM UserAiSetting WHERE userId = ?",
      userId
    );
    const def = getDefaultAiConfig();
    return { ...def, isCustom: false };
  }

  const baseUrl = config.baseUrl?.trim() || "https://api.deepseek.com/v1";
  const validation = await assertPublicAiEndpoint(baseUrl);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Base URL 格式无效");
  }

  const model = config.model?.trim() || "deepseek-chat";
  const now = new Date().toISOString();

  await prisma.$executeRawUnsafe(
    `INSERT INTO UserAiSetting (userId, apiKey, baseUrl, model, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       apiKey = excluded.apiKey,
       baseUrl = excluded.baseUrl,
       model = excluded.model,
       updatedAt = excluded.updatedAt`,
    userId,
    encryptSecret(trimmedKey),
    baseUrl,
    model,
    now
  );

  return {
    apiKey: trimmedKey,
    baseUrl,
    model,
    isCustom: true,
  };
}

/**
 * 校验 AI 接口的基础 URL，防范 SSRF（服务端请求伪造）
 * - 生产环境下必须为 https:// 协议
 * - 严格拦截环回地址（localhost, 127.0.0.1, ::1）
 * - 拦截云元数据接口（169.254.169.254）
 * - 拦截私有局域网 IP（10.*, 172.16.*-172.31.*, 192.168.*）
 */
export function validateAiBaseUrl(urlStr: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, error: "仅支持 http:// 或 https:// 协议" };
    }
    const hostname = parsed.hostname.toLowerCase();

    // 拦截环回地址与主机名
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
      return { valid: false, error: "禁止将 AI 接口设置为本地环回地址" };
    }

    // 拦截云服务元数据地址 (AWS, Aliyun, GCP, Tencent, etc.)
    if (hostname === "169.254.169.254") {
      return { valid: false, error: "禁止访问元数据服务地址" };
    }

    // 拦截私有局域网 IP
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { valid: false, error: "禁止访问私有内网地址" };
    }
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { valid: false, error: "禁止访问私有内网地址" };
    }
    const m172 = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (m172) {
      const secondOctet = Number(m172[1]);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return { valid: false, error: "禁止访问私有内网地址" };
      }
    }

    // 生产环境下强制要求 HTTPS
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return { valid: false, error: "生产环境 AI 接口必须使用 https:// 协议" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Base URL 格式无效" };
  }
}

// —— 以下是 DNS 级 SSRF 加固：字面量黑名单可被"域名解析到内网 IP"绕过 ——

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 本网络 / 私网 / 环回
  if (a === 169 && b === 254) return true; // link-local / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网
  if (a === 192 && b === 168) return true; // 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // 组播 / 保留
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // 未指定 / 环回
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 Unique Local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]); // IPv4-mapped
  return false;
}

/**
 * 在静态校验之上追加 DNS 解析校验：把域名解析到的一切地址都按私网段拦截。
 * 注意：仍存在 DNS rebinding TOCTOU 理论窗口（校验后再 fetch 会二次解析），
 * 对当前规模足够；若后续要求更高可在出网代理层统一做 egress 白名单。
 */
export async function assertPublicAiEndpoint(urlStr: string): Promise<{ valid: boolean; error?: string }> {
  const base = validateAiBaseUrl(urlStr);
  if (!base.valid) return base;

  let host: string;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return { valid: false, error: "Base URL 格式无效" };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return { valid: false, error: "无法解析该域名，请检查 AI 接口地址" };
  }
  if (!addresses || addresses.length === 0) {
    return { valid: false, error: "该域名没有任何解析记录" };
  }
  for (const { address, family } of addresses) {
    const bad = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (bad) {
      return { valid: false, error: "该地址解析到内网/保留 IP，已被安全策略拦截" };
    }
  }
  return { valid: true };
}

export function isVisionModel(model: string): boolean {
  if (!model) return false;
  // 支持 DeepSeek 多模态系列 (deepseek-vl, deepseek-vl2, deepseek-vision, deepseek-ai/...) 以及常见视觉大模型
  return /(?:vision|vl|4o|claude-3|gemini|4v|internvl|qwen-vl|deepseek-vl|deepseek-vision)/i.test(model);
}

export function formatEndpoint(baseUrl: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  if (cleanBase.endsWith("/chat/completions")) {
    return cleanBase;
  }
  if (/\/v\d+$/i.test(cleanBase) || /\/v\d+\//i.test(cleanBase)) {
    return `${cleanBase}/chat/completions`;
  }
  return `${cleanBase}/v1/chat/completions`;
}

export function parseAiErrorMessage(status: number, errText: string, model?: string): string {
  let detail = "";
  let errType = "";
  try {
    const json = JSON.parse(errText);
    if (json?.error?.message) {
      detail = String(json.error.message);
      errType = String(json.error.type || "");
    } else if (json?.message) {
      detail = String(json.message);
    } else if (typeof json?.error === "string") {
      detail = json.error;
    }
  } catch {
    if (errText) detail = errText.slice(0, 150);
  }

  const lowerDetail = (detail + " " + errType).toLowerCase();

  if (status === 429) {
    if (
      lowerDetail.includes("quota") ||
      lowerDetail.includes("balance") ||
      lowerDetail.includes("insufficient") ||
      lowerDetail.includes("exhausted") ||
      lowerDetail.includes("欠费") ||
      lowerDetail.includes("余额") ||
      lowerDetail.includes("额度")
    ) {
      return `AI 账户余额已耗尽或额度不足 (429)${detail ? `：${detail}` : "，请前往对应大模型平台充值或检查额度"}`;
    }
    return `AI 请求频次或并发超限 (429)${detail ? `：${detail}` : "，请稍等片刻后再试"}`;
  }

  if (status === 401) {
    return `AI 鉴权失败 (401)${detail ? `：${detail}` : "，请核对 API Key 是否正确或已失效"}`;
  }

  if (status === 404) {
    return `AI 模型或接口不存在 (404)${model ? `：模型 "${model}" 未找到` : detail ? `：${detail}` : ""}`;
  }

  if (status >= 500) {
    return `AI 服务商暂时故障 (${status})${detail ? `：${detail}` : "，请稍后重试"}`;
  }

  return detail ? `AI 服务响应异常 (${status}): ${detail}` : `AI 服务响应异常 (${status})`;
}

export async function callAiChatWithRetry(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{ ok: true; content: string } | { ok: false; error: string; status: number }> {
  const {
    endpoint,
    apiKey,
    model,
    messages,
    temperature = 0.1,
    max_tokens,
    timeoutMs = 15000,
    maxRetries = 1,
  } = options;

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const apiRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          ...(max_tokens ? { max_tokens } : {}),
        }),
        signal: controller.signal,
      });

      if (apiRes.ok) {
        const resJson = await apiRes.json().catch(() => null);
        const rawContent = resJson?.choices?.[0]?.message?.content;
        if (typeof rawContent !== "string") {
          return { ok: false, error: "AI 服务返回格式无效", status: 502 };
        }
        return { ok: true, content: rawContent };
      }

      const errText = await apiRes.text().catch(() => "");
      const isBalanceExhausted = /quota|balance|exhausted|欠费|余额/i.test(errText);

      // 如果是 429 频次超限且仍有重试配额，且不是余额用尽，等待 1.5 秒后自动重试一次
      if (apiRes.status === 429 && attempt <= maxRetries && !isBalanceExhausted) {
        const retryAfterHeader = apiRes.headers.get("retry-after");
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        const waitMs = (retryAfterSec > 0 && retryAfterSec <= 5 ? retryAfterSec : 1.5) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      const friendlyMsg = parseAiErrorMessage(apiRes.status, errText, model);
      return { ok: false, error: friendlyMsg, status: apiRes.status };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        if (attempt <= maxRetries) {
          continue;
        }
        return { ok: false, error: `AI 请求响应超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`, status: 504 };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : "请求 AI 服务失败，请检查网络连接",
        status: 500,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: "AI 服务请求失败", status: 502 };
}

export async function testAiConnection(config: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    return { ok: false, error: "未输入 API Key" };
  }

  const baseUrl = config.baseUrl?.trim() || "https://api.deepseek.com/v1";
  const validation = await assertPublicAiEndpoint(baseUrl);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const model = config.model?.trim() || "deepseek-chat";
  const endpoint = formatEndpoint(baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const errMsg = parseAiErrorMessage(res.status, errText, model);
      return { ok: false, error: errMsg };
    }

    const json = await res.json().catch(() => null);
    if (!json?.choices) {
      return { ok: false, error: "返回数据格式不符合 OpenAI 协议" };
    }

    return { ok: true, message: `连接成功 (${model})` };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "连接请求超时（超过 8 秒）" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "连接失败，请检查网络或地址",
    };
  } finally {
    clearTimeout(timeout);
  }
}

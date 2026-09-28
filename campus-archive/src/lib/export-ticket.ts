import crypto from "crypto";

export interface ExportTicketPayload {
  sub: string;             // userId
  verifyCode: string;
  manifestSummary: string;
  docCount: number;
  categoryKeys: string[];
  watermarkText: string | null;
  exp: number;
}

// 生产环境 auth.ts 已强制要求 AUTH_SECRET（缺失即拒绝启动），这里的兜底值只服务本地开发，
// 不用公开可知的固定字符串当签名密钥。
const TICKET_SECRET =
  process.env.AUTH_SECRET ||
  crypto.createHash("sha256").update("dev-export-ticket-key").digest("hex");

export function createExportTicket(payload: ExportTicketPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TICKET_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifyExportTicket(ticket: string, userId: string): ExportTicketPayload | null {
  if (!ticket || typeof ticket !== "string") return null;
  const dotIndex = ticket.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = ticket.slice(0, dotIndex);
  const sig = ticket.slice(dotIndex + 1);
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto.createHmac("sha256", TICKET_SECRET).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ExportTicketPayload;
    if (payload.sub !== userId) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function signExportRecord(verifyCode: string, sha256: string, manifestSummary: string, userId: string): string {
  return crypto
    .createHmac("sha256", TICKET_SECRET)
    .update(`${verifyCode}:${sha256}:${manifestSummary}:${userId}`)
    .digest("hex");
}

export function verifyRecordSignature(
  signature: string | null | undefined,
  verifyCode: string,
  sha256: string,
  manifestSummary: string,
  userId: string
): boolean {
  if (!signature) return false;
  const expected = signExportRecord(verifyCode, sha256, manifestSummary, userId);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

import { prisma } from "./prisma";
import { headers } from "next/headers";
import { getClientIp } from "./rate-limit";

// 敏感操作与安全审计：记录谁在什么时候从什么 IP 查看/下载/导出/删除/验证/登录
// 审计写入失败不阻塞主流程（宁可少一条日志，不让用户操作失败）。
export type AuditAction =
  | "login"
  | "logout"
  | "view"
  | "download"
  | "export"
  | "verify"
  | "delete"
  | "edit"
  | "ai-vision-ocr"
  | "ai-ask";

function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip);
}

export function extractClientIp(req?: Request): string {
  if (req) {
    return getClientIp(req);
  }
  try {
    const h = headers();
    // 1. 优先获取底层 server-entry 注入的不可伪造的 TCP Socket 对端物理 IP
    const socketIp = h.get("x-socket-ip")?.trim();
    if (socketIp && isValidIp(socketIp)) return socketIp;

    // 2. 仅在明确设置 TRUST_PROXY=true 时才允许解析代理头，杜绝未认证代理头伪造
    if (process.env.TRUST_PROXY === "true") {
      const cfIp = h.get("cf-connecting-ip")?.trim();
      if (cfIp && isValidIp(cfIp)) return cfIp;
      const realIp = h.get("x-real-ip")?.trim();
      if (realIp && isValidIp(realIp)) return realIp;
      const forwarded = h.get("x-forwarded-for");
      if (forwarded) {
        const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
        const rightmost = parts[parts.length - 1];
        if (rightmost && isValidIp(rightmost)) return rightmost;
      }
    }
  } catch {
    // 外部无请求上下文时回退
  }
  return "127.0.0.1";
}

export async function logAudit(
  userId: string,
  action: AuditAction,
  opts?: { docId?: string; docTitle?: string; detail?: string; ip?: string; req?: Request }
) {
  try {
    const ip = opts?.ip || extractClientIp(opts?.req);
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ...(opts?.docId ? { docId: opts.docId } : {}),
        ...(opts?.docTitle ? { docTitle: opts.docTitle } : {}),
        ...(opts?.detail ? { detail: opts.detail.slice(0, 200) } : {}),
        ip,
      },
    });
  } catch (e) {
    console.warn("audit log failed", e);
  }
}


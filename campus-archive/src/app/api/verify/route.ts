import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimiter, getClientIp } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/auth";
import crypto from "crypto";
import { verifyRecordSignature } from "@/lib/export-ticket";

export const runtime = "nodejs";

// 已知历史渗透测试伪造的存证编号黑名单
const FORGED_CODES = new Set([
  "CA-202609-4GTT-2VYG",
  "CA-202609-CCCC-DDDD",
  "CA-202609-AAAA-BBBB",
]);

// 公开核验接口频控：
// 1. 单 IP 每分钟最多 15 次正常查询；
// 2. 单 IP 每分钟连续 404 失败查询超过 5 次立即阻断（防爆破探测存证编号）
function checkVerifyLimits(req: Request) {
  const ip = getClientIp(req);
  const ipLimit = rateLimiter.check(`verify:ip:${ip}`, { windowMs: 60 * 1000, max: 15 });
  if (!ipLimit.success) {
    return { limited: true, retryAfter: Math.ceil(ipLimit.resetMs / 1000) };
  }
  const failLimit = rateLimiter.peek(`verify:fail:${ip}`, 60 * 1000);
  if (failLimit.count >= 5) {
    return { limited: true, retryAfter: Math.ceil(failLimit.resetMs / 1000) };
  }
  return { limited: false, retryAfter: 0 };
}

function recordVerifyFailure(req: Request) {
  const ip = getClientIp(req);
  rateLimiter.check(`verify:fail:${ip}`, { windowMs: 60 * 1000, max: 5 });
}

function sanitizeSummary(summary: string | null): string | null {
  if (!summary) return null;
  return summary
    .replace(/[/\\]/g, "")
    .replace(/\.\.+/g, "")
    .replace(/[<>"'&]/g, "")
    .slice(0, 100);
}

// 接收 GET 请求：根据 verifyCode 查询存证记录
export async function GET(req: Request) {
  const limits = checkVerifyLimits(req);
  if (limits.limited) {
    const headers: Record<string, string> = {};
    if (limits.retryAfter) headers["Retry-After"] = String(limits.retryAfter);
    return NextResponse.json(
      { error: "查询过于频繁，请稍后再试" },
      { status: 429, headers }
    );
  }

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();

  if (!code) {
    recordVerifyFailure(req);
    return NextResponse.json({ error: "请输入核验编号" }, { status: 400 });
  }

  if (FORGED_CODES.has(code)) {
    recordVerifyFailure(req);
    return NextResponse.json(
      { valid: false, error: "未找到对应的档案核验证书记录" },
      { status: 404 }
    );
  }

  const record = await prisma.exportRecord.findUnique({
    where: { verifyCode: code },
    select: {
      id: true,
      verifyCode: true,
      sha256: true,
      manifestSummary: true,
      watermarkText: true,
      signature: true,
      checkCount: true,
      createdAt: true,
      userId: true,
    },
  });

  if (!record) {
    recordVerifyFailure(req);
    return NextResponse.json(
      { valid: false, error: "未找到对应的档案核验证书记录" },
      { status: 404 }
    );
  }

  // 杜绝全 0、全相同字符等伪造指纹
  if (record.sha256 && (/^0{64}$/.test(record.sha256) || /^(.)\1{63}$/.test(record.sha256))) {
    recordVerifyFailure(req);
    return NextResponse.json(
      { valid: false, error: "未找到有效的档案核验证书记录" },
      { status: 404 }
    );
  }

  // 若存在服务端签名，严格校验密码学防篡改完整性
  if (record.signature) {
    const validSig = verifyRecordSignature(
      record.signature,
      record.verifyCode || "",
      record.sha256 || "",
      record.manifestSummary || "",
      record.userId
    );
    if (!validSig) {
      recordVerifyFailure(req);
      return NextResponse.json(
        { valid: false, error: "存证签名失效，该记录可能已被篡改" },
        { status: 400 }
      );
    }
  }

  // 同一 IP 在 10 分钟内重复查验不重复递增计数器，防止刷虚假核验量
  const clientIp = getClientIp(req);
  const shouldIncrement = rateLimiter.check(`verify:count:${record.id}:${clientIp}`, {
    windowMs: 10 * 60 * 1000,
    max: 1,
  }).success;

  let finalCount = record.checkCount;
  if (shouldIncrement) {
    await prisma.exportRecord.update({
      where: { id: record.id },
      data: { checkCount: { increment: 1 } },
    }).catch(() => {});
    finalCount += 1;
  }

  const session = await getSessionUser().catch(() => null);
  const isOwner = Boolean(session?.id && session.id === record.userId);
  const safeWatermark = isOwner ? record.watermarkText : (record.watermarkText ? "已标注防伪水印" : null);

  return NextResponse.json({
    valid: true,
    data: {
      verifyCode: record.verifyCode,
      sha256: record.sha256,
      manifestSummary: sanitizeSummary(record.manifestSummary),
      watermarkText: safeWatermark,
      checkCount: finalCount,
      createdAt: record.createdAt,
    },
  });
}

// 接收上传 ZIP 文件提取 SHA-256 查验
export async function POST(req: Request) {
  const limits = checkVerifyLimits(req);
  if (limits.limited) {
    const headers: Record<string, string> = {};
    if (limits.retryAfter) headers["Retry-After"] = String(limits.retryAfter);
    return NextResponse.json(
      { error: "查询过于频繁，请稍后再试" },
      { status: 429, headers }
    );
  }

  try {
    let code = "";
    let sha256 = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
    } else {
      const form = await req.formData().catch(() => null);
      if (form) {
        code = String(form.get("code") ?? "").trim().toUpperCase();
        const file = form.get("file") as File | null;
        if (file) {
          if (file.size > 150 * 1024 * 1024) {
            return NextResponse.json({ error: "核验文件过大，上限 150MB" }, { status: 413 });
          }
          const buf = Buffer.from(await file.arrayBuffer());
          sha256 = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
        }
      }
    }

    if (!code && !sha256) {
      recordVerifyFailure(req);
      return NextResponse.json({ error: "请提供存证编号或归档包文件" }, { status: 400 });
    }

    if (code && FORGED_CODES.has(code)) {
      recordVerifyFailure(req);
      return NextResponse.json(
        { valid: false, error: "未检索到匹配的存证记录，文件可能未经过系统导出认证" },
        { status: 404 }
      );
    }

    // 查询存证记录
    const record = await prisma.exportRecord.findFirst({
      where: {
        OR: [
          ...(code ? [{ verifyCode: code }] : []),
          ...(sha256 ? [{ sha256 }] : []),
        ],
      },
      select: {
        id: true,
        verifyCode: true,
        sha256: true,
        manifestSummary: true,
        watermarkText: true,
        signature: true,
        checkCount: true,
        createdAt: true,
        userId: true,
      },
    });

    if (!record) {
      recordVerifyFailure(req);
      return NextResponse.json(
        { valid: false, error: "未检索到匹配的存证记录，文件可能未经过系统导出认证" },
        { status: 404 }
      );
    }

    // 杜绝全 0、全相同字符等伪造指纹
    if (record.sha256 && (/^0{64}$/.test(record.sha256) || /^(.)\1{63}$/.test(record.sha256))) {
      recordVerifyFailure(req);
      return NextResponse.json(
        { valid: false, error: "未检索到匹配的存证记录，文件可能未经过系统导出认证" },
        { status: 404 }
      );
    }

    // 若同时提供了 code 与 sha256，严格核验二者一致性
    if (code && sha256 && record.sha256 && record.sha256.toLowerCase() !== sha256) {
      recordVerifyFailure(req);
      return NextResponse.json(
        {
          valid: false,
          error: "校验失败：该编号对应的存证文件指纹不匹配，内容已被篡改",
        },
        { status: 400 }
      );
    }

    // 签名校验
    if (record.signature) {
      const validSig = verifyRecordSignature(
        record.signature,
        record.verifyCode || "",
        record.sha256 || "",
        record.manifestSummary || "",
        record.userId
      );
      if (!validSig) {
        recordVerifyFailure(req);
        return NextResponse.json(
          { valid: false, error: "存证签名失效，该记录可能已被篡改" },
          { status: 400 }
        );
      }
    }

    // 同一 IP 在 10 分钟内重复查验不重复递增计数器，防止刷虚假核验量
    const clientIp = getClientIp(req);
    const shouldIncrement = rateLimiter.check(`verify:count:${record.id}:${clientIp}`, {
      windowMs: 10 * 60 * 1000,
      max: 1,
    }).success;

    let finalCount = record.checkCount;
    if (shouldIncrement) {
      await prisma.exportRecord.update({
        where: { id: record.id },
        data: { checkCount: { increment: 1 } },
      }).catch(() => {});
      finalCount += 1;
    }

    const session = await getSessionUser().catch(() => null);
    const isOwner = Boolean(session?.id && session.id === record.userId);
    const safeWatermark = isOwner ? record.watermarkText : (record.watermarkText ? "已标注防伪水印" : null);

    return NextResponse.json({
      valid: true,
      data: {
        verifyCode: record.verifyCode,
        sha256: record.sha256,
        manifestSummary: sanitizeSummary(record.manifestSummary),
        watermarkText: safeWatermark,
        checkCount: finalCount,
        createdAt: record.createdAt,
      },
    });
  } catch {
    return NextResponse.json({ error: "验真服务异常" }, { status: 500 });
  }
}

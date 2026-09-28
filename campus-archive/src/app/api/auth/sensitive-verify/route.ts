import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionUser, grantSensitiveAccess, hasSensitiveAccess } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rateLimiter } from "@/lib/rate-limit";

// 敏感证件二次验证：输入密码换取 10 分钟查看窗口；
// 勾选"信任此设备"后 30 天内免输密码（可在设置中移除设备）
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) ?? {};
  const { password, trustDevice, label } = body as {
    password?: unknown;
    trustDevice?: unknown;
    label?: unknown;
  };
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "请输入密码" }, { status: 400 });
  }

  // 基础频控：单账号每分钟最多尝试 10 次，防止瞬时高并发打满 CPU
  const verifyKey = `verify:user:${session.id}`;
  const limit = rateLimiter.check(verifyKey, { windowMs: 60 * 1000, max: 10 });
  if (!limit.success) {
    return NextResponse.json(
      { error: "密码尝试过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) },
      }
    );
  }

  const failKey = `verify:fails:${session.id}`;
  const FAIL_WINDOW_MS = 15 * 60 * 1000;
  const MAX_FAILS = 5;

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  const isMatch = user && (await bcrypt.compare(password, user.password));

  if (!isMatch) {
    // 递增记录失败次数（15分钟滑动窗口，上限 5 次）
    const failRecord = rateLimiter.check(failKey, { windowMs: FAIL_WINDOW_MS, max: MAX_FAILS });
    const failCount = MAX_FAILS - failRecord.remaining;

    await logAudit(session.id, "verify", {
      detail: `二次验证密码错误（连续失败 ${failCount} 次）`,
      req,
    });

    if (!failRecord.success || failCount >= MAX_FAILS) {
      const waitSec = Math.ceil(failRecord.resetMs / 1000) || 900;
      return NextResponse.json(
        { error: "密码连续错误达上限，二次验证已锁定 15 分钟" },
        { status: 429, headers: { "Retry-After": String(waitSec) } }
      );
    }

    if (failCount >= 3) {
      // 连续失败 3 次以上，延迟 1.5 秒响应增加爆破成本
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  // 口令正确：清除失败计数与频控桶（解除之前因误触导致的锁定）
  rateLimiter.reset(verifyKey);
  rateLimiter.reset(failKey);

  const trust = trustDevice === true;
  const granted = await grantSensitiveAccess(session.id, {
    trustDevice: trust,
    label: typeof label === "string" ? label : undefined,
  });

  if (!granted) {
    await logAudit(session.id, "verify", {
      detail: "二次验证失败（未能绑定有效会话）",
      req,
    });
    return NextResponse.json(
      { error: "会话异常，未能建立敏感授权，请重新登录" },
      { status: 500 }
    );
  }

  await logAudit(session.id, "verify", {
    detail: trust ? "二次验证通过，并信任此设备 30 天" : "二次验证通过（10 分钟窗口）",
    req,
  });
  return NextResponse.json({ ok: true, expiresIn: 600, trusted: trust });
}

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ granted: await hasSensitiveAccess(session.id) });
}

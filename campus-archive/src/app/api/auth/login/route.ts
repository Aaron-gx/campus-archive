import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isValidAccount } from "@/lib/constants";
import { createSession } from "@/lib/auth";

import { rateLimiter, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

// 预热假哈希（用于消除账号不存在与存在时的计算时序差异，抵御用户枚举攻击）
const DUMMY_HASH = "$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { account, password } = body;
  if (typeof account !== "string" || typeof password !== "string" || !account.trim() || !password) {
    return NextResponse.json({ error: "请填写账号和密码" }, { status: 400 });
  }

  const cleanAccount = account.trim().toLowerCase();
  const kind = isValidAccount(cleanAccount);
  if (!kind) {
    return NextResponse.json({ error: "账号格式不正确" }, { status: 400 });
  }

  // 1. IP 维度限流：防止海量并发扫号与算力耗尽 DoS（单 IP 15 次/分钟）
  const ip = getClientIp(req);
  const ipLimit = rateLimiter.check(`login:ip:${ip}`, { windowMs: 60 * 1000, max: 15 });
  if (!ipLimit.success) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipLimit.resetMs / 1000)) },
      }
    );
  }

  // 2. 账号维度限流：防止攻击者轮换 IP 爆破同一账号（单账号 5 分钟内最多尝试 5 次）
  const accountKey = `login:acc:${cleanAccount}`;
  const accountLimit = rateLimiter.check(accountKey, { windowMs: 5 * 60 * 1000, max: 5 });
  if (!accountLimit.success) {
    return NextResponse.json(
      { error: "密码尝试次数过多，该账号已被临时锁定，请 5 分钟后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(accountLimit.resetMs / 1000)) },
      }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: kind === "phone" ? { phone: cleanAccount } : { email: cleanAccount },
    });

    const passwordHash = user ? user.password : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, passwordHash);

    // 统一错误信息并保持恒定计算时耗，避免暴露账号是否存在
    if (!user || !passwordMatch) {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    // 登录成功：清除该账号与当前 IP 的限流计数
    rateLimiter.reset(accountKey);
    rateLimiter.reset(`login:ip:${ip}`);

    await logAudit(user.id, "login", { detail: "账号登录", ip, req });
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, nickname: user.nickname } });
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}

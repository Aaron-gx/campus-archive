import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isValidAccount } from "@/lib/constants";
import { createSession } from "@/lib/auth";
import { rateLimiter, getClientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // 防恶意刷号与 bcrypt 算力耗尽 DoS：单 IP 限制 15 分钟内最多注册 5 次
  const ip = getClientIp(req);
  const limit = rateLimiter.check(`register:${ip}`, { windowMs: 15 * 60 * 1000, max: 5 });
  if (!limit.success) {
    return NextResponse.json(
      { error: "注册请求过多，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) },
      }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  try {
    const { account, password, nickname, school } = body;

    if (typeof account !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "请填写账号和密码" }, { status: 400 });
    }
    const cleanAccount = account.trim().toLowerCase();
    const kind = isValidAccount(cleanAccount);
    if (!kind) {
      return NextResponse.json({ error: "账号需为大陆手机号或有效邮箱（推荐学校邮箱）" }, { status: 400 });
    }
    if (password.length < 8 || password.length > 64) {
      return NextResponse.json({ error: "密码长度需为 8-64 位" }, { status: 400 });
    }

    const weakPasswords = ["12345678", "password", "password123", "admin123", "123456789"];
    if (weakPasswords.includes(password.toLowerCase())) {
      return NextResponse.json({ error: "密码过于简单，请使用包含字母与数字的组合" }, { status: 400 });
    }

    const where = kind === "phone" ? { phone: cleanAccount } : { email: cleanAccount };
    const existing = await prisma.user.findUnique({ where });
    if (existing) {
      // 增加轻量伪 hash 运算模拟耗时，对齐时间侧信道，抵御用户名爆破枚举
      await bcrypt.hash("timing_padding_placeholder", 12);
      return NextResponse.json({ error: "该账号已注册，请直接登录" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        phone: kind === "phone" ? cleanAccount : null,
        email: kind === "email" ? cleanAccount : null,
        nickname: (typeof nickname === "string" && nickname.trim()) || "同学",
        school: typeof school === "string" && school.trim() ? school.trim() : null,
        password: hashed,
      },
      select: { id: true, nickname: true },
    });

    await createSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    // 并发注册撞唯一约束（check-then-create 竞态）：返回 409 而非 500
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "该账号已注册，请直接登录" }, { status: 409 });
    }
    console.error("register error", e);
    return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 端到端加密密钥托管：
// - e2eeSalt / e2eeWrappedKey 由客户端生成并加密后上传，服务器只存密文，
//   没有用户密码无法解出数据密钥（数据库泄露 ≠ 文件泄露）
// - GET    返回当前托管状态（未启用时两项为 null）
// - PUT    首次启用 / 改密码时重包裹（客户端用新密码重新加密 DEK）
const HEX32 = /^[0-9a-f]{32}$/i; // salt 16 字节
const HEX_WRAP = /^[0-9a-f]{96,512}$/i; // 包裹后的 DEK（nonce12+ct32+tag16=60B=120 hex，留余量）

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [user, docCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.id },
      select: { e2eeSalt: true, e2eeWrappedKey: true },
    }),
    prisma.document.count({
      where: { userId: session.id, e2ee: true },
    }),
  ]);

  return NextResponse.json({
    enabled: Boolean(user?.e2eeSalt && user?.e2eeWrappedKey),
    salt: user?.e2eeSalt ?? null,
    wrappedKey: user?.e2eeWrappedKey ?? null,
    hasDocs: docCount > 0,
  });
}

export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    salt?: string;
    wrappedKey?: string;
    password?: string;
  } | null;
  const salt = body?.salt ?? "";
  const wrappedKey = body?.wrappedKey ?? "";
  if (!HEX32.test(salt) || !HEX_WRAP.test(wrappedKey)) {
    return NextResponse.json({ error: "E2EE 参数格式不正确" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { e2eeSalt: true, password: true },
  });

  // 已启用 E2EE 的账户覆盖托管必须二次验证密码：
  // 否则会话一旦被劫持（XSS/cookie 窃取），攻击者一次 PUT 垃圾 wrappedKey
  // 即可让用户全部端到端文件永久无法解密（不可逆数据毁灭）
  if (existingUser?.e2eeSalt) {
    if (typeof body?.password !== "string" || !body.password) {
      return NextResponse.json({ error: "更新密钥托管需输入登录密码", code: "PASSWORD_REQUIRED" }, { status: 403 });
    }
    const ok = await bcrypt.compare(body.password, existingUser.password);
    if (!ok) {
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }
  }

  if (existingUser?.e2eeSalt && salt.toLowerCase() !== existingUser.e2eeSalt.toLowerCase()) {
    const docCount = await prisma.document.count({
      where: { userId: session.id, e2ee: true },
    });
    if (docCount > 0) {
      return NextResponse.json({ error: "已存在加密档案，禁止重置加密盐" }, { status: 400 });
    }
  }

  await prisma.user.update({
    where: { id: session.id },
    data: { e2eeSalt: salt.toLowerCase(), e2eeWrappedKey: wrappedKey.toLowerCase() },
  });
  return NextResponse.json({ ok: true });
}

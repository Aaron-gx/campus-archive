import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { isValidAccount } from "@/lib/constants";
import { groupDocs } from "@/lib/document-group";

export const runtime = "nodejs";

// 管理员：用户列表（支持按账号/昵称/学校搜索）
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  // 用户管理页：不做分页（前端一次性渲染），但加 take 上限防止用户表无限增长时全量加载拖垮查询
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { nickname: { contains: q } },
            { school: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      phone: true,
      email: true,
      school: true,
      nickname: true,
      role: true,
      createdAt: true,
    },
  });

  const userIds = users.map((u) => u.id);
  const [allDocs, certStats] = await Promise.all([
    prisma.document.findMany({
      where: { userId: { in: userIds } },
      select: {
        id: true,
        userId: true,
        categoryId: true,
        groupId: true,
        title: true,
        side: true,
        sideOrder: true,
        createdAt: true,
        size: true,
      },
    }),
    prisma.certificate.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _count: { _all: true },
    }),
  ]);

  const userDocsMap = new Map<string, typeof allDocs>();
  for (const d of allDocs) {
    const list = userDocsMap.get(d.userId) ?? [];
    list.push(d);
    userDocsMap.set(d.userId, list);
  }
  const certMap = new Map(certStats.map((c) => [c.userId, c]));

  return NextResponse.json({
    users: users.map((u) => {
      const uDocs = userDocsMap.get(u.id) ?? [];
      const docGroups = groupDocs(uDocs);
      return {
        id: u.id,
        account: u.phone ?? u.email ?? "—",
        nickname: u.nickname,
        school: u.school,
        role: u.role,
        createdAt: u.createdAt,
        documentCount: docGroups.length,
        certificateCount: certMap.get(u.id)?._count._all ?? 0,
        storageUsed: uDocs.reduce((s, d) => s + d.size, 0),
      };
    }),
  });
}

// 管理员：新增用户
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    account?: string;
    password?: string;
    nickname?: string;
    school?: string;
    role?: string;
  } | null;

  const account = String(body?.account ?? "").trim();
  const password = String(body?.password ?? "");
  const nickname = String(body?.nickname ?? "").trim() || "同学";
  const school = String(body?.school ?? "").trim() || null;
  const role = body?.role === "admin" ? "admin" : "user";

  const kind = isValidAccount(account);
  if (!kind) {
    return NextResponse.json({ error: "账号需为大陆手机号或有效邮箱" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 64) {
    return NextResponse.json({ error: "密码长度需 8-64 位" }, { status: 400 });
  }

  const where = kind === "phone" ? { phone: account } : { email: account };
  const existing = await prisma.user.findUnique({ where });
  if (existing) {
    return NextResponse.json({ error: "该账号已被注册" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      phone: kind === "phone" ? account : null,
      email: kind === "email" ? account : null,
      nickname,
      school,
      role,
      password: await bcrypt.hash(password, 12),
    },
    select: { id: true, nickname: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}

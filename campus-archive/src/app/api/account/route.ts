import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionUser, destroySession, revokeAllSessions } from "@/lib/auth";
import { deleteUserDir } from "@/lib/storage";
import { groupDocs } from "@/lib/document-group";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      phone: true,
      email: true,
      school: true,
      nickname: true,
      role: true,
      avatar: true,
      createdAt: true,
      documents: {
        select: {
          id: true,
          title: true,
          groupId: true,
          categoryId: true,
          side: true,
          sideOrder: true,
          createdAt: true,
          size: true,
        },
      },
      certificates: { select: { id: true } },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, action: true, docTitle: true, detail: true, ip: true, createdAt: true },
      },
      trustedDevices: {
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, label: true, createdAt: true, expiresAt: true },
      },
    },
  });
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const docGroups = groupDocs(user.documents);

  return NextResponse.json({
    user: {
      id: user.id,
      nickname: user.nickname,
      role: user.role,
      avatar: user.avatar,
      phone: user.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") : null,
      email: user.email,
      school: user.school,
      createdAt: user.createdAt,
      documentCount: docGroups.length,
      certificateCount: user.certificates.length,
      storageUsed: user.documents.reduce((s, d) => s + d.size, 0),
      auditLogs: user.auditLogs,
      trustedDevices: user.trustedDevices,
    },
  });
}

// 修改昵称/学校
export async function PATCH(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { nickname, school } = body;
  const updated = await prisma.user.update({
    where: { id: session.id },
    data: {
      ...(typeof nickname === "string" && nickname.trim() ? { nickname: nickname.trim() } : {}),
      ...(typeof school === "string" ? { school: school.trim() || null } : {}),
    },
    select: { nickname: true, school: true },
  });
  return NextResponse.json({ user: updated });
}

// 修改密码：需验证旧密码，成功后吊销全部历史会话
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { oldPassword, newPassword, newWrappedKey } = body;
  if (typeof oldPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "新密码长度需至少 8 位" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
    return NextResponse.json({ error: "原密码错误" }, { status: 401 });
  }

  const HEX_WRAP = /^[0-9a-f]{96,512}$/i;
  const updateData: { password: string; e2eeWrappedKey?: string } = {
    password: await bcrypt.hash(newPassword, 12),
  };
  if (typeof newWrappedKey === "string" && HEX_WRAP.test(newWrappedKey)) {
    updateData.e2eeWrappedKey = newWrappedKey.toLowerCase();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });

  // 改密后：使该用户所有历史设备的登录会话与"信任此设备"全部失效
  // （被窃取的 trusted_device cookie 不清除的话，改密后仍可 30 天免验看敏感证件）
  await revokeAllSessions(user.id);
  await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
  await destroySession();
  return NextResponse.json({ ok: true });
}

// 注销账户：安全清理所有关联数据与物理文件
export async function DELETE(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { password, confirm } = body;
  if (confirm !== "注销") {
    return NextResponse.json({ error: '请输入"注销"以确认' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || !(await bcrypt.compare(String(password ?? ""), user.password))) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  try {
    // 事务中显式清理关联记录，保证 SQLite 外键一致性
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.userAiSetting.deleteMany({ where: { userId: user.id } }),
      prisma.auditLog.deleteMany({ where: { userId: user.id } }),
      prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
      prisma.certificate.deleteMany({ where: { userId: user.id } }),
      prisma.document.deleteMany({ where: { userId: user.id } }),
      prisma.exportRecord.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    try {
      await deleteUserDir(user.id);
    } catch (fsErr) {
      console.warn(`[WARN] 物理存储目录清理异常 (userId: ${user.id}):`, fsErr);
    }
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete account error", err);
    return NextResponse.json({ error: "注销失败，请稍后重试" }, { status: 500 });
  }
}

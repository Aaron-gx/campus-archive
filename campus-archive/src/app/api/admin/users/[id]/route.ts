import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getAdminUser, revokeAllSessions } from "@/lib/auth";
import { deleteUserDir } from "@/lib/storage";

export const runtime = "nodejs";

// 管理员：修改用户（昵称/学校/角色/重置密码）
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    nickname?: string;
    school?: string;
    role?: string;
    password?: string;
  } | null;

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  // 防误操作：不能取消自己的管理员角色
  if (target.id === admin.id && body?.role === "user") {
    return NextResponse.json({ error: "不能取消自己的管理员权限" }, { status: 400 });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  if (password && (password.length < 8 || password.length > 64)) {
    return NextResponse.json({ error: "新密码长度需 8-64 位" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(typeof body?.nickname === "string" && body.nickname.trim()
        ? { nickname: body.nickname.trim() }
        : {}),
      ...(typeof body?.school === "string" ? { school: body.school.trim() || null } : {}),
      ...(body?.role === "admin" || body?.role === "user" ? { role: body.role } : {}),
      ...(password ? { password: await bcrypt.hash(password, 12) } : {}),
    },
    select: { id: true, nickname: true, school: true, role: true },
  });

  // 重置密码后旧密钥（用旧密码包裹）无法解开，清掉托管让用户下次登录重建；
  // 同时吊销该用户全部会话（与用户自助改密行为对齐），旧登录态立即失效
  if (password) {
    await prisma.user.update({
      where: { id: target.id },
      data: { e2eeSalt: null, e2eeWrappedKey: null },
    });
    await revokeAllSessions(target.id);
  }

  return NextResponse.json({ user: updated });
}

// 管理员：删除用户（数据库级联 + 物理文件）
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  if (params.id === admin.id) {
    return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  await prisma.user.delete({ where: { id: target.id } }); // 级联删除文档/证书/导出记录
  await deleteUserDir(target.id);
  return NextResponse.json({ ok: true });
}

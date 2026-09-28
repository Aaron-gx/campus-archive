import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// 信任设备管理：列表 + 移除（移除后该设备查看敏感证件需重新验证）
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const devices = await prisma.trustedDevice.findMany({
    where: { userId: session.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, expiresAt: true },
  });
  return NextResponse.json({ devices });
}

export async function DELETE(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) ?? {};
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "缺少设备 ID" }, { status: 400 });
  }
  // 只能删自己的设备
  await prisma.trustedDevice.deleteMany({ where: { id, userId: session.id } });
  return NextResponse.json({ ok: true });
}

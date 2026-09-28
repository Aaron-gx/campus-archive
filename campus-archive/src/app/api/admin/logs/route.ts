import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const action = searchParams.get("action")?.trim() || "";
  const userId = searchParams.get("userId")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "25", 10) || 25));

  // 构造类型安全的查询条件
  const where: Prisma.AuditLogWhereInput = {};

  if (action && action !== "all") {
    where.action = action;
  }

  if (userId && userId !== "all") {
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
      where.userId = userId;
    }
  }

  if (q) {
    where.OR = [
      { docTitle: { contains: q } },
      { detail: { contains: q } },
      { ip: { contains: q } },
      { user: { nickname: { contains: q } } },
      { user: { phone: { contains: q } } },
      { user: { email: { contains: q } } },
      { user: { school: { contains: q } } },
    ];
  }

  // 计算今日开始时间 (本地零点)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 并行查询日志数据与全局统计指标
  const [
    total,
    logs,
    totalCount,
    todayCount,
    todayIpsRaw,
    verifyCount,
    userList,
  ] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            phone: true,
            email: true,
            school: true,
            role: true,
            avatar: true,
          },
        },
      },
    }),
    prisma.auditLog.count(),
    prisma.auditLog.count({
      where: { createdAt: { gte: todayStart } },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: todayStart }, ip: { not: null } },
      select: { ip: true },
      distinct: ["ip"],
    }),
    prisma.auditLog.count({
      where: { action: "verify" },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      // 用户量增长后限制下拉列表规模，避免每次日志请求全量加载用户表
      take: 200,
      select: {
        id: true,
        nickname: true,
        phone: true,
        email: true,
        role: true,
      },
    }),
  ]);

  return NextResponse.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      docId: log.docId,
      docTitle: log.docTitle,
      detail: log.detail,
      ip: log.ip,
      createdAt: log.createdAt.toISOString(),
      user: {
        id: log.user.id,
        nickname: log.user.nickname,
        account: log.user.phone ?? log.user.email ?? "—",
        school: log.user.school ?? null,
        role: log.user.role,
        avatar: log.user.avatar ?? null,
      },
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats: {
      totalLogs: totalCount,
      todayLogs: todayCount,
      todayIps: todayIpsRaw.length,
      verifyCount,
    },
    users: userList.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      account: u.phone ?? u.email ?? "—",
      role: u.role,
    })),
  });
}

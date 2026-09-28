import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 健康检查：供拨测/监控使用（如 UptimeRobot、云监控探针）
// 200 = 进程与数据库正常；503 = 依赖异常
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  const healthy = checks.database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}

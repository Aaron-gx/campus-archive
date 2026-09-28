import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserExpiryAlerts } from "@/lib/expiry-scheduler";

export const maxDuration = 10;

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const data = await getUserExpiryAlerts(session.id);
    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    console.error("expiry-alerts route error:", err);
    return NextResponse.json({ error: "获取到期提醒失败" }, { status: 500 });
  }
}

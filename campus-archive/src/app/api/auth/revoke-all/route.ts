import { NextResponse } from "next/server";
import { getSessionUser, revokeAllSessions, destroySession } from "@/lib/auth";

export async function POST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  await revokeAllSessions(session.id);
  await destroySession();
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, testAiConnection } from "@/lib/ai-config";

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
    const model = typeof body.model === "string" ? body.model.trim() : undefined;

    // 如果填的是掩码或空，使用已存的或系统默认配置
    if (!apiKey || apiKey.includes("••••")) {
      const existing = await getUserAiConfig(session.id);
      apiKey = existing.apiKey;
    }

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "请先输入 API Key" }, { status: 400 });
    }

    const testRes = await testAiConnection({ apiKey, baseUrl, model });
    return NextResponse.json(testRes, { status: testRes.ok ? 200 : 400 });
  } catch (err) {
    console.error("test ai connection error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "测试连接失败" },
      { status: 500 }
    );
  }
}

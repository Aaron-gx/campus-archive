import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, saveUserAiConfig } from "@/lib/ai-config";

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const config = await getUserAiConfig(session.id);
  const maskedKey = config.apiKey
    ? config.apiKey.length > 8
      ? `${config.apiKey.slice(0, 3)}••••••••${config.apiKey.slice(-4)}`
      : "••••••••"
    : "";

  return NextResponse.json({
    config: {
      hasKey: !!config.apiKey,
      maskedKey,
      baseUrl: config.baseUrl,
      model: config.model,
      isCustom: config.isCustom,
    },
  });
}

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
    const model = typeof body.model === "string" ? body.model.trim() : undefined;

    // 如果用户提交了占位符（未修改现有密钥），则保留库中已存密钥
    if (apiKey && apiKey.includes("••••")) {
      const existing = await getUserAiConfig(session.id);
      apiKey = existing.apiKey;
    }

    const saved = await saveUserAiConfig(session.id, {
      apiKey,
      baseUrl,
      model,
    });

    const maskedKey = saved.apiKey
      ? saved.apiKey.length > 8
        ? `${saved.apiKey.slice(0, 3)}••••••••${saved.apiKey.slice(-4)}`
        : "••••••••"
      : "";

    return NextResponse.json({
      ok: true,
      config: {
        hasKey: !!saved.apiKey,
        maskedKey,
        baseUrl: saved.baseUrl,
        model: saved.model,
        isCustom: saved.isCustom,
      },
    });
  } catch (err) {
    console.error("save ai-config error:", err);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}

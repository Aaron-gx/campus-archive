import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, formatEndpoint, assertPublicAiEndpoint, callAiChatWithRetry } from "@/lib/ai-config";
import { inspectOutboundPayload } from "@/lib/risk/dlp-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";

export const maxDuration = 20;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：触发外部 LLM 调用前先限流
  const rateLimited = checkAiRateLimit(session.id, "resume-bullet", 20);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const org = typeof body?.org === "string" ? body.org.trim() : "";
    const date = typeof body?.date === "string" ? body.date.trim() : "";
    const role = typeof body?.role === "string" ? body.role.trim() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    const level = typeof body?.level === "string" ? body.level.trim() : "";
    const type = body?.type === "certificate" ? "certificate" : "experience";

    if (!title && !org) {
      return NextResponse.json({ error: "请提供材料标题或机构信息" }, { status: 400 });
    }

    // 数据防泄露网关硬隔离检查
    const dlp = inspectOutboundPayload(undefined, `${title} ${org} ${role} ${note}`);
    if (dlp.blocked) {
      return NextResponse.json({ error: dlp.reason }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    const apiKey = config.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: "未配置 AI 服务 API Key" }, { status: 400 });
    }

    const guard = await assertPublicAiEndpoint(config.baseUrl);
    if (!guard.valid) {
      return NextResponse.json({ error: `AI 接口地址被安全策略拦截：${guard.error}` }, { status: 400 });
    }

    const systemPrompt = `你是一个高校学生求职与升学简历文案优化助手。
请根据用户提供的材料结构化信息，生成一段可直接写入个人简历的精炼专业表述（1-2 句话，60 字以内，遵循简历动作+结果规范）。
输出规则：
1. 严格只输出纯 JSON 对象：
{
  "bullet": "简历一句话表述"
}
2. 严禁添加任何 markdown 代码块标记，不要包含多余解释。`;

    const userPrompt =
      type === "certificate"
        ? `证书名称：${title}
颁发机构：${org}
证书级别：${level || "未指定"}
获得时间：${date || "未指定"}
附加说明：${note || "无"}`
        : `经历标题：${title}
组织机构：${org}
担任职务：${role || "无"}
发生日期：${date || "未指定"}
实践要点：${note || "无"}`;

    const endpoint = formatEndpoint(config.baseUrl);
    const result = await callAiChatWithRetry({
      endpoint,
      apiKey,
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      timeoutMs: 14000,
      maxRetries: 1,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const cleaned = result.content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const bullet = typeof parsed?.bullet === "string" ? parsed.bullet.trim() : "";

    return NextResponse.json({
      ok: true,
      data: { bullet },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "生成响应超时" }, { status: 504 });
    }
    console.error("resume-bullet error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败" },
      { status: 500 }
    );
  }
}

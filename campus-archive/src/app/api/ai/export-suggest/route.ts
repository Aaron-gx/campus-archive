import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAiConfig, formatEndpoint, assertPublicAiEndpoint, callAiChatWithRetry } from "@/lib/ai-config";
import { checkAiRateLimit } from "@/lib/rate-limit";

export const maxDuration = 20;

const VALID_KEYS = new Set<string>([
  "identity",
  "certificate",
  "experience",
  "photo",
  "portfolio",
]);

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：触发外部 LLM 调用前先限流
  const rateLimited = checkAiRateLimit(session.id, "export-suggest", 15);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json({ error: "请输入导出目的" }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    const apiKey = config.apiKey;
    if (!apiKey) {
      return NextResponse.json({ skipped: true, reason: "AI 服务未配置" });
    }

    const guard = await assertPublicAiEndpoint(config.baseUrl);
    if (!guard.valid) {
      return NextResponse.json({ error: `AI 接口地址被安全策略拦截：${guard.error}` }, { status: 400 });
    }

    // 汇总用户现有材料概要（严格隐私保护：identity 类仅传递数量，绝不暴露具体材料标题）
    const docs = await prisma.document.findMany({
      where: { userId: session.id },
      select: {
        title: true,
        category: {
          select: {
            key: true,
            name: true,
            parent: { select: { key: true, name: true } },
          },
        },
      },
    });

    const categorySummary: Record<string, { name: string; count: number; titles: string[] }> = {
      identity: { name: "身份证件", count: 0, titles: [] },
      certificate: { name: "获奖证书", count: 0, titles: [] },
      experience: { name: "经历证明", count: 0, titles: [] },
      photo: { name: "活动照片", count: 0, titles: [] },
      portfolio: { name: "个人作品集", count: 0, titles: [] },
    };

    for (const d of docs) {
      const topKey = d.category.parent?.key ?? d.category.key;
      if (categorySummary[topKey]) {
        categorySummary[topKey].count++;
        // 敏感分类绝不将标题发给大模型
        if (topKey !== "identity" && categorySummary[topKey].titles.length < 15) {
          categorySummary[topKey].titles.push(d.title);
        }
      }
    }

    const summaryLines: string[] = [];
    for (const [k, v] of Object.entries(categorySummary)) {
      if (k === "identity") {
        summaryLines.push(`- 身份证件 (${k}): 现有 ${v.count} 份`);
      } else if (v.titles.length > 0) {
        summaryLines.push(`- ${v.name} (${k}): 现有 ${v.count} 份，包含：${v.titles.slice(0, 10).join("、")}`);
      } else {
        summaryLines.push(`- ${v.name} (${k}): 现有 0 份`);
      }
    }

    const systemPrompt = `你是一个学生电子档案导出打包分类推荐助手。
用户将提供打包目标与现有材料概要，请推荐适合打包导出的分类键名（从 ["identity", "certificate", "experience", "photo", "portfolio"] 中选择）。
输出规则：
1. 严格只输出纯 JSON 对象，格式如下：
{
  "suggested": ["certificate", "experience"],
  "reason": "简明理由，20字以内"
}
2. 严禁添加任何 markdown 代码块标记，不要包含多余解释。`;

    const userPrompt = `导出目标：${goal.slice(0, 60)}
现有材料：
${summaryLines.join("\n")}`;

    const endpoint = formatEndpoint(config.baseUrl);
    const result = await callAiChatWithRetry({
      endpoint,
      apiKey,
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
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
    const suggestedRaw = Array.isArray(parsed?.suggested) ? parsed.suggested : [];
    const suggested = suggestedRaw.filter((k: unknown) => typeof k === "string" && VALID_KEYS.has(k));
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim().slice(0, 40) : "";

    return NextResponse.json({
      ok: true,
      data: {
        suggested: suggested.length > 0 ? suggested : ["certificate", "experience"],
        reason,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "智能推荐响应超时" }, { status: 504 });
    }
    console.error("export-suggest error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "推荐失败" },
      { status: 500 }
    );
  }
}

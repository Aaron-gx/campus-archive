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

interface MissingItem {
  name: string;
  categoryKey: string;
}

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：触发外部 LLM 调用前先限流
  const rateLimited = checkAiRateLimit(session.id, "archive-check", 15);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json({ error: "请选择或输入自检目标" }, { status: 400 });
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
        if (topKey !== "identity" && categorySummary[topKey].titles.length < 20) {
          categorySummary[topKey].titles.push(d.title);
        }
      }
    }

    const summaryLines: string[] = [];
    for (const [k, v] of Object.entries(categorySummary)) {
      if (k === "identity") {
        summaryLines.push(`- 身份证件 (${k}): 现有 ${v.count} 份`);
      } else if (v.titles.length > 0) {
        summaryLines.push(`- ${v.name} (${k}): 现有 ${v.count} 份，包含：${v.titles.join("、")}`);
      } else {
        summaryLines.push(`- ${v.name} (${k}): 现有 0 份`);
      }
    }

    const systemPrompt = `你是一个高校学生个人电子档案完备性自检助手。
请根据目标场景（如校招求职、升学保研、出国留学、评优评奖）与用户现有材料清单，对比常规必备材料，找出缺少的关键材料。
输出规则：
1. 严格只输出纯 JSON 对象，格式如下：
{
  "missing": [
    { "name": "缺失材料标准名称", "categoryKey": "certificate" }
  ],
  "status": "完备 | 良好 | 待补充"
}
2. categoryKey 必须严格从以下列表中选取：["identity", "certificate", "experience", "photo", "portfolio"]。
3. 缺失项最多列举 5 项最核心材料，名称简练明确。若材料已基本齐全，missing 设为空数组 []。
4. 严禁添加任何 markdown 代码块标记，不要包含多余解释。`;

    const userPrompt = `自检目标：${goal.slice(0, 50)}
现有档案清单：
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
    const rawMissing = Array.isArray(parsed?.missing) ? parsed.missing : [];
    const missing: MissingItem[] = [];

    for (const item of rawMissing) {
      if (item && typeof item === "object") {
        const name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
        const catKey = typeof item.categoryKey === "string" ? item.categoryKey.trim() : "";
        if (name && VALID_KEYS.has(catKey)) {
          missing.push({ name, categoryKey: catKey });
        }
      }
    }

    const validStatuses = new Set(["完备", "良好", "待补充"]);
    const status = typeof parsed?.status === "string" && validStatuses.has(parsed.status.trim())
      ? parsed.status.trim()
      : missing.length === 0 ? "完备" : "待补充";

    return NextResponse.json({
      ok: true,
      data: {
        haveCount: docs.length,
        missing: missing.slice(0, 5),
        status,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "自检服务响应超时" }, { status: 504 });
    }
    console.error("archive-check error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "自检失败" },
      { status: 500 }
    );
  }
}

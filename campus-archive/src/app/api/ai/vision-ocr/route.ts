import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, formatEndpoint, isVisionModel, callAiChatWithRetry } from "@/lib/ai-config";
import { assertCloudAllowed, assertDocCloudAllowed, sanitizeAiGeneratedTitle, sanitizeAiError } from "@/lib/ai-router";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const maxDuration = 35;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：多模态视觉请求限制频率（每用户每分钟最多 15 次）
  const rateLimited = checkAiRateLimit(session.id, "vision-ocr", 15);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const docId = typeof body?.docId === "string" ? body.docId.trim() : "";
    let categoryKey = typeof body?.categoryKey === "string" ? body.categoryKey.trim() : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const customPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    // 1. 服务端实体强校验：若提供 docId，从数据库核验其真实归属与安全属性
    if (docId) {
      try {
        const verifiedDoc = await assertDocCloudAllowed(docId, session.id);
        if (!categoryKey) categoryKey = verifiedDoc.categoryKey;
      } catch (secErr: unknown) {
        return NextResponse.json(
          { error: secErr instanceof Error ? secErr.message : "受保护材料禁止外发" },
          { status: 400 }
        );
      }
    }

    // 2. 核心安全红线：身份类材料绝不上云
    try {
      assertCloudAllowed(categoryKey);
    } catch (secErr: unknown) {
      return NextResponse.json(
        { error: secErr instanceof Error ? secErr.message : "受保护材料禁止外发" },
        { status: 400 }
      );
    }

    if (!imageBase64) {
      return NextResponse.json({ error: "请提供材料图像数据" }, { status: 400 });
    }

    if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(imageBase64)) {
      return NextResponse.json({ error: "图像格式不受支持，仅支持 PNG/JPEG/WEBP" }, { status: 400 });
    }

    if (imageBase64.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "图像过大，请使用 6MB 以内的图片" }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    if (!config.apiKey) {
      return NextResponse.json({ skipped: true, reason: "AI 服务未配置 API Key" });
    }

    if (!isVisionModel(config.model)) {
      return NextResponse.json({
        skipped: true,
        reason: `当前配置模型 "${config.model}" 不支持多模态视觉，请在设置页切换为 DeepSeek-VL 或兼容 Vision 模型`,
      });
    }

    const endpoint = formatEndpoint(config.baseUrl);

    const systemPrompt = `你是一个针对高校学生成长档案（获奖证书、实习实践证明、技能资质、活动记录）的高精度多模态视觉识别与信息提取助手。
请仔细阅读材料图片画面，提取文字内容并结构化关键信息。
输出规则：
1. 严格只输出纯 JSON 对象，严禁包含 markdown 代码块标记，不要包含多余解释：
{
  "fullText": "提取出的全部核心文字",
  "title": "纯粹的材料类型全称（例如：全国大学生数学建模竞赛一等奖、腾讯科技实习证明、大学英语六级证书。严禁附带 -正面、-反面、人像面、国徽面、主页、副页等任何面标签）",
  "org": "颁发单位或出具机构（如：中国工业与应用数学学会、教务处）",
  "date": "颁发或出具日期（YYYY-MM-DD 格式，若无则为空字符串）",
  "level": "级别（若为证书或竞赛，必须从 [\"国际级\", \"国家级\", \"省级\", \"市级\", \"校级\", \"院级\", \"其他\"] 中选择一个，非证书则为空字符串）",
  "keyFields": [
    { "label": "字段名", "value": "提取内容" }
  ]
}`;

    const userPrompt = customPrompt || "请识别此材料图片画面，提取全部文字及关键字段。";

    const aiRes = await callAiChatWithRetry({
      endpoint,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.1,
      timeoutMs: 25000,
      maxRetries: 1,
    });

    if (!aiRes.ok) {
      return NextResponse.json({ error: aiRes.error }, { status: aiRes.status });
    }

    let parsed: Record<string, unknown> = {};
    try {
      const rawText = aiRes.content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { fullText: aiRes.content };
    }

    // 强化规范命名（Rule 3）
    if (typeof parsed.title === "string") {
      parsed.title = sanitizeAiGeneratedTitle(parsed.title);
    }

    void logAudit(session.id, "ai-vision-ocr", {
      detail: `使用 ${config.model} 识别分类 ${categoryKey}`,
    });

    return NextResponse.json({ ok: true, data: parsed, model: config.model });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "视觉识别服务异常";
    console.error("vision-ocr handler error:", sanitizeAiError(rawMsg));
    return NextResponse.json(
      { error: sanitizeAiError(rawMsg) },
      { status: 500 }
    );
  }
}

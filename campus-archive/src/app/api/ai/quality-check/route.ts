import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, formatEndpoint, assertPublicAiEndpoint, isVisionModel } from "@/lib/ai-config";
import { inspectOutboundPayload } from "@/lib/risk/dlp-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { assertDocCloudAllowed, assertCloudAllowed, sanitizeAiError } from "@/lib/ai-router";

export const maxDuration = 20;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：视觉质检每次携带大图，触发外部 LLM 调用前先限流
  const rateLimited = checkAiRateLimit(session.id, "quality-check", 10);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const docId = typeof body?.docId === "string" ? body.docId.trim() : "";
    let categoryKey = typeof body?.categoryKey === "string" ? body.categoryKey.trim() : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";

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

    // 2. 拦截身份类材料误走云端
    try {
      assertCloudAllowed(categoryKey);
    } catch (secErr: unknown) {
      return NextResponse.json(
        { error: secErr instanceof Error ? secErr.message : "受保护材料禁止外发" },
        { status: 400 }
      );
    }

    // 数据防泄露网关硬隔离检查
    const dlp = inspectOutboundPayload(categoryKey);
    if (dlp.blocked) {
      return NextResponse.json({ error: dlp.reason }, { status: 400 });
    }

    if (!imageBase64) {
      return NextResponse.json({ error: "请提供图像数据" }, { status: 400 });
    }

    if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(imageBase64)) {
      return NextResponse.json({ error: "图像格式不受支持" }, { status: 400 });
    }

    if (imageBase64.length > 7 * 1024 * 1024) {
      return NextResponse.json({ error: "图像过大" }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    const apiKey = config.apiKey;
    if (!apiKey) {
      return NextResponse.json({ skipped: true, reason: "AI 服务未配置 API Key" });
    }

    if (!isVisionModel(config.model)) {
      return NextResponse.json({ skipped: true, reason: "当前模型不支持视觉分析" });
    }

    const guard = await assertPublicAiEndpoint(config.baseUrl);
    if (!guard.valid) {
      return NextResponse.json({ error: `AI 接口地址被安全策略拦截：${guard.error}` }, { status: 400 });
    }

    const systemPrompt = `你是一个文档图像画质与翻拍质量检测助手。
请检查用户提供的翻拍照片是否存在影响阅读或归档的严重画质问题（如画面严重模糊、强光大面积反光、光线过暗、边缘严重截断缺失）。
输出规则：
1. 严格只输出纯 JSON 对象：
若画质合格清晰：
{ "pass": true, "issue": "" }
若画质较差建议重拍：
{ "pass": false, "issue": "问题描述，4到6字以内，如：画面模糊 / 强光反光 / 光线过暗 / 边缘截断" }
2. 严禁添加任何 markdown 代码块标记，不要包含多余解释。`;

    const endpoint = formatEndpoint(config.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const apiRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "请评估该材料翻拍画质。" },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!apiRes.ok) {
      return NextResponse.json({ skipped: true, reason: `AI 质量分析服务未就绪 (${apiRes.status})` });
    }

    const resJson = await apiRes.json();
    const rawContent = resJson?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      return NextResponse.json({ skipped: true });
    }

    const cleaned = rawContent
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const pass = parsed?.pass === true;
    const issue = typeof parsed?.issue === "string" ? parsed.issue.trim().slice(0, 20) : "";

    return NextResponse.json({
      ok: true,
      data: {
        pass,
        issue: pass ? "" : issue,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ skipped: true, reason: "质量检测响应超时" });
    }
    const rawMsg = err instanceof Error ? err.message : "";
    console.error("quality-check error:", sanitizeAiError(rawMsg));
    return NextResponse.json({ skipped: true });
  }
}

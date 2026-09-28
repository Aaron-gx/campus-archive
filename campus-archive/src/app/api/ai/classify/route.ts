import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, formatEndpoint, isVisionModel, callAiChatWithRetry } from "@/lib/ai-config";
import { sanitizeAiGeneratedTitle, sanitizeAiError, getMaterialSensitivity } from "@/lib/ai-router";
import { recognizeDocument } from "@/lib/doc-recognition";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { MAIN_CATEGORY_KEYS, SUBCATEGORY_KEYS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export const maxDuration = 30;

const IDENTITY_PATTERNS = /身份证|户口|护照|通行证|驾照|驾驶证|学生证|出生证|出生证明|银行卡|社保卡|居住证/i;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const rateLimited = checkAiRateLimit(session.id, "classify", 20);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const docId = typeof body?.docId === "string" ? body.docId.trim() : "";
    const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const categoryKey = typeof body?.categoryKey === "string" ? body.categoryKey.trim() : "";
    let isSensitiveHint = Boolean(body?.isSensitive);

    // 服务端实体强校验：若传入 docId，核验其真实安全状态
    if (docId) {
      const doc = await prisma.document.findFirst({
        where: { id: docId, userId: session.id },
        include: { category: true },
      });
      if (doc) {
        if (doc.isSensitive || doc.e2ee || doc.category.key.startsWith("identity")) {
          isSensitiveHint = true;
        }
      }
    }

    // 1. 身份类高敏感判定：直接走纯本地规则闭环（零网络请求、零外发风险）
    if (
      isSensitiveHint ||
      getMaterialSensitivity(categoryKey) === "LOCAL" ||
      IDENTITY_PATTERNS.test(fileName) ||
      (text && IDENTITY_PATTERNS.test(text.slice(0, 100)))
    ) {
      const rec = recognizeDocument(text || fileName);
      let subKey = "identity-idcard";
      let title = "居民身份证";

      if (rec.type.startsWith("driver-license")) {
        subKey = "identity-license";
        title = "机动车驾驶证";
      } else if (rec.type.startsWith("household")) {
        subKey = "identity-household";
        title = "居民户口簿";
      } else if (rec.type.startsWith("student-card")) {
        subKey = "identity-student";
        title = "学生证";
      } else if (rec.type.startsWith("passport") || rec.type.startsWith("travel-permit")) {
        subKey = "identity-passport";
        title = "往来港澳通行证";
      } else if (rec.type.startsWith("birth-cert")) {
        subKey = "identity-birth";
        title = "出生医学证明";
      } else if (rec.type.startsWith("bank-card")) {
        subKey = "identity-bankcard";
        title = "银行卡";
      }

      return NextResponse.json({
        ok: true,
        data: {
          mainCategoryKey: "identity",
          subCategoryKey: subKey,
          title: sanitizeAiGeneratedTitle(title),
          confidence: 0.95,
          isLocalRule: true,
        },
      });
    }

    // 2. 非敏感材料：调用 DeepSeek / 云端多模态大模型智能推荐分类与规范标题
    const config = await getUserAiConfig(session.id);
    if (!config.apiKey) {
      return NextResponse.json({
        ok: true,
        data: {
          mainCategoryKey: "certificate",
          subCategoryKey: "certificate-award",
          title: sanitizeAiGeneratedTitle(fileName.replace(/\.[^.]+$/, "")),
          skipped: true,
        },
      });
    }

    const endpoint = formatEndpoint(config.baseUrl);

    const systemPrompt = `你是一个高校学生个人电子档案的智能归类与命名助手。
请分析材料信息，推断最准确的归属大分类、子类，并给出纯粹规范的材料名称。
可选大分类：
- "certificate"（证书与技能，子类：certificate-award 获奖证书、certificate-qualify 资格证书、certificate-level 等级证书、certificate-graduation 毕业学位证）
- "experience"（经历证明，子类：experience-intern 实习证明、experience-volunteer 志愿证明、experience-social 社会实践、experience-club 社团工作）
- "photo"（活动照片，子类：photo-competition 竞赛现场、photo-volunteer 志愿活动、photo-ceremony 颁奖典礼、photo-daily 日常记录）
- "portfolio"（个人作品集，子类：portfolio-design 设计作品、portfolio-code 代码项目、portfolio-writing 文章写作、portfolio-other 其他作品）

输出规则：
1. 严格只输出纯 JSON 对象，不要添加任何 markdown 代码块标记：
{
  "mainCategoryKey": "大分类key",
  "subCategoryKey": "子类key",
  "title": "纯粹的材料规范名称（严禁附带 -正面、-反面、人像面、国徽面、主页、副页等任何面标签，例如：全国大学生数学建模竞赛一等奖）",
  "tags": ["标签1", "标签2"]
}`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    const promptText = `文件名: ${fileName}\n识别文本片段: ${text.slice(0, 1500)}`;
    if (imageBase64 && isVisionModel(config.model)) {
      userContent.push({ type: "text", text: `请分析此材料画面及文本：\n${promptText}` });
      userContent.push({ type: "image_url", image_url: { url: imageBase64 } });
    } else {
      userContent.push({ type: "text", text: promptText });
    }

    const aiRes = await callAiChatWithRetry({
      endpoint,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      timeoutMs: 20000,
    });

    if (!aiRes.ok) {
      return NextResponse.json({
        ok: true,
        data: {
          mainCategoryKey: "certificate",
          subCategoryKey: "certificate-award",
          title: sanitizeAiGeneratedTitle(fileName.replace(/\.[^.]+$/, "")),
          aiError: aiRes.error,
        },
      });
    }

    let parsed: Record<string, unknown> = {};
    try {
      const cleanContent = aiRes.content.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleanContent);
    } catch {
      parsed = {};
    }

    const mainCategoryKey =
      typeof parsed.mainCategoryKey === "string" && (MAIN_CATEGORY_KEYS as readonly string[]).includes(parsed.mainCategoryKey)
        ? parsed.mainCategoryKey
        : "certificate";

    const subCategoryKey =
      typeof parsed.subCategoryKey === "string" && (SUBCATEGORY_KEYS as readonly string[]).includes(parsed.subCategoryKey)
        ? parsed.subCategoryKey
        : "certificate-award";

    const rawTitle = typeof parsed.title === "string" ? parsed.title : fileName.replace(/\.[^.]+$/, "");
    const cleanTitle = sanitizeAiGeneratedTitle(rawTitle);

    return NextResponse.json({
      ok: true,
      data: {
        mainCategoryKey,
        subCategoryKey,
        title: cleanTitle,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
      },
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : "智能分类失败";
    console.error("classify route error:", sanitizeAiError(rawMsg));
    return NextResponse.json({ error: "智能分类失败" }, { status: 500 });
  }
}

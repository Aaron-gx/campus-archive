import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { CERTIFICATE_LEVELS } from "@/lib/constants";
import { getUserAiConfig, formatEndpoint, assertPublicAiEndpoint, parseAiErrorMessage } from "@/lib/ai-config";
import { inspectOutboundPayload } from "@/lib/risk/dlp-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { assertDocCloudAllowed, sanitizeAiError } from "@/lib/ai-router";

export const maxDuration = 35;

const VALID_LEVELS = new Set<string>(CERTIFICATE_LEVELS);

const CERTIFICATE_SUBKEYS = new Set<string>([
  "certificate-award",
  "certificate-level",
  "certificate-qualify",
  "certificate-graduation",
]);

const EXPERIENCE_SUBKEYS = new Set<string>([
  "experience-academic",
  "experience-contest",
  "experience-intern",
  "experience-volunteer",
  "experience-social",
  "experience-club",
]);

interface CertificateResult {
  name: string;
  org: string;
  level: string;
  date: string;
  note?: string;
  subCategoryKey?: string;
}

interface ExperienceResult {
  title: string;
  org: string;
  date: string;
  role?: string;
  subCategoryKey?: string;
  note?: string;
}

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：触发外部 LLM 调用前先限流
  const rateLimited = checkAiRateLimit(session.id, "extract-fields", 20);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const docId = typeof body?.docId === "string" ? body.docId.trim() : "";
    let categoryKey = typeof body?.categoryKey === "string" ? body.categoryKey.trim() : "";
    const ocrText = typeof body?.ocrText === "string" ? body.ocrText.trim() : "";
    let imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";

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

    // 数据防泄露网关硬隔离检查
    const dlp = inspectOutboundPayload(categoryKey, ocrText);
    if (dlp.blocked) {
      return NextResponse.json({ error: dlp.reason }, { status: 400 });
    }

    if (imageBase64) {
      if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(imageBase64)) {
        return NextResponse.json({ error: "图像格式不受支持，仅支持 PNG/JPEG/WEBP" }, { status: 400 });
      }
      if (imageBase64.length > 7 * 1024 * 1024) {
        imageBase64 = ""; // 超大则忽略图片，纯走文本
      }
    }

    if (!ocrText && !imageBase64) {
      return NextResponse.json({ error: "内容为空" }, { status: 400 });
    }

    if (categoryKey !== "certificate" && categoryKey !== "experience") {
      return NextResponse.json({ error: "暂不支持此类别的智能解析" }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    const apiKey = config.apiKey;
    if (!apiKey) {
      return NextResponse.json({ skipped: true, reason: "AI 服务未配置 API Key" });
    }

    const endpoint = formatEndpoint(config.baseUrl);
    const model = config.model;

    // 出网前再次校验目标地址（防历史库存量数据绕过保存时校验）
    const guard = await assertPublicAiEndpoint(config.baseUrl);
    if (!guard.valid) {
      return NextResponse.json({ error: `AI 接口地址被安全策略拦截：${guard.error}` }, { status: 400 });
    }

    // 限制单次处理的字符长度，避免超长 token 消耗
    const truncatedText = ocrText.slice(0, 3000);

    const systemPrompt =
      categoryKey === "certificate"
        ? `你是一个高校学生证书与奖状信息结构化提取助手。
请提取以下结构化字段并严格以 JSON 格式输出：
- name: 证书或奖项全称（字符串）。例如："全国大学生数学建模竞赛一等奖"、"大学英语六级考试成绩报告单"。
- org: 颁发机构或主管单位（字符串）。例如："中国工业与应用数学学会"、"教育部教育考试院"、"清华大学"。
- level: 证书级别，必须严格从以下列表中选择一个（字符串）：["国际级", "国家级", "省级", "市级", "校级", "院级", "其他"]。
  判断规则：
  * 国际组织或跨国赛事选"国际级"；
  * 教育部、工信部、共青团中央、中国科协等国家部委或全国学会赛事选"国家级"；
  * 省级政府、教育厅、人社厅或全省范围竞赛选"省级"；
  * 市级部门或全市范围竞赛选"市级"；
  * 大学、校团委、校教务处等校级单位选"校级"；
  * 院系、书院、研究中心等选"院级"；
  * 行业协会、商业机构、技能培训或无法判断等级时选"其他"。
- date: 颁发或获奖日期（字符串），必须是 YYYY-MM-DD 格式。若只有年月则补充为 YYYY-MM-01；若无法识别则返回空字符串 ""。
- subCategoryKey: 推荐归属子分类，必须严格从以下键名中选择一个（字符串）：["certificate-award", "certificate-level", "certificate-qualify", "certificate-graduation"]。
  判断规则：
  * 竞赛获奖、技能大赛、荣誉表彰、优秀干部奖状选 "certificate-award"；
  * 四六级、英语水平、计算机等级、普通话、雅思托福等选 "certificate-level"；
  * 职业资格证书、从业资格证、软考工程师等专业资质选 "certificate-qualify"；
  * 毕业证书、学位证书、学历证明选 "certificate-graduation"。
- note: 补充说明信息（字符串），如证书编号、成绩分数、队员名单等，简短扼要，无则为空字符串 ""。

请只输出纯 JSON 对象，不要添加任何 markdown 代码块标记，不要包含多余解释。`
        : `你是一个高校学生个人经历证明信息提取助手。
请提取以下结构化字段并严格以 JSON 格式输出：
- title: 证明材料规范标题（字符串）。例如："腾讯科技实习证明"、"第十四届全运会志愿服务证明"、"暑期三下乡社会实践证明"。
- org: 证明出具单位或组织机构（字符串）。例如："腾讯科技（深圳）有限公司"、"校团委志愿服务中心"。
- date: 出具日期或发生日期（字符串），必须是 YYYY-MM-DD 格式。若只有年月则补充为 YYYY-MM-01；若无法识别则返回空字符串 ""。
- role: 担任角色或职务（字符串）。例如："前端开发实习生"、"志愿者"、"项目负责人"。若无则为空字符串 ""。
- subCategoryKey: 推荐归属分类，必须严格从以下键名中选择一个（字符串）：["experience-intern", "experience-volunteer", "experience-social", "experience-club"]。
  判断规则：
  * 企业/机关实习证明选 "experience-intern"；
  * 义工、志愿者服务证明选 "experience-volunteer"；
  * 社会实践、考察调研、下乡支教选 "experience-social"；
  * 学生会、社团任职、团支部工作证明选 "experience-club"。
- note: 简明要点记录（字符串），如实践时长、核心工作内容等，简要概括，无则为空字符串 ""。

请只输出纯 JSON 对象，不要添加任何 markdown 代码块标记，不要包含多余解释。`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);

    let userContent: unknown;
    if (imageBase64) {
      const promptText = truncatedText
        ? `材料图片及对应 OCR 识别文本如下，请结合画面与文本提取结构化字段：\n${truncatedText}`
        : "请阅读材料图片画面，提取结构化字段。";
      userContent = [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: imageBase64 } },
      ];
    } else {
      userContent = `OCR 文本内容：\n${truncatedText}`;
    }

    let apiRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // 若带多模态图像请求报错且有 OCR 文本，自动降级为纯文本重试一次
    if (!apiRes.ok && imageBase64 && truncatedText) {
      console.warn("Vision multimodal request failed, attempting text fallback");
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 12000);
      try {
        const retryRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `OCR 文本内容：\n${truncatedText}` },
            ],
            temperature: 0.1,
          }),
          signal: fallbackController.signal,
        });
        if (retryRes.ok) {
          apiRes = retryRes;
        }
      } catch {
        /* 保持原错误响应 */
      } finally {
        clearTimeout(fallbackTimeout);
      }
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => "");
      console.error("AI API HTTP Error:", apiRes.status, sanitizeAiError(errText));
      const friendlyMsg = parseAiErrorMessage(apiRes.status, errText, model);
      return NextResponse.json(
        { error: friendlyMsg },
        { status: apiRes.status === 429 ? 429 : 502 }
      );
    }

    const resJson = await apiRes.json();
    const rawContent = resJson?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      return NextResponse.json({ error: "智能服务返回数据无效" }, { status: 502 });
    }

    // 容错剥离可能的 markdown 代码块标记
    const cleanedJson = rawContent
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleanedJson);

    if (categoryKey === "certificate") {
      const result: CertificateResult = {
        name: typeof parsed.name === "string" ? parsed.name.trim().slice(0, 100) : "",
        org: typeof parsed.org === "string" ? parsed.org.trim().slice(0, 100) : "",
        level:
          typeof parsed.level === "string" && VALID_LEVELS.has(parsed.level.trim())
            ? parsed.level.trim()
            : "其他",
        date:
          typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date.trim())
            ? parsed.date.trim()
            : "",
        subCategoryKey:
          typeof parsed.subCategoryKey === "string" &&
          CERTIFICATE_SUBKEYS.has(parsed.subCategoryKey.trim())
            ? parsed.subCategoryKey.trim()
            : undefined,
        note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 300) : "",
      };
      return NextResponse.json({ ok: true, data: result });
    } else {
      const result: ExperienceResult = {
        title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 100) : "",
        org: typeof parsed.org === "string" ? parsed.org.trim().slice(0, 100) : "",
        date:
          typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date.trim())
            ? parsed.date.trim()
            : "",
        role: typeof parsed.role === "string" ? parsed.role.trim().slice(0, 50) : "",
        subCategoryKey:
          typeof parsed.subCategoryKey === "string" &&
          EXPERIENCE_SUBKEYS.has(parsed.subCategoryKey.trim())
            ? parsed.subCategoryKey.trim()
            : undefined,
        note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 300) : "",
      };
      return NextResponse.json({ ok: true, data: result });
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "智能服务响应超时" }, { status: 504 });
    }
    console.error("extract-fields error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "智能解析失败" },
      { status: 500 }
    );
  }
}

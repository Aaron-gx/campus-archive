/**
 * AI 分级路由与安全调度层 (AI Orchestration & Security Router)
 * 
 * 核心红线 (AI集成解决方案.md)：
 * 1. 身份信息 (identity-*) 绝不上云：只能走客户端/本地推理通道，图片字节流与敏感文本严禁外发大模型
 * 2. 非敏感材料 (certificate-*, experience-*, photo-*, portfolio-*) 允许走云端 (DeepSeek 多模态 / VL)
 * 3. 严格遵循 AGENTS.md 命名规范 (Rule 3)：所有 AI 生成标题必须清洗为纯证件/证书类型名称，严禁正反面后缀
 */

import { prisma } from "@/lib/prisma";

export type SensitivityLevel = "LOCAL" | "CLOUD";

/** 判定材料的敏感度层级 */
export function getMaterialSensitivity(categoryKey: string): SensitivityLevel {
  const cleanKey = (categoryKey || "").trim().toLowerCase();
  if (!cleanKey || cleanKey === "identity" || cleanKey.startsWith("identity-")) {
    return "LOCAL";
  }
  return "CLOUD";
}

/** 拦截身份类或未指定分类材料误走云端通道，违规立即抛出安全异常 */
export function assertCloudAllowed(categoryKey: string): void {
  if (getMaterialSensitivity(categoryKey) === "LOCAL") {
    throw new Error("[SECURITY] 身份类高敏感证件严禁调用云端大模型，必须且只能走本地推理通道");
  }
}

/**
 * 服务端强校验文档出网安全：
 * 根据 docId 从数据库核验文档真实归属与敏感/加密/分类状态，
 * 严防客户端篡改 categoryKey 外发身份证件。
 */
export async function assertDocCloudAllowed(
  docId: string,
  userId: string
): Promise<{ id: string; title: string; categoryKey: string }> {
  const doc = await prisma.document.findFirst({
    where: { id: docId, userId },
    include: { category: true },
  });
  if (!doc) {
    throw new Error("文档不存在或无权访问");
  }
  if (doc.isSensitive || doc.e2ee || doc.category.key.startsWith("identity")) {
    throw new Error("[SECURITY] 敏感或身份类材料禁止调用云端 AI 服务，必须且只能走本地处理通道");
  }
  return { id: doc.id, title: doc.title, categoryKey: doc.category.key };
}

/**
 * 依据 AGENTS.md (Rule 3) 强力清洗 AI 生成的标题
 * 绝对严禁附带 -正面、-反面、人像面、国徽面、主页、副页、签注等后缀
 */
export function sanitizeAiGeneratedTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  let title = rawTitle.trim();
  // 移除常见 markdown 包装与说明前缀
  title = title.replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  title = title.replace(/^(材料名称|证件名称|证书名称|标题)[：:\s]+/, "");
  // 正则剔除正反面与签注后缀
  title = title.replace(
    /[-·_\s]+(正面|反面|人像面|国徽面|主页|副页|首页|本人页|注册页|签注|签注面|签证页|信息面|签发信息面|个人信息面|个人信息页|资料页)$/i,
    ""
  ).trim();
  return title || rawTitle.trim();
}

/**
 * AI 日志与报错信息脱敏（过滤 Bearer Token 与 API Key）
 */
export function sanitizeAiError(text: string): string {
  if (!text) return "";
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk-[A-Za-z0-9_-]{8,}|key=[A-Za-z0-9_-]{8,})/gi, "[REDACTED_KEY]");
}

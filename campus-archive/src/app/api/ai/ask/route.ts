import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getUserAiConfig, formatEndpoint, callAiChatWithRetry } from "@/lib/ai-config";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const maxDuration = 35;

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 成本滥用防护：问答接口每分钟最多 15 次
  const rateLimited = checkAiRateLimit(session.id, "ask", 15);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "请输入您的问题" }, { status: 400 });
    }

    if (question.length > 500) {
      return NextResponse.json({ error: "问题长度不能超过 500 字" }, { status: 400 });
    }

    const config = await getUserAiConfig(session.id);
    if (!config.apiKey) {
      return NextResponse.json({ skipped: true, reason: "AI 服务未配置 API Key" });
    }

    // 核心红线约束：仅拉取非敏感材料（证书、经历证明、活动、作品），身份类绝不上云
    const [docs, certs, identityCount] = await Promise.all([
      prisma.document.findMany({
        where: {
          userId: session.id,
          isSensitive: false,
          category: { parentId: { not: null }, key: { not: "identity" } },
        },
        select: {
          id: true,
          title: true,
          note: true,
          createdAt: true,
          category: { select: { name: true, key: true } },
          certificate: {
            select: { name: true, org: true, level: true, awardedAt: true, note: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      prisma.certificate.findMany({
        where: { userId: session.id },
        select: { id: true, name: true, org: true, level: true, awardedAt: true, note: true },
        orderBy: { awardedAt: "desc" },
        take: 50,
      }),
      prisma.document.count({
        where: {
          userId: session.id,
          isSensitive: true,
        },
      }),
    ]);

    // 组装非敏感上下文摘要
    const archiveLines: string[] = [];
    archiveLines.push(`【用户档案基础概览】`);
    archiveLines.push(`- 证书总数：${certs.length} 项`);
    archiveLines.push(`- 实践/证明材料：${docs.length} 份`);
    archiveLines.push(`- 本地加密保护证件：${identityCount} 份（受端到端加密保护，不进入分析范围）\n`);

    if (certs.length > 0) {
      archiveLines.push(`【证书与获奖资质清单】`);
      for (const c of certs) {
        const dateStr = c.awardedAt ? c.awardedAt.toISOString().slice(0, 10) : "未知";
        archiveLines.push(
          `* ${c.name} | 颁发单位: ${c.org} | 等级: ${c.level} | 获得日期: ${dateStr}${c.note ? ` | 备注: ${c.note}` : ""}`
        );
      }
      archiveLines.push("");
    }

    if (docs.length > 0) {
      archiveLines.push(`【经历证明与实践材料清单】`);
      for (const d of docs) {
        const dateStr = d.createdAt ? d.createdAt.toISOString().slice(0, 10) : "未知";
        const subName = d.category?.name || "未分类";
        archiveLines.push(
          `* [${subName}] ${d.title} | 归档时间: ${dateStr}${d.note ? ` | 备注: ${d.note}` : ""}`
        );
      }
      archiveLines.push("");
    }

    const archivalContext = archiveLines.join("\n");

    const systemPrompt = `你是一个大学生成长档案智能顾问（简册 AI）。
请基于提供的【用户个人档案真实记录】回答用户的咨询。
回答原则：
1. 必须完全基于提供的档案记录事实回答，严禁凭空捏造未记录的荣誉或经历；
2. 条理分明，提到具体材料时列明名称、等级、出具机构和时间；
3. 如果用户询问的内容在档案中未检索到，客观告知暂无相关记录；
4. 绝对安全红线：任何涉及个人身份证件明细（身份证号、户籍地址等）的提问，明确告知个人身份材料已全部由端到端加密保护在用户本地设备，零外发至大模型；
5. 语气客观严谨，专业克制。`;

    const userPrompt = `【用户个人档案真实记录】：\n${archivalContext}\n\n【用户问题】：${question}`;

    const endpoint = formatEndpoint(config.baseUrl);

    const aiRes = await callAiChatWithRetry({
      endpoint,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      timeoutMs: 30000,
    });

    if (!aiRes.ok) {
      return NextResponse.json({ error: aiRes.error }, { status: aiRes.status });
    }

    void logAudit(session.id, "ai-ask", {
      detail: `咨询问题: ${question.slice(0, 50)}`,
    });

    return NextResponse.json({
      ok: true,
      answer: aiRes.content,
      model: config.model,
      sources: {
        certificateCount: certs.length,
        documentCount: docs.length,
      },
    });
  } catch (err: unknown) {
    console.error("ask route error:", err);
    return NextResponse.json({ error: "档案问答处理失败" }, { status: 500 });
  }
}

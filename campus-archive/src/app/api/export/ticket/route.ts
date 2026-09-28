import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generateVerifyCode } from "@/lib/risk/watermark";
import { createExportTicket } from "@/lib/export-ticket";
import { rateLimiter, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 1. 限流：单 IP 每分钟最多 10 次，单用户 10 分钟内最多生成 30 个存证票据，防止批量滥用
  const ip = getClientIp(req);
  const limitIp = rateLimiter.check(`export:ticket:ip:${ip}`, {
    windowMs: 60 * 1000,
    max: 10,
  });
  if (!limitIp.success) {
    return NextResponse.json(
      { error: "存证请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limitIp.resetMs / 1000)) } }
    );
  }
  const limitUser = rateLimiter.check(`export:ticket:user:${session.id}`, {
    windowMs: 10 * 60 * 1000,
    max: 30,
  });
  if (!limitUser.success) {
    return NextResponse.json(
      { error: "存证请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limitUser.resetMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { categoryKeys, watermarkText } = body;
  if (!Array.isArray(categoryKeys) || categoryKeys.length === 0) {
    return NextResponse.json({ error: "请选择需要导出的分类" }, { status: 400 });
  }

  const validKeys = categoryKeys.filter((k): k is string => typeof k === "string" && Boolean(k.trim()));
  if (validKeys.length === 0) {
    return NextResponse.json({ error: "参数不正确" }, { status: 400 });
  }

  // 2. 真实材料绑定核验：当前用户在所选分类下必须真实拥有材料
  const documents = await prisma.document.findMany({
    where: {
      userId: session.id,
      category: {
        OR: [
          { key: { in: validKeys } },
          { parent: { key: { in: validKeys } } },
        ],
      },
    },
    select: { id: true },
  });

  if (documents.length === 0) {
    return NextResponse.json({ error: "所选分类下暂无材料，无法生成存证票据" }, { status: 400 });
  }

  // 3. 服务端权威构建材料摘要，杜绝客户端注入任意字符串与路径穿越
  const categories = await prisma.category.findMany({
    where: { key: { in: validKeys } },
    select: { key: true, name: true },
  });
  const catNameMap = new Map(categories.map((c) => [c.key, c.name]));
  const catNames = validKeys.map((k) => catNameMap.get(k) || k).join("、");
  const manifestSummary = `材料共 ${documents.length} 份（${catNames}）`;

  // 4. 服务端生成不可预测的规范存证编号
  let verifyCode = generateVerifyCode();
  // 确保唯一（防碰撞）
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.exportRecord.findUnique({ where: { verifyCode } });
    if (!exists) break;
    verifyCode = generateVerifyCode();
  }

  // 5. 签发带时效的 HMAC 票据
  const ticket = createExportTicket({
    sub: session.id,
    verifyCode,
    manifestSummary,
    docCount: documents.length,
    categoryKeys: validKeys,
    watermarkText: typeof watermarkText === "string" ? watermarkText.trim().slice(0, 100) : null,
    exp: Date.now() + 15 * 60 * 1000, // 15 分钟有效期
  });

  return NextResponse.json({
    verifyCode,
    manifestSummary,
    ticket,
  });
}

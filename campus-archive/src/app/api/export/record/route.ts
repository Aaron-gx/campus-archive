import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { verifyExportTicket, signExportRecord } from "@/lib/export-ticket";

// 浏览器端打包导出的落库：客户端在本地解密 e2ee 材料打成 zip 后，
// 凭服务端签发的有效 Ticket 记录导出历史 + 存证指纹 + 审计日志（服务器不接触明文材料）
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) ?? {};
  const { ticket, sha256, size, fileName } = body;

  // 1. 强制要求携带服务端签发的有效 Ticket，彻底防范伪造核验编号与恶意篡改元数据
  if (!ticket || typeof ticket !== "string") {
    return NextResponse.json(
      { error: "缺少有效存证票据，请通过系统导出流程重新生成" },
      { status: 400 }
    );
  }

  const ticketPayload = verifyExportTicket(ticket, session.id);
  if (!ticketPayload) {
    return NextResponse.json(
      { error: "存证票据无效或已过期，请重新发起导出" },
      { status: 400 }
    );
  }

  const { verifyCode, manifestSummary, categoryKeys, watermarkText } = ticketPayload;

  // 2. sha256 完整性与虚假指纹拦截
  const cleanSha = typeof sha256 === "string" ? sha256.trim().toLowerCase() : "";
  if (!cleanSha || !/^[0-9a-f]{64}$/.test(cleanSha)) {
    return NextResponse.json({ error: "存证指纹格式不正确（需为 64 位十六进制）" }, { status: 400 });
  }
  // 杜绝全 0、全相同字符等伪造指纹
  if (/^0{64}$/.test(cleanSha) || /^(.)\1{63}$/.test(cleanSha)) {
    return NextResponse.json({ error: "无效的存证指纹" }, { status: 400 });
  }

  // 3. 文件名路径穿越清洗与格式规范（杜绝 ./etc/passwd 或 ../跳转 等恶意注入）
  let safeFileName = typeof fileName === "string" ? fileName.trim() : "";
  safeFileName = safeFileName
    .replace(/[/\\]/g, "")
    .replace(/\.\.+/g, "")
    .replace(/[\0-\x1f\x7f]/g, "");
  if (!safeFileName.endsWith(".zip")) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    safeFileName = `简册归档包_${stamp}.zip`;
  }
  safeFileName = safeFileName.slice(0, 80);

  // 4. 服务端生成防篡改 HMAC-SHA256 存证签名
  const signature = signExportRecord(verifyCode, cleanSha, manifestSummary, session.id);

  try {
    const record = await prisma.exportRecord.create({
      data: {
        userId: session.id,
        categoryKeys: categoryKeys.join(","),
        fileName: safeFileName,
        size: Number(size) >= 0 ? Number(size) : 0,
        verifyCode,
        sha256: cleanSha,
        manifestSummary,
        watermarkText: watermarkText || null,
        signature,
      },
    });
    await logAudit(session.id, "export", {
      detail: `本机打包导出（存证编号: ${verifyCode}）：${categoryKeys.join(",")}`,
      req,
    });
    return NextResponse.json({ record });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "该存证编号已存在，请重新生成", code: "CODE_CONFLICT" }, { status: 409 });
    }
    console.error("export record error", err);
    return NextResponse.json({ error: "记录导出历史失败" }, { status: 500 });
  }
}
